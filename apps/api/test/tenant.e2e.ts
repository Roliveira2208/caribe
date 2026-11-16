import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { Client } from "pg";
import { auth } from "../src/auth.js";
import { prisma } from "../src/prisma.js";
import { TenantService } from "../src/tenant/tenant.service.js";

/**
 * E2E de aislamiento entre tenants (T-F0-7, spec auth-access "Aislamiento
 * entre tenants"): dos agencias reales, filas de auditoria por tenant y por
 * plataforma, y las politicas RLS de PostgreSQL aplicando.
 *
 * Las consultas van como el rol real de la aplicacion: la conexion abre con
 * DATABASE_URL (dueno/superusuario, que monta los datos) y ejecuta SET ROLE
 * caribe_app, que es NOBYPASSRLS y no duena de las tablas: las politicas
 * siempre le aplican. Asi se prueba RLS sin contrasenas en el repositorio,
 * tanto local (caribe_dev) como en CI (caribe_ci).
 *
 * El escenario HTTP literal ("pide un producto de la agencia B -> 404")
 * llega con el catalogo en F1; hoy se prueba el mismo mecanismo sobre
 * audit_logs, la unica tabla con tenant_id de F0, y el 404 traduce en la
 * capa de servicio de T-F0-9/F1.
 *
 * Una prueba consulta audit_logs sin ningun predicado de tenant: la politica
 * RLS aísla por si sola y el `where tenant_id` de los handlers queda como
 * defensa en profundidad, no como sustituto (refuerzo pedido por el dueno
 * tras aprobar T-F0-9).
 */
