import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
});

describe("src/prisma.ts", () => {
  it("exporta un singleton de PrismaClient con el adaptador pg", () => {
    const source = readFileSync(join(apiDir, "src", "prisma.ts"), "utf-8");
    expect(source).toContain("PrismaPg");
    expect(source).toMatch(/new PrismaClient\(\{\s*adapter/);
  });
});
