import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// vitest siempre corre con cwd en la raiz del paquete (pnpm test / turbo run test).
const apiDir = process.cwd();
const schemaPath = join(apiDir, "prisma", "schema.prisma");
const migrationsDir = join(apiDir, "prisma", "migrations");

const betterAuthTables = [
  "user",
  "session",
  "account",
  "verification",
  "organization",
  "member",
  "invitation",
  "twoFactor",
] as const;

const restrictedRole = "caribe_app";

interface Migration {
  name: string;
  sql: string;
}

function readMigrations(): Migration[] {
  const entries = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return entries
    .map((name) => {
      const sql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf-8");
      return { name, sql };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Quita los comentarios `--` para auditar solo el SQL ejecutable; los
 * comentarios explicativos pueden mencionar palabras prohibidas (p. ej.
 * PASSWORD en la nota de como asignar la contrasena fuera de bandas).
 */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function findRoleMigration(migrations: Migration[]): Migration | undefined {
  return migrations.find(({ sql }) =>
    stripSqlComments(sql).includes(`CREATE ROLE ${restrictedRole}`),
  );
}

function findAuditMigration(migrations: Migration[]): Migration | undefined {
  return migrations.find(({ sql }) => sql.includes('CREATE TABLE "audit_logs"'));
}

describe("prisma/schema.prisma", () => {
  it("declara las 8 tablas de better auth con nombre en minusculas", () => {
    expect(existsSync(schemaPath)).toBe(true);
    const schema = readFileSync(schemaPath, "utf-8");
    for (const table of betterAuthTables) {
      expect(schema).toContain(`@@map("${table}")`);
    }
  });

  it("usa el generador prisma-client de prisma 7 con salida en src/generated", () => {
    const schema = readFileSync(schemaPath, "utf-8");
    expect(schema).toContain('provider = "prisma-client"');
    expect(schema).toMatch(/output\s*=\s*"\.\.\/src\/generated\/prisma"/);
    expect(schema).toContain('moduleFormat = "cjs"');
  });

  it("no decla el tipo Float para ningun campo", () => {
    const schema = readFileSync(schemaPath, "utf-8");
    expect(schema).not.toMatch(/\bFloat\b/);
  });

  it("declara el modelo AuditLog mapeado a audit_logs con tenant_id", () => {
    const schema = readFileSync(schemaPath, "utf-8");
    expect(schema).toContain("model AuditLog");
    expect(schema).toContain('@@map("audit_logs")');
    expect(schema).toMatch(/tenantId\s+String\?\s+@map\("tenant_id"\)/);
  });

  it("declara user.locale con default es (additionalFields de Better Auth)", () => {
    const schema = readFileSync(schemaPath, "utf-8");
    expect(schema).toMatch(/locale\s+String\?\s+@default\("es"\)/);
  });

  it("declara tenant_settings con el enum PaymentMode y la relación 1:1 a organization", () => {
    const schema = readFileSync(schemaPath, "utf-8");
    expect(schema).toContain("enum PaymentMode");
    expect(schema).toContain("model TenantSettings");
    expect(schema).toContain('@@map("tenant_settings")');
    expect(schema).toMatch(/holdMinutes\s+Int\s+@default\(30\)\s+@map\("hold_minutes"\)/);
    expect(schema).toMatch(
      /paymentMode\s+PaymentMode\s+@default\(AUTO\)\s+@map\("payment_mode"\)/,
    );
    expect(schema).toMatch(
      /baseCurrency\s+String\s+@default\("USD"\)\s+@map\("base_currency"\)/,
    );
    expect(schema).toMatch(
      /organization\s+Organization\s+@relation\(fields:\s*\[tenantId\],\s*references:\s*\[id\]/,
    );
    expect(schema).toMatch(/tenantSettings\s+TenantSettings\?/);
  });
});

describe("prisma/migrations", () => {
  it("tiene al menos dos migraciones sql con nombre versionado", () => {
    const migrations = readMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    for (const { name } of migrations) {
      expect(name).toMatch(/^\d{14}_[a-z0-9_]+$/);
    }
  });

  it("la migracion inicial crea las 8 tablas de better auth", () => {
    const migrations = readMigrations();
    const init = migrations.find(({ sql }) => sql.includes('CREATE TABLE "user"'));
    expect(init).toBeDefined();
    for (const table of betterAuthTables) {
      expect(init?.sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("crea el rol restringido de aplicacion en su propia migracion", () => {
    const migrations = readMigrations();
    const init = migrations.find(({ sql }) => sql.includes('CREATE TABLE "user"'));
    const role = findRoleMigration(migrations);
    expect(init).toBeDefined();
    expect(role).toBeDefined();
    expect(role?.name).not.toBe(init?.name);

    const names = migrations.map(({ name }) => name);
    expect(names.indexOf(role?.name ?? "")).toBeGreaterThan(names.indexOf(init?.name ?? ""));

    // Es una migracion solo de rol: no crea ni modifica tablas.
    expect(stripSqlComments(role?.sql ?? "")).not.toMatch(/CREATE (?!ROLE)/);
  });

  it("el rol no puede saltarse RLS ni es superusuario", () => {
    const role = findRoleMigration(readMigrations());
    const sql = stripSqlComments(role?.sql ?? "");
    expect(sql).toContain("NOBYPASSRLS");
    expect(sql).not.toContain("SUPERUSER");
  });

  it("el rol solo recibe DML basico, nunca GRANT ALL", () => {
    const role = findRoleMigration(readMigrations());
    const sql = stripSqlComments(role?.sql ?? "");
    expect(sql).toContain("GRANT USAGE ON SCHEMA public TO caribe_app");
    expect(sql).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO caribe_app",
    );
    expect(sql).toContain("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO caribe_app");
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM caribe_app');
    expect(sql).not.toMatch(/GRANT ALL/);
  });

  it("extiende los permisos DML a las tablas futuras del esquema", () => {
    const role = findRoleMigration(readMigrations());
    const sql = stripSqlComments(role?.sql ?? "");
    expect(sql).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO caribe_app",
    );
    expect(sql).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO caribe_app",
    );
  });

  it("es idempotente y no guarda contrasenas en el repositorio", () => {
    const role = findRoleMigration(readMigrations());
    const sql = stripSqlComments(role?.sql ?? "");
    expect(sql).toContain("pg_roles");
    expect(sql).not.toMatch(/PASSWORD/i);
  });

  it("crea audit_logs con tenant_id y activa RLS con FORCE", () => {
    const audit = findAuditMigration(readMigrations());
    expect(audit).toBeDefined();
    const sql = stripSqlComments(audit?.sql ?? "");
    expect(sql).toContain('CREATE TABLE "audit_logs"');
    expect(sql).toContain('"tenant_id" TEXT');
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    // Se aplica despues de la del rol restringido: RLS protege a caribe_app.
    const names = readMigrations().map(({ name }) => name);
    expect(names.indexOf(audit?.name ?? "")).toBeGreaterThan(
      names.indexOf(findRoleMigration(readMigrations())?.name ?? ""),
    );
  });

  it("las politicas de audit_logs filtran por el GUC y con fallo cerrado", () => {
    const audit = findAuditMigration(readMigrations());
    expect(audit).toBeDefined();
    const sql = stripSqlComments(audit?.sql ?? "");
    expect(sql).toContain('CREATE POLICY "audit_logs_tenant"');
    expect(sql).toContain('CREATE POLICY "audit_logs_platform"');
    // missing_ok (true): sin GUC, current_setting devuelve NULL y la fila no
    // pasa la politica; el 404/403 de la capa de servicio traduce ese vacio.
    expect(sql).toContain("current_setting('app.tenant_id', true)");
    expect(sql).toContain("current_setting('app.platform', true)");
    // WITH CHECK en ambas: ni escribir filas de otro tenant ni fuera de contexto.
    expect(sql.match(/WITH CHECK/g)?.length).toBe(2);
  });

  it("crea tenant_settings con defaults, CHECKs, FK, RLS forzada y políticas", () => {
    const migration = readMigrations().find(({ sql }) =>
      sql.includes('CREATE TABLE "tenant_settings"'),
    );
    expect(migration).toBeDefined();
    const sql = stripSqlComments(migration?.sql ?? "");

    // Defaults de negocio (spec: 30 min, AUTO y USD).
    expect(sql).toContain('"hold_minutes" INTEGER NOT NULL DEFAULT 30');
    expect(sql).toContain('"payment_mode" "PaymentMode" NOT NULL DEFAULT \'AUTO\'');
    expect(sql).toContain('"base_currency" TEXT NOT NULL DEFAULT \'USD\'');
    expect(sql).toContain('CREATE TYPE "PaymentMode" AS ENUM (\'AUTO\', \'MANUAL\')');

    // Límites en la base, no solo en Zod (defensa en profundidad).
    expect(sql).toContain(
      'CHECK ("hold_minutes" BETWEEN 5 AND 1440)',
    );
    expect(sql).toContain('CHECK ("base_currency" ~ \'^[A-Z]{3}$\')');

    // 1:1 con organization y cascada al borrar la agencia.
    expect(sql).toContain('REFERENCES "organization"("id") ON DELETE CASCADE');

    // RLS forzada + política de agencia (FOR ALL con WITH CHECK) y de
    // plataforma (solo lectura).
    expect(sql).toContain('ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY "tenant_settings_tenant"');
    expect(sql).toContain('CREATE POLICY "tenant_settings_platform"');
    expect(sql).toContain("current_setting('app.tenant_id', true)");
    expect(sql).toContain("current_setting('app.platform', true)");
    expect(sql).toMatch(/CREATE POLICY "tenant_settings_platform"[\s\S]*?FOR SELECT/);
    expect(sql).toMatch(/CREATE POLICY "tenant_settings_tenant"[\s\S]*?FOR ALL/);
  });
});

describe("catálogo y disponibilidad (T-F1-1b)", () => {
  function catalogSchema(): string {
    return readFileSync(schemaPath, "utf-8");
  }

  function catalogMigration(): Migration | undefined {
    return readMigrations().find(({ sql }) => sql.includes('CREATE TABLE "products"'));
  }

  it("declara producto = tipo de habitación con hotel_key, room_type y dinero Decimal", () => {
    const schema = catalogSchema();
    expect(schema).toContain("model Product");
    expect(schema).toContain('@@map("products")');
    expect(schema).toMatch(/hotelKey\s+String\s+@map\("hotel_key"\)/);
    expect(schema).toMatch(/roomType\s+String\s+@map\("room_type"\)/);
    expect(schema).toMatch(/basePriceUsd\s+Decimal\s+@db\.Decimal\(14,\s*2\)/);
    expect(schema).not.toMatch(/\bFloat\b/);
    expect(schema).toContain("model Availability");
    expect(schema).toContain('@@map("availability")');
    expect(schema).toMatch(/night\s+DateTime\s+@db\.Date/);
    expect(schema).toMatch(/@@unique\(\[productId,\s*night\]\)/);
    expect(schema).toContain("model Provider");
    expect(schema).toContain("model Destination");
    expect(schema).toContain("model CancellationPolicy");
  });

  it("crea las tablas del catálogo con CHECKs e índices de búsqueda", () => {
    const migration = catalogMigration();
    expect(migration).toBeDefined();
    const sql = stripSqlComments(migration?.sql ?? "");

    expect(sql).toContain('CREATE TABLE "providers"');
    expect(sql).toContain('CREATE TABLE "destinations"');
    expect(sql).toContain('CREATE TABLE "products"');
    expect(sql).toContain('CREATE TABLE "availability"');
    expect(sql).toContain('CREATE TABLE "cancellation_policies"');

    expect(sql).toContain('"hotel_key" TEXT NOT NULL');
    expect(sql).toContain('"room_type" TEXT NOT NULL');
    expect(sql).toContain('"price_usd" DECIMAL(14,2) NOT NULL');
    expect(sql).toContain('CHECK ("reserved" >= 0 AND "reserved" <= "capacity")');
    expect(sql).toContain('CHECK ("price_usd" > 0)');
    expect(sql).toContain('CHECK ("capacity" > 0)');
    expect(sql).toContain('CHECK ("room_type" ~ \'^[a-z][a-z0-9_-]*$\')');

    expect(sql).toContain(
      'CREATE UNIQUE INDEX "availability_product_id_night_key" ON "availability"("product_id", "night")',
    );
    expect(sql).toContain(
      'CREATE INDEX "availability_night_product_id_idx" ON "availability"("night", "product_id")',
    );
    expect(sql).toContain(
      'CREATE INDEX "products_type_destination_id_status_deleted_at_idx" ON "products"("type", "destination_id", "status", "deleted_at")',
    );
    expect(sql).toContain(
      'CREATE INDEX "products_tenant_id_type_destination_id_status_idx" ON "products"("tenant_id", "type", "destination_id", "status")',
    );
  });

  it("activa RLS forzada en todo el catálogo y publica solo lo publicado", () => {
    const migration = catalogMigration();
    const sql = stripSqlComments(migration?.sql ?? "");
    for (const table of [
      "providers",
      "destinations",
      "products",
      "availability",
      "cancellation_policies",
    ]) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY "${table}_tenant"`);
      expect(sql).toContain(`CREATE POLICY "${table}_platform"`);
    }
    expect(sql).toContain('CREATE POLICY "products_public"');
    expect(sql).toContain('CREATE POLICY "availability_public"');
    expect(sql).toContain('CREATE POLICY "destinations_public"');
    expect(sql).toMatch(
      /CREATE POLICY "products_public"[\s\S]*?current_setting\('app\.public', true\) = 'on'[\s\S]*?"status" = 'PUBLISHED'[\s\S]*?"deleted_at" IS NULL/,
    );
    expect(sql).toMatch(
      /CREATE POLICY "availability_public"[\s\S]*?EXISTS \([\s\S]*?FROM "products" p[\s\S]*?p\."status" = 'PUBLISHED'[\s\S]*?p\."deleted_at" IS NULL/,
    );
  });

  it("define la función pública de disponibilidad sin capacity ni reserved", () => {
    const migration = catalogMigration();
    const sql = stripSqlComments(migration?.sql ?? "");
    expect(sql).toContain('CREATE FUNCTION "public_availability"');
    expect(sql).toContain("RETURNS TABLE");
    expect(sql).toMatch(/night\s+DATE/);
    expect(sql).toMatch(/remaining\s+INTEGER/);
    expect(sql).toMatch(/price_usd\s+DECIMAL\(14,2\)/);
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain('REVOKE ALL ON FUNCTION "public_availability"');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION "public_availability"');
  });

  it("refuerza las reglas de cancelación con un trigger", () => {
    const migration = catalogMigration();
    const sql = stripSqlComments(migration?.sql ?? "");
    expect(sql).toContain('CREATE FUNCTION "cancellation_policies_validate_rules"');
    expect(sql).toContain('CREATE TRIGGER "cancellation_policies_rules_valid"');
    expect(sql).toContain("jsonb_array_length");
    expect(sql).toContain("hours_before");
    expect(sql).toContain("percentage");
    expect(sql).toContain("BEFORE INSERT OR UPDATE");
  });
});

describe("política de cancelación pública (catalog-public-cancellation-policy)", () => {
  function policyMigration(): Migration | undefined {
    return readMigrations().find(({ sql }) =>
      sql.includes('CREATE FUNCTION "public_cancellation_policy"'),
    );
  }

  it("define una función de solo lectura para el detalle público", () => {
    const sql = stripSqlComments(policyMigration()?.sql ?? "");
    expect(sql).toContain('CREATE FUNCTION "public_cancellation_policy"');
    expect(sql).toMatch(/name\s+TEXT/);
    expect(sql).toMatch(/rules\s+JSONB/);
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("STABLE");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toContain("p.\"status\" = 'PUBLISHED'");
    expect(sql).toContain("p.\"deleted_at\" IS NULL");
    expect(sql).toContain('REVOKE ALL ON FUNCTION "public_cancellation_policy"(text) FROM PUBLIC');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION "public_cancellation_policy"(text) TO caribe_app');
  });

  it("no añade acceso directo a la tabla desde el contexto público", () => {
    const sql = stripSqlComments(policyMigration()?.sql ?? "");
    expect(sql).not.toContain('CREATE POLICY "cancellation_policies_public"');
    expect(sql).not.toContain("ALTER TABLE \"cancellation_policies\"");
    expect(sql).toContain('JOIN "products" p ON p."cancellation_policy_id" = cp."id"');
  });
});

describe("reservas, pagos y documentos (T-F1-1c)", () => {
  function transactionsSchema(): string {
    return readFileSync(schemaPath, "utf-8");
  }

  function transactionsMigration(): Migration | undefined {
    return readMigrations().find(({ sql }) => sql.includes('CREATE TABLE "bookings"'));
  }

  it("declara las tablas, enums y dinero Decimal de reservas, pagos y documentos", () => {
    const schema = transactionsSchema();
    for (const model of [
      "Booking",
      "BookingItem",
      "IdempotencyKey",
      "ExchangeRate",
      "Payment",
      "Refund",
      "Document",
      "DocumentCounter",
      "NotificationLog",
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
    for (const table of [
      "bookings",
      "booking_items",
      "idempotency_keys",
      "exchange_rates",
      "payments",
      "refunds",
      "documents",
      "document_counters",
      "notification_logs",
    ]) {
      expect(schema).toContain(`@@map("${table}")`);
    }
    for (const enumName of [
      "BookingStatus",
      "PaymentMethod",
      "PaymentStatus",
      "DocumentType",
      "DocumentStatus",
      "DocumentLanguage",
      "NotificationStatus",
    ]) {
      expect(schema).toContain(`enum ${enumName}`);
    }
    expect(schema).toMatch(/totalUsd\s+Decimal\s+@db\.Decimal\(14,\s*2\)/);
    expect(schema).toMatch(/subtotalUsd\s+Decimal\s+@db\.Decimal\(14,\s*2\)/);
    expect(schema).toMatch(/amountUsd\s+Decimal\s+@db\.Decimal\(14,\s*2\)/);
    expect(schema).toMatch(/rate\s+Decimal\s+@db\.Decimal\(18,\s*4\)/);
    expect(schema).toMatch(/ES\s+@map\("es"\)/);
    expect(schema).toMatch(/EN\s+@map\("en"\)/);
    expect(schema).toMatch(/PARTIALLY_REFUNDED/);
    expect(schema).not.toMatch(/\bFloat\b/);
  });

  it("crea las tablas con CHECKs de código, viajeros, fechas, cantidades y montos", () => {
    const migration = transactionsMigration();
    expect(migration).toBeDefined();
    const sql = stripSqlComments(migration?.sql ?? "");

    for (const table of [
      "bookings",
      "booking_items",
      "idempotency_keys",
      "exchange_rates",
      "payments",
      "refunds",
      "documents",
      "document_counters",
      "notification_logs",
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }

    expect(sql).toContain('CHECK ("code" ~ \'^CRB-[0-9A-HJKMNP-TV-Z]{8}$\')');
    expect(sql).toContain("jsonb_array_length");
    expect(sql).toContain('CHECK ("total_usd" > 0)');
    expect(sql).toContain('CHECK ("quantity" > 0)');
    expect(sql).toContain('CHECK ("check_out" > "check_in")');
    expect(sql).toContain('CHECK (("check_out" - "check_in") <= 30)');
    expect(sql).toContain('CHECK ("subtotal_usd" > 0)');
    expect(sql).toContain('CHECK ("amount_usd" > 0)');
    expect(sql).toContain('CHECK ("amount_ves" > 0)');
    expect(sql).toContain('CHECK ("rate" > 0)');
    expect(sql).toContain('CHECK ("next_value" >= 1)');
    expect(sql).toContain('CHECK ("attempts" >= 0)');
  });

  it("impone los únicos parciales de documentos, referencias y tasas globales", () => {
    const migration = transactionsMigration();
    // El SQL propio parte las sentencias en varias líneas; se compara con los
    // espacios colapsados para no atarse al formato.
    const sql = stripSqlComments(migration?.sql ?? "").replace(/\s+/g, " ");

    expect(sql).toContain(
      'CREATE UNIQUE INDEX "documents_voucher_unique" ON "documents"("booking_id") WHERE "type" = \'VOUCHER\'',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "documents_receipt_unique" ON "documents"("payment_id") WHERE "type" = \'RECEIPT\'',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "documents_refund_note_unique" ON "documents"("refund_id") WHERE "type" = \'REFUND_NOTE\'',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "payments_reference_unique" ON "payments"("tenant_id", "method", "reference") WHERE "reference" IS NOT NULL',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "exchange_rates_global_value_date_unique" ON "exchange_rates"("value_date") WHERE "tenant_id" IS NULL',
    );
    expect(sql).toContain('CREATE UNIQUE INDEX "refunds_payment_id_key"');
  });

  it("activa RLS forzada y separa los contextos de agencia, dueño y tasas", () => {
    const migration = transactionsMigration();
    const sql = stripSqlComments(migration?.sql ?? "");

    for (const table of [
      "bookings",
      "booking_items",
      "idempotency_keys",
      "exchange_rates",
      "payments",
      "refunds",
      "documents",
      "document_counters",
      "notification_logs",
    ]) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }

    expect(sql).toContain('CREATE POLICY "bookings_tenant_owner"');
    expect(sql).toMatch(
      /CREATE POLICY "bookings_tenant_owner"[\s\S]*?app\.tenant_id[\s\S]*?app\.user_id/,
    );
    expect(sql).toContain('CREATE POLICY "payments_tenant_owner"');
    expect(sql).toContain('CREATE POLICY "booking_items_tenant_owner"');
    expect(sql).toContain('CREATE POLICY "refunds_tenant_owner"');
    expect(sql).toContain('CREATE POLICY "documents_tenant_owner"');
    expect(sql).toContain("EXISTS (");
    expect(sql).toContain('CREATE POLICY "idempotency_keys_owner"');
    expect(sql).toMatch(
      /CREATE POLICY "idempotency_keys_owner"[\s\S]*?app\.user_id/,
    );
    expect(sql).toContain('CREATE POLICY "exchange_rates_global_read"');
    expect(sql).toContain('CREATE POLICY "exchange_rates_rates_global"');
    expect(sql).toMatch(
      /CREATE POLICY "exchange_rates_rates_global"[\s\S]*?app\.rates_global/,
    );
    expect(sql).toContain('CREATE POLICY "notification_logs_tenant"');
  });

  it("permite a la plataforma escribir solo tasas globales, sin borrar", () => {
    const migration = readMigrations().find(({ name }) =>
      name.endsWith("_exchange_rates_platform_global_write"),
    );
    const sql = stripSqlComments(migration?.sql ?? "");

    // La política anterior (solo SELECT) se sustituye por lectura total y
    // escritura limitada a las filas globales (`tenant_id` NULL).
    expect(sql).toContain('DROP POLICY "exchange_rates_platform" ON "exchange_rates"');
    expect(sql).toContain('CREATE POLICY "exchange_rates_platform_read"');
    expect(sql).toMatch(
      /CREATE POLICY "exchange_rates_platform_read"[\s\S]*?FOR SELECT[\s\S]*?app\.platform/,
    );
    expect(sql).toMatch(
      /CREATE POLICY "exchange_rates_platform_insert"[\s\S]*?FOR INSERT[\s\S]*?app\.platform[\s\S]*?"tenant_id" IS NULL/,
    );
    expect(sql).toMatch(
      /CREATE POLICY "exchange_rates_platform_update"[\s\S]*?FOR UPDATE[\s\S]*?app\.platform[\s\S]*?"tenant_id" IS NULL/,
    );
    expect(sql).not.toContain("FOR DELETE");
    expect(sql).not.toContain('CREATE POLICY "exchange_rates_platform_delete"');
  });

  it("permite a la plataforma leer las tablas de negocio, sin escribir", () => {
    const migration = readMigrations().find(({ name }) =>
      name.endsWith("_business_platform_read"),
    );
    expect(migration).toBeDefined();
    const sql = stripSqlComments(migration?.sql ?? "");

    for (const table of ["bookings", "booking_items", "payments", "refunds", "documents"]) {
      expect(sql).toMatch(
        new RegExp(
          `CREATE POLICY "${table}_platform" ON "${table}"[\\s\\S]*?FOR SELECT[\\s\\S]*?app\\.platform`,
        ),
      );
    }
    // Solo lectura: ni INSERT, ni UPDATE, ni DELETE para el contexto de
    // plataforma sobre las tablas de negocio.
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/);
  });

  it("congela precios, identidad y reembolsos con triggers", () => {
    const migration = transactionsMigration();
    const sql = stripSqlComments(migration?.sql ?? "");

    expect(sql).toContain('CREATE FUNCTION "bookings_identity_immutable"');
    expect(sql).toContain('CREATE TRIGGER "bookings_identity_immutable"');
    expect(sql).toContain('CREATE FUNCTION "bookings_validate_travelers"');
    expect(sql).toContain('CREATE FUNCTION "booking_items_frozen"');
    expect(sql).toContain('CREATE TRIGGER "booking_items_frozen"');
    expect(sql).toContain('CREATE FUNCTION "payments_frozen"');
    expect(sql).toContain('CREATE TRIGGER "payments_frozen"');
    expect(sql).toContain('CREATE FUNCTION "documents_identity_immutable"');
    expect(sql).toContain('CREATE TRIGGER "documents_identity_immutable"');
    expect(sql).toContain('CREATE FUNCTION "refunds_append_only"');
    expect(sql).toContain('CREATE TRIGGER "refunds_append_only"');
    expect(sql).toContain('CREATE FUNCTION "refunds_limit_sum"');
    expect(sql).toContain('REVOKE UPDATE, DELETE ON "refunds" FROM caribe_app');
  });
});

interface SchemaColumn {
  table: string;
  column: string;
  nullable: boolean;
}

/**
 * Columnas escalares declaradas en `schema.prisma`: modelo -> tabla con
 * `@@map`, campo -> columna con `@map`. Las relaciones y las listas no son
 * columnas: se descartan comparando el tipo contra los nombres de modelo.
 */
function parseSchemaColumns(schema: string): SchemaColumn[] {
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  const modelNames = new Set(models.map((match) => match[1]));
  const columns: SchemaColumn[] = [];
  for (const match of models) {
    const modelName = match[1] ?? "";
    const body = match[2] ?? "";
    const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? modelName;
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const field = /^(\w+)\s+(\w+)(\[\])?(\?)?/.exec(line);
      if (!field) continue;
      const [, fieldName = "", typeName = "", list, optional] = field;
      if (list || modelNames.has(typeName)) continue;
      const column = /@map\("([^"]+)"\)/.exec(line)?.[1] ?? fieldName;
      columns.push({ table, column, nullable: optional === "?" });
    }
  }
  return columns;
}

/**
 * Comparación esquema <-> base de datos (T-F1-1a): `prisma migrate diff`
 * comprueba que las migraciones producen el esquema, y este test comprueba
 * que la BD realmente migrada coincide columna a columna con lo declarado
 * (incluida la nulabilidad). CI aplica las migraciones antes de `pnpm test`.
 */
describe("esquema Prisma vs base de datos migrada", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it("cada columna del esquema existe con la misma nulabilidad y no sobran columnas", async () => {
    const schema = readFileSync(schemaPath, "utf-8");
    const expected = parseSchemaColumns(schema);
    // No puede pasar en vacío: si el parser deja de encontrar modelos, el
    // test no probaría nada.
    expect(expected.length).toBeGreaterThan(50);

    const { rows } = await client.query<{
      table_name: string;
      column_name: string;
      is_nullable: "YES" | "NO";
    }>(
      `SELECT table_name, column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'`,
    );
    const actual = new Map(
      rows.map((row) => [`${row.table_name}.${row.column_name}`, row.is_nullable === "YES"]),
    );

    const missing = expected
      .filter((column) => !actual.has(`${column.table}.${column.column}`))
      .map((column) => `${column.table}.${column.column}`);
    expect(missing, `columnas del esquema ausentes en la BD: ${missing.join(", ")}`).toEqual([]);

    const nullability = expected
      .filter((column) => actual.get(`${column.table}.${column.column}`) !== column.nullable)
      .map((column) => `${column.table}.${column.column}`);
    expect(
      nullability,
      `columnas con nulabilidad distinta al esquema: ${nullability.join(", ")}`,
    ).toEqual([]);

    const expectedKeys = new Set(expected.map((column) => `${column.table}.${column.column}`));
    const extra = [...actual.keys()].filter((key) => !expectedKeys.has(key));
    expect(extra, `columnas en la BD sin modelo en schema.prisma: ${extra.join(", ")}`).toEqual([]);
  });
});

describe("src/prisma.ts", () => {
  it("exporta un singleton de PrismaClient con el adaptador pg", () => {
    const source = readFileSync(join(apiDir, "src", "prisma.ts"), "utf-8");
    expect(source).toContain("PrismaPg");
    expect(source).toMatch(/new PrismaClient\(\{\s*adapter/);
  });
});