describe("aislamiento entre tenants (RLS)", () => {
  const password = "Password123!";
  const suffix = randomUUID().slice(0, 8);
  let client: Client;
  let orgA: string;
  let orgB: string;
  let ownerA: string;
  let ownerB: string;
  let rowA1: string;
  let rowA2: string;
  let rowB: string;
  let rowPlatform: string;
  let bookingA: string;
  let bookingB: string;

  beforeAll(async () => {
    // Dos agencias como accion de sistema (misma via que el seed y el e2e de
    // auth); las filas se montan por Prisma como dueno, que no pasa por RLS.
    ownerA = await signUp(`owner-rls-a-${suffix}@example.com`);
    ownerB = await signUp(`owner-rls-b-${suffix}@example.com`);
    orgA = (
      await auth.api.createOrganization({
        body: { name: `Agencia RLS A ${suffix}`, slug: `agencia-rls-a-${suffix}`, userId: ownerA },
      })
    ).id;
    orgB = (
      await auth.api.createOrganization({
        body: { name: `Agencia RLS B ${suffix}`, slug: `agencia-rls-b-${suffix}`, userId: ownerB },
      })
    ).id;
    rowA1 = randomUUID();
    rowA2 = randomUUID();
    rowB = randomUUID();
    rowPlatform = randomUUID();
    await prisma.auditLog.createMany({
      data: [
        { id: rowA1, tenantId: orgA, action: "test.a", entity: "test", entityId: `a1-${suffix}` },
        { id: rowA2, tenantId: orgA, action: "test.a", entity: "test", entityId: `a2-${suffix}` },
        { id: rowB, tenantId: orgB, action: "test.b", entity: "test", entityId: `b-${suffix}` },
        {
          id: rowPlatform,
          tenantId: null,
          action: "test.platform",
          entity: "test",
          entityId: `platform-${suffix}`,
        },
      ],
    });

    bookingA = randomUUID();
    bookingB = randomUUID();
    await prisma.booking.createMany({
      data: [
        {
          id: bookingA,
          tenantId: orgA,
          code: `CRB-${suffix.toUpperCase()}`,
          userId: ownerA,
          totalUsd: "100.00",
          travelers: [{ fullName: "Viajero RLS A" }],
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
        },
        {
          id: bookingB,
          tenantId: orgB,
          code: `CRB-${randomUUID().slice(0, 8).toUpperCase()}`,
          userId: ownerB,
          totalUsd: "100.00",
          travelers: [{ fullName: "Viajero RLS B" }],
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
        },
      ],
    });

    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("SET ROLE caribe_app");
  });

  afterAll(async () => {
    await client?.end();
    await prisma.$disconnect();
  });

  /** Filas de auditoria de esta corrida (corridas previas conviven en la tabla). */
  async function runRows(c: Client): Promise<string[]> {
    const { rows } = await c.query<{ id: string }>(
      "SELECT id FROM audit_logs WHERE entity_id LIKE $1 ORDER BY id",
      [`%${suffix}%`],
    );
    return rows.map((row) => row.id);
  }

  /** Ejecuta fn como caribe_app en su propia transaccion con los GUC pedidos. */
  async function asCaribeApp<T>(
    guc:
      | {
          tenantId?: string;
          userId?: string;
          platform?: boolean;
          public?: boolean;
          ratesGlobal?: boolean;
        }
      | undefined,
    fn: (c: Client) => Promise<T>,
  ): Promise<T> {
    await client.query("BEGIN");
    try {
      if (guc?.tenantId) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [guc.tenantId]);
      }
      if (guc?.userId) {
        await client.query("SELECT set_config('app.user_id', $1, true)", [guc.userId]);
      }
      if (guc?.platform) {
        await client.query("SELECT set_config('app.platform', 'on', true)");
      }
      if (guc?.public) {
        await client.query("SELECT set_config('app.public', 'on', true)");
      }
      if (guc?.ratesGlobal) {
        await client.query("SELECT set_config('app.rates_global', 'on', true)");
      }
      return await fn(client);
    } finally {
      await client.query("ROLLBACK");
    }
  }

  describe("lectura filtrada por RLS", () => {
    it("caribe_app es NOBYPASSRLS y no superusuario: las politicas siempre le aplican", async () => {
      // Precondicion del patron SET ROLE: si alguien alterara el rol
      // (BYPASSRLS, superusuario), el resto del archivo dejaria de probar
      // RLS sin fallar, asi que se fija en pg_roles.
      const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      );
      expect(rows[0]?.rolsuper).toBe(false);
      expect(rows[0]?.rolbypassrls).toBe(false);
    });

    it("el contexto de la agencia A solo ve las filas de A", async () => {
      const rows = await asCaribeApp({ tenantId: orgA }, runRows);
      expect(rows.sort()).toEqual([rowA1, rowA2].sort());
    });

    it("el contexto de la agencia B solo ve las filas de B", async () => {
      const rows = await asCaribeApp({ tenantId: orgB }, runRows);
      expect(rows).toEqual([rowB]);
    });

    it("sin where de tenant: la politica RLS aísla por si sola", async () => {
      // Los handlers consultan con `where tenant_id` como defensa en
      // profundidad; aqui no hay ningun predicado (ni de tenant ni otro):
      // la unica barrera es la politica de PostgreSQL y aun asi solo salen
      // las filas de la agencia del contexto.
      const tenants = await asCaribeApp({ tenantId: orgA }, async (c) => {
        const result = await c.query<{ tenant_id: string }>("SELECT tenant_id FROM audit_logs");
        return result.rows.map((row) => row.tenant_id);
      });
      expect(tenants.length).toBeGreaterThan(0);
      expect([...new Set(tenants)]).toEqual([orgA]);
    });

    it("una fila de B por id es invisible para la agencia A (404 en la capa de servicio)", async () => {
      const rows = await asCaribeApp({ tenantId: orgA }, async (c) => {
        const result = await c.query<{ id: string }>("SELECT id FROM audit_logs WHERE id = $1", [
          rowB,
        ]);
        return result.rows.map((row) => row.id);
      });
      expect(rows).toEqual([]);
    });

    it("el contexto de plataforma ve todas las agencias y las filas de plataforma", async () => {
      const rows = await asCaribeApp({ platform: true }, runRows);
      expect(rows.sort()).toEqual([rowA1, rowA2, rowB, rowPlatform].sort());
    });

    it("sin contexto no se ve nada: fallo cerrado", async () => {
      const rows = await asCaribeApp(undefined, runRows);
      expect(rows).toEqual([]);
    });
  });

  describe("contexto de plataforma sobre las tablas de negocio", () => {
    it("lee las reservas de todas las agencias", async () => {
      const rows = await asCaribeApp({ platform: true }, async (c) => {
        const result = await c.query<{ id: string }>(
          "SELECT id FROM bookings WHERE id = ANY($1::text[]) ORDER BY id",
          [[bookingA, bookingB]],
        );
        return result.rows.map((row) => row.id);
      });
      expect(rows.sort()).toEqual([bookingA, bookingB].sort());
    });

    it("no escribe reservas: el UPDATE no alcanza filas y el INSERT se rechaza", async () => {
      // La política de plataforma es solo SELECT: sin política de UPDATE el
      // UPDATE no ve ninguna fila y sin política de INSERT la base rechaza.
      const updated = await asCaribeApp({ platform: true }, async (c) => {
        const result = await c.query("UPDATE bookings SET status = 'CONFIRMED' WHERE id = $1", [
          bookingA,
        ]);
        return result.rowCount;
      });
      expect(updated).toBe(0);
      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingA },
        select: { status: true },
      });
      expect(booking.status).toBe("PENDING_PAYMENT");

      await expect(
        asCaribeApp({ platform: true }, (c) =>
          c.query(
            `INSERT INTO bookings (id, tenant_id, code, user_id, total_usd, travelers, expires_at)
             VALUES ($1, $2, $3, $4, 100.00, '[{"fullName":"X"}]'::jsonb, now() + interval '1 hour')`,
            [randomUUID(), orgA, `CRB-${randomUUID().slice(0, 8).toUpperCase()}`, ownerA],
          ),
        ),
      ).rejects.toThrow();
    });
  });

  describe("escritura vigilada por WITH CHECK", () => {
    it("la agencia A no puede escribir filas de B", async () => {
      await expect(
        asCaribeApp({ tenantId: orgA }, (c) =>
          c.query(
            "INSERT INTO audit_logs (id, tenant_id, action, entity, entity_id) VALUES ($1, $2, 'test.forge', 'test', $3)",
            [randomUUID(), orgB, `forge-${suffix}`],
          ),
        ),
      ).rejects.toThrow();
    });

    it("la agencia A puede escribir sus propias filas", async () => {
      const own = randomUUID();
      await asCaribeApp({ tenantId: orgA }, async (c) => {
        await c.query(
          "INSERT INTO audit_logs (id, tenant_id, action, entity, entity_id) VALUES ($1, $2, 'test.own', 'test', $3)",
          [own, orgA, `own-${suffix}`],
        );
        const result = await c.query<{ id: string }>("SELECT id FROM audit_logs WHERE id = $1", [
          own,
        ]);
        expect(result.rows.map((row) => row.id)).toEqual([own]);
      });
    });

    it("el contexto de plataforma puede escribir filas de plataforma (tenant_id NULL)", async () => {
      const platformRow = randomUUID();
      await asCaribeApp({ platform: true }, async (c) => {
        await c.query(
          "INSERT INTO audit_logs (id, tenant_id, action, entity, entity_id) VALUES ($1, NULL, 'test.platform-write', 'test', $2)",
          [platformRow, `platform-write-${suffix}`],
        );
        const result = await c.query<{ id: string }>(
          "SELECT id FROM audit_logs WHERE id = $1 AND tenant_id IS NULL",
          [platformRow],
        );
        expect(result.rows.map((row) => row.id)).toEqual([platformRow]);
      });
    });
  });

  describe("TenantService fija el GUC por transaccion", () => {
    const tenantService = new TenantService();

    it("withTenant fija app.tenant_id dentro de la transaccion", async () => {
      const setting = await tenantService.withTenant(orgA, async (tx) => {
        const rows = await tx.$queryRaw<{ v: string | null }[]>`
          SELECT current_setting('app.tenant_id', true) AS v`;
        return rows[0]?.v ?? null;
      });
      expect(setting).toBe(orgA);
    });

    it("withPlatform fija app.platform dentro de la transaccion", async () => {
      const setting = await tenantService.withPlatform(async (tx) => {
        const rows = await tx.$queryRaw<{ v: string | null }[]>`
          SELECT current_setting('app.platform', true) AS v`;
        return rows[0]?.v ?? null;
      });
      expect(setting).toBe("on");
    });

    it("un contexto vacio no ejecuta nada", async () => {
      await expect(
        tenantService.withContext({ kind: "none" }, async () => "no debe correr"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("contextos de datos explícitos (T-F1-0d)", () => {
    it("el contexto de agencia A no ve las filas de plataforma", async () => {
      const rows = await asCaribeApp({ tenantId: orgA }, runRows);
      expect(rows).not.toContain(rowPlatform);
    });

    it("sin contexto tampoco se escribe: WITH CHECK rechaza el INSERT", async () => {
      await expect(
        asCaribeApp(undefined, (c) =>
          c.query(
            "INSERT INTO audit_logs (id, tenant_id, action, entity, entity_id) VALUES ($1, $2, 'test.forge', 'test', $3)",
            [randomUUID(), orgA, `forge-sin-contexto-${suffix}`],
          ),
        ),
      ).rejects.toThrow();
    });

    it("el contexto owner no ve auditoría: no hay política por dueño", async () => {
      // `audit_logs` solo tiene políticas de agencia y de plataforma. Un
      // cliente operando sobre sus propias filas no debe ver auditoría.
      const rows = await asCaribeApp({ userId: ownerA }, runRows);
      expect(rows).toEqual([]);
    });

    it("el contexto public no ve auditoría", async () => {
      const rows = await asCaribeApp({ public: true }, runRows);
      expect(rows).toEqual([]);
    });

    it("el contexto rates_global no ve ni escribe auditoría", async () => {
      const rows = await asCaribeApp({ ratesGlobal: true }, runRows);
      expect(rows).toEqual([]);
      await expect(
        asCaribeApp({ ratesGlobal: true }, (c) =>
          c.query(
            "INSERT INTO audit_logs (id, tenant_id, action, entity, entity_id) VALUES ($1, $2, 'test.forge', 'test', $3)",
            [randomUUID(), orgA, `forge-rates-${suffix}`],
          ),
        ),
      ).rejects.toThrow();
    });
  });

  describe("inventario de tablas con RLS forzada", () => {
    // Tablas que no son de negocio y viven sin RLS: las administra Better Auth
    // con sus propias reglas, y el historial de migraciones de Prisma. Toda
    // tabla nueva que no esté aquí debe traer RLS habilitada y forzada: el
    // inventario falla nombrándola (spec tenant-isolation, "Tabla nueva sin
    // RLS").
    const SIN_RLS = new Set([
      "_prisma_migrations",
      "user",
      "session",
      "account",
      "verification",
      "organization",
      "member",
      "invitation",
      "twoFactor",
    ]);

    async function tables(): Promise<
      Array<{ name: string; rls: boolean; forced: boolean; policies: number }>
    > {
      const { rows } = await client.query<{
        name: string;
        rls: boolean;
        forced: boolean;
        policies: number;
      }>(
        `SELECT c.relname AS name,
                c.relrowsecurity AS rls,
                c.relforcerowsecurity AS forced,
                (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY c.relname`,
      );
      return rows;
    }

    it("toda tabla de negocio tiene RLS habilitada y forzada, con al menos una política", async () => {
      const business = (await tables()).filter((row) => !SIN_RLS.has(row.name));
      expect(business.map((row) => row.name)).toEqual(
        expect.arrayContaining(["audit_logs", "auth_events"]),
      );
      const failures = business
        .filter((row) => !row.rls || !row.forced || row.policies < 1)
        .map(
          (row) => `${row.name} (rls=${row.rls}, forced=${row.forced}, políticas=${row.policies})`,
        );
      expect(
        failures,
        `tablas de negocio sin RLS habilitada y forzada: ${failures.join("; ")}`,
      ).toEqual([]);
    });

    it("la lista de excepciones solo contiene tablas reales", async () => {
      // Una excepción con nombre equivocado escondería una tabla de negocio
      // bajo un nombre que ya no existe; el inventario debe avisar.
      const existing = new Set((await tables()).map((row) => row.name));
      const stale = [...SIN_RLS].filter((name) => !existing.has(name));
      expect(stale, `excepciones de RLS sin tabla: ${stale.join(", ")}`).toEqual([]);
    });
  });

  describe("TenantService: contextos de cliente, catálogo y tasa", () => {
    const tenantService = new TenantService();

    it("withOwner fija app.user_id", async () => {
      const setting = await tenantService.withOwner(ownerA, async (tx) => {
        const rows = await tx.$queryRaw<{ user_id: string | null; tenant_id: string | null }[]>`
          SELECT current_setting('app.user_id', true) AS user_id,
                 current_setting('app.tenant_id', true) AS tenant_id`;
        return rows[0];
      });
      expect(setting?.user_id).toBe(ownerA);
      // El contexto owner no concede agencia: la política de agencia compara
      // contra "" (sin GUC) y nunca coincide con un tenant_id, así que RLS no
      // devuelve filas de la agencia.
      expect(setting?.tenant_id ?? "").toBe("");
    });

    it("withOwnerTenant fija app.tenant_id y app.user_id", async () => {
      const setting = await tenantService.withOwnerTenant(ownerA, orgA, async (tx) => {
        const rows = await tx.$queryRaw<{ user_id: string | null; tenant_id: string | null }[]>`
          SELECT current_setting('app.user_id', true) AS user_id,
                 current_setting('app.tenant_id', true) AS tenant_id`;
        return rows[0];
      });
      expect(setting).toEqual({ user_id: ownerA, tenant_id: orgA });
    });

    it("withPublic fija app.public", async () => {
      const setting = await tenantService.withPublic(async (tx) => {
        const rows = await tx.$queryRaw<{ v: string | null }[]>`
          SELECT current_setting('app.public', true) AS v`;
        return rows[0]?.v ?? null;
      });
      expect(setting).toBe("on");
    });

    it("withRatesGlobal fija app.rates_global", async () => {
      const setting = await tenantService.withRatesGlobal(async (tx) => {
        const rows = await tx.$queryRaw<{ v: string | null }[]>`
          SELECT current_setting('app.rates_global', true) AS v`;
        return rows[0]?.v ?? null;
      });
      expect(setting).toBe("on");
    });

    it("withOwner y withOwnerTenant rechazan identificadores vacíos", async () => {
      await expect(tenantService.withOwner("", async () => "no debe correr")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        tenantService.withOwnerTenant("", orgA, async () => "no debe correr"),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        tenantService.withOwnerTenant(ownerA, "", async () => "no debe correr"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("withContext despacha cada contexto explícito", async () => {
      const kinds = await Promise.all([
        tenantService.withContext({ kind: "owner", userId: ownerA }, (tx) =>
          tx.$queryRaw<{ v: string | null }[]>`SELECT current_setting('app.user_id', true) AS v`,
        ),
        tenantService.withContext({ kind: "public" }, (tx) =>
          tx.$queryRaw<{ v: string | null }[]>`SELECT current_setting('app.public', true) AS v`,
        ),
        tenantService.withContext({ kind: "rates_global" }, (tx) =>
          tx.$queryRaw<{ v: string | null }[]>`SELECT current_setting('app.rates_global', true) AS v`,
        ),
      ]);
      expect(kinds.map((rows) => rows[0]?.v)).toEqual([ownerA, "on", "on"]);
    });
  });

  async function signUp(email: string): Promise<string> {
    const { user } = await auth.api.signUpEmail({
      body: { name: `Usuario ${suffix}`, email, password },
    });
    return user.id;
  }
});
