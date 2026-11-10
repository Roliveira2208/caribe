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
  let rowA1: string;
  let rowA2: string;
  let rowB: string;
  let rowPlatform: string;

  beforeAll(async () => {
    // Dos agencias como accion de sistema (misma via que el seed y el e2e de
    // auth); las filas se montan por Prisma como dueno, que no pasa por RLS.
    const ownerA = await signUp(`owner-rls-a-${suffix}@example.com`);
    const ownerB = await signUp(`owner-rls-b-${suffix}@example.com`);
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

  /** Ejecuta fn como caribe_app en su propia transaccion con el GUC pedido. */
  async function asCaribeApp<T>(
    guc: { tenantId?: string; platform?: boolean } | undefined,
    fn: (c: Client) => Promise<T>,
  ): Promise<T> {
    await client.query("BEGIN");
    try {
      if (guc?.tenantId) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [guc.tenantId]);
      }
      if (guc?.platform) {
        await client.query("SELECT set_config('app.platform', 'on', true)");
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

  async function signUp(email: string): Promise<string> {
    const { user } = await auth.api.signUpEmail({
      body: { name: `Usuario ${suffix}`, email, password },
    });
    return user.id;
  }
});
