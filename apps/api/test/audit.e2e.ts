import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  adminRole,
  agentRole,
  memberRole,
  ownerRole,
  providerRole,
  systemUserRole,
} from "../src/access.js";
import { AGENCY_AUDIT_READER_ROLES } from "../src/audit/audit-access.js";
import { AuditService } from "../src/audit/audit.service.js";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { prisma } from "../src/prisma.js";
import {
  addMember,
  authOrigin,
  createAgency,
  createUser,
  setActiveOrg,
  signIn,
  userWithTotp,
} from "./auth-helpers.js";

/**
 * E2E de auditoria (T-F0-9, specs/audit + delta de f0-foundations).
 *
 * Cubre: la accion sensible de agencia deja fila con actor/accion/antes/
 * despues/IP (escenario "Admin aprueba un pago", con la accion de ejemplo del
 * override de tasas), el alcance de lectura (agente 403, admin de agencia solo
 * su tenant y nunca las filas de plataforma, super admin todo), la accion de
 * plataforma con tenant_id NULL (delta "Super Admin crea una agencia") con
 * actor/IP/fecha tomados de la sesion y no del body, la misma transaccion de
 * operacion y auditoria, la inmutabilidad de BD (permisos + trigger,
 * ejecutada como caribe_app siempre que el rol la puede ejercitar; el caso
 * "incluso el dueno" queda como dueno), la igualdad de las filas de
 * POST /admin/organizations con las de createOrganization de Better Auth
 * (refuerzo pedido por el dueno tras aprobar T-F0-9) y, desde el fix de la
 * verificacion f0-foundations, la auditoria de las escrituras
 * administrativas del middleware de Better Auth (delta "Auditoria de las
 * escrituras administrativas de Better Auth": invite-member del owner deja
 * fila con su agencia como tenant).
 */
describe("audit: rastro inmutable (T-F0-9)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  const suffix = randomUUID().slice(0, 8);
  let startedAt: number;

  let orgA: string;
  let orgB: string;
  let adminAId: string;
  let adminACookie: string;
  let agentACookie: string;
  let superAdminId: string;
  let superCookie: string;
  let createdOrgId: string;

  beforeAll(async () => {
    startedAt = Date.now();
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    // Agencia A: owner (via alta de sistema) + admin y agente como miembros.
    const ownerA = await createUser(`owner-audit-a-${suffix}@example.com`);
    orgA = (await createAgency(ownerA, `Agencia AUDIT A ${suffix}`, `agencia-audit-a-${suffix}`))
      .id;
    const adminA = await userWithTotp(baseUrl, `admin-audit-a-${suffix}@example.com`);
    adminAId = adminA.userId;
    await addMember(orgA, adminAId, "admin");
    adminACookie = adminA.cookie;
    await setActiveOrg(baseUrl, adminACookie, orgA);

    const agentAId = await createUser(`agent-audit-a-${suffix}@example.com`);
    await addMember(orgA, agentAId, "agent");
    agentACookie = await signIn(baseUrl, `agent-audit-a-${suffix}@example.com`);
    await setActiveOrg(baseUrl, agentACookie, orgA);

    // Agencia B: solo para tener filas de otro tenant que A no debe ver.
    const ownerB = await createUser(`owner-audit-b-${suffix}@example.com`);
    orgB = (await createAgency(ownerB, `Agencia AUDIT B ${suffix}`, `agencia-audit-b-${suffix}`))
      .id;

    // Super Admin de plataforma con TOTP (las rutas /admin lo exigen).
    const superAdmin = await userWithTotp(baseUrl, `super-audit-${suffix}@example.com`);
    superAdminId = superAdmin.userId;
    await prisma.user.update({ where: { id: superAdminId }, data: { role: "super_admin" } });
    superCookie = superAdmin.cookie;

    // Filas montadas directamente (como el e2e de tenants): una de la agencia
    // B y una de plataforma (tenant_id NULL). El superusuario de las pruebas
    // no pasa por RLS al montar datos.
    await prisma.auditLog.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId: orgB,
          action: "test.b",
          entity: "test",
          entityId: `b-${suffix}`,
        },
        {
          id: randomUUID(),
          tenantId: null,
          action: "test.platform",
          entity: "test",
          entityId: `platform-${suffix}`,
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("accion sensible de agencia (endpoint de ejemplo)", () => {
    it("deja fila con actor, accion, antes, despues, IP y fecha de la sesion", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/exchange-rates/override`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: adminACookie, origin: authOrigin },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ overridden: true });

      const row = await prisma.auditLog.findFirstOrThrow({
        where: { action: "exchange-rate.override", entityId: orgA },
      });
      expect(row.tenantId).toBe(orgA);
      expect(row.actorId).toBe(adminAId);
      expect(row.entity).toBe("exchange-rate");
      // F0 no tiene tabla de tasas: el ejemplo registra "sin override" ->
      // "con override". F2 (specs/payments) sustituira por el estado real.
      expect(row.before).toBe(null);
      expect(row.after).toEqual({ overridden: true });
      expect(row.ip).toBeTruthy();
      expect(row.at.getTime()).toBeGreaterThanOrEqual(startedAt);
    });
  });

  describe("alcance de lectura (GET /admin/audit-logs)", () => {
    it("los lectores de agencia son owner y admin, segun la matriz T-F0-6", () => {
      for (const role of [ownerRole, adminRole]) {
        expect(role.authorize({ audit: ["read"] }).success).toBe(true);
      }
      for (const role of [agentRole, providerRole, memberRole, systemUserRole]) {
        expect(role.authorize({ audit: ["read"] }).success).toBe(false);
      }
      expect([...AGENCY_AUDIT_READER_ROLES].sort()).toEqual(["admin", "owner"]);
    });

    it("agente consulta auditoria -> 403", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/audit-logs`, {
        headers: { cookie: agentACookie, origin: authOrigin },
      });
      expect(res.status).toBe(403);
    });

    it("admin de agencia solo recibe las filas de su agencia (nunca las de plataforma)", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/audit-logs`, {
        headers: { cookie: adminACookie, origin: authOrigin },
      });
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as {
        items: Array<{ tenantId: string | null; action: string; entityId: string }>;
      };
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.tenantId === orgA)).toBe(true);
      expect(items.some((item) => item.action === "exchange-rate.override")).toBe(true);
      expect(items.some((item) => item.tenantId === null)).toBe(false);
      expect(items.some((item) => item.entityId === `b-${suffix}`)).toBe(false);
    });

    it("super admin recibe las filas de plataforma y las de todas las agencias", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/audit-logs`, {
        headers: { cookie: superCookie, origin: authOrigin },
      });
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as {
        items: Array<{ tenantId: string | null; entityId: string }>;
      };
      const entityIds = items.map((item) => item.entityId);
      // Fila de plataforma montada, fila de la agencia A (override), fila de
      // la agencia B y la fila NULL de la agencia creada por el super admin.
      expect(entityIds).toContain(`platform-${suffix}`);
      expect(entityIds).toContain(`b-${suffix}`);
      expect(items.some((item) => item.tenantId === orgA)).toBe(true);
      expect(items.some((item) => item.tenantId === null)).toBe(true);
    });
  });

  describe("accion de plataforma (delta: Super Admin crea una agencia)", () => {
    it("crea la agencia y audita con tenant_id NULL; actor/IP/fecha de la sesion, no del body", async () => {
      const slug = `agencia-sup-${suffix}`;
      const res = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: superCookie, origin: authOrigin },
        // El body intenta suplantar actor, IP y fecha: el interceptor los
        // toma de la sesion verificada y del servidor, nunca del body.
        body: JSON.stringify({
          name: `Agencia Super ${suffix}`,
          slug,
          actor_id: "intruso",
          actorId: "intruso",
          ip: "1.2.3.4",
          at: "2000-01-01T00:00:00.000Z",
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; slug: string };
      createdOrgId = body.id;

      const org = await prisma.organization.findUnique({ where: { id: createdOrgId } });
      expect(org?.slug).toBe(slug);
      const ownerMember = await prisma.member.findFirst({
        where: { organizationId: createdOrgId, userId: superAdminId },
      });
      expect(ownerMember?.role).toBe("owner");

      const row = await prisma.auditLog.findFirstOrThrow({
        where: { action: "organization.create", entityId: createdOrgId },
      });
      expect(row.tenantId).toBe(null);
      expect(row.actorId).toBe(superAdminId);
      expect(row.entity).toBe("organization");
      expect(row.before).toBe(null);
      expect(row.after).toMatchObject({ id: createdOrgId, slug });
      expect(row.ip).toBeTruthy();
      expect(row.ip).not.toBe("1.2.3.4");
      expect(row.at.getTime()).toBeGreaterThanOrEqual(startedAt);
    });

    it("sin rol de plataforma -> 403 y no queda agencia ni fila", async () => {
      const rowsBefore = await prisma.auditLog.count({ where: { action: "organization.create" } });
      const res = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminACookie, origin: authOrigin },
        body: JSON.stringify({ name: "Agencia no permitida", slug: `agencia-x-${suffix}` }),
      });
      expect(res.status).toBe(403);
      await expect(
        prisma.organization.findUnique({ where: { slug: `agencia-x-${suffix}` } }),
      ).resolves.toBeNull();
      expect(await prisma.auditLog.count({ where: { action: "organization.create" } })).toBe(
        rowsBefore,
      );
    });

    it("body invalido -> 400 sin agencia ni fila de auditoria", async () => {
      const rowsBefore = await prisma.auditLog.count({ where: { action: "organization.create" } });
      const missing = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: superCookie, origin: authOrigin },
        body: JSON.stringify({ slug: `agencia-y-${suffix}` }),
      });
      expect(missing.status).toBe(400);
      await expect(
        prisma.organization.findUnique({ where: { slug: `agencia-y-${suffix}` } }),
      ).resolves.toBeNull();

      const duplicate = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: superCookie, origin: authOrigin },
        body: JSON.stringify({ name: "Duplicada", slug: `agencia-sup-${suffix}` }),
      });
      expect(duplicate.status).toBe(409);
      expect(await prisma.auditLog.count({ where: { action: "organization.create" } })).toBe(
        rowsBefore,
      );
    });

    it("super admin recibe las filas de plataforma y las de todas las agencias", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/audit-logs`, {
        headers: { cookie: superCookie, origin: authOrigin },
      });
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as {
        items: Array<{ tenantId: string | null; entityId: string }>;
      };
      const entityIds = items.map((item) => item.entityId);
      // Fila de plataforma montada, fila de la agencia A (override), fila de
      // la agencia B y la fila NULL de la agencia creada por este super admin.
      expect(entityIds).toContain(`platform-${suffix}`);
      expect(entityIds).toContain(`b-${suffix}`);
      expect(entityIds).toContain(createdOrgId);
      expect(items.some((item) => item.tenantId === orgA)).toBe(true);
      expect(items.some((item) => item.tenantId === null)).toBe(true);
    });
  });

  describe("escrituras administrativas de Better Auth (delta del fix de verificación)", () => {
    it("owner invita a un miembro y la escritura deja fila con su agencia como tenant", async () => {
      const owner = await userWithTotp(baseUrl, `owner-inv-audit-${suffix}@example.com`);
      const org = await createAgency(owner.userId, `Agencia INV ${suffix}`, `agencia-inv-${suffix}`);
      await setActiveOrg(baseUrl, owner.cookie, org.id);

      const res = await fetch(`${baseUrl}/api/auth/organization/invite-member`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie, origin: authOrigin },
        body: JSON.stringify({
          email: `invitado-inv-${suffix}@example.com`,
          role: "provider",
          organizationId: org.id,
        }),
      });
      expect(res.status).toBe(200);
      const invitation = (await res.json()) as { id: string };

      const row = await prisma.auditLog.findFirstOrThrow({
        where: { action: "auth.organization.invite-member", entityId: invitation.id },
      });
      expect(row.tenantId).toBe(org.id);
      expect(row.actorId).toBe(owner.userId);
      expect(row.entity).toBe("invitation");
      // El middleware solo observa el resultado: antes NULL (delta de audit,
      // la fila va en transaccion propia tras confirmarse la escritura).
      expect(row.before).toBe(null);
      expect(row.after).toMatchObject({ id: invitation.id });
      expect(row.ip).toBeTruthy();
      expect(row.at.getTime()).toBeGreaterThanOrEqual(startedAt);
    });
  });

  describe("divergencia con createOrganization de Better Auth", () => {
    /**
     * El endpoint replica a mano los INSERT de la lib (que usa su propia
     * conexion y no puede entrar en la transaccion de auditoria). Si una
     * actualizacion de better-auth cambiara lo que escribe createOrganization,
     * este test rompe y toca alinear el endpoint: se crea una agencia por cada
     * via con el mismo creador y se comparan las filas de organization y
     * member en forma (columnas pobladas, tipos, rol del creador, un solo
     * miembro), no en valores (nombre/slug/id son distintos por definicion).
     */
    it("POST /admin/organizations deja las mismas filas que auth.api.createOrganization", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: superCookie, origin: authOrigin },
        body: JSON.stringify({
          name: `Agencia Divergencia HTTP ${suffix}`,
          slug: `agencia-div-http-${suffix}`,
        }),
      });
      expect(res.status).toBe(201);
      const { id: orgHttpId } = (await res.json()) as { id: string };

      const orgLib = await createAgency(
        superAdminId,
        `Agencia Divergencia Lib ${suffix}`,
        `agencia-div-lib-${suffix}`,
      );

      const orgs = await Promise.all([
        prisma.organization.findUniqueOrThrow({ where: { id: orgHttpId } }),
        prisma.organization.findUniqueOrThrow({ where: { id: orgLib.id } }),
      ]);
      expect(orgShape(orgs[0])).toEqual(orgShape(orgs[1]));

      const members = await Promise.all([
        prisma.member.findFirstOrThrow({ where: { organizationId: orgHttpId } }),
        prisma.member.findFirstOrThrow({ where: { organizationId: orgLib.id } }),
      ]);
      expect(memberShape(members[0])).toEqual(memberShape(members[1]));
      expect(members[0].role).toBe("owner");
      expect(members[1].role).toBe("owner");

      // Ninguna de las dos vias deja miembros extra (equipos, invitaciones).
      expect(await prisma.member.count({ where: { organizationId: orgHttpId } })).toBe(1);
      expect(await prisma.member.count({ where: { organizationId: orgLib.id } })).toBe(1);
    });

    /** Forma comparable de una fila de organization (logo/metadata van NULL). */
    function orgShape(org: { logo: string | null; metadata: string | null; createdAt: Date }) {
      return {
        logo: org.logo,
        metadata: org.metadata,
        createdAt: org.createdAt instanceof Date,
      };
    }

    /** Forma comparable de una fila de member (mismo creador y rol en ambas). */
    function memberShape(member: { role: string; userId: string; createdAt: Date }) {
      return {
        role: member.role,
        userId: member.userId,
        createdAt: member.createdAt instanceof Date,
      };
    }
  });

  describe("auditoria y operacion comparten transaccion", () => {
    const auditService = new AuditService();

    it("si la escritura de auditoria falla, la operacion no se confirma", async () => {
      const member = await prisma.member.findFirstOrThrow({
        where: { organizationId: orgA, userId: adminAId },
      });
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.member.update({ where: { id: member.id }, data: { role: "agent" } });
          await auditService.record(tx, {
            tenantId: orgA,
            actorId: adminAId,
            action: "member.role-change",
            // entity null fuerza el fallo de la escritura de auditoria.
            entity: null as unknown as string,
            entityId: member.id,
            before: { role: "admin" },
            after: { role: "agent" },
          });
        }),
      ).rejects.toThrow();
      const unchanged = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
      expect(unchanged.role).toBe("admin");
    });

    it("record redacta claves sensibles antes de escribir", async () => {
      const entityId = `sanitize-${suffix}`;
      const row = await prisma.$transaction(async (tx) => {
        await auditService.record(tx, {
          tenantId: orgA,
          actorId: adminAId,
          action: "test.sanitize",
          entity: "test",
          entityId,
          before: { password: "Password123!", note: "visible" },
          after: { cardNumber: "4111111111111111" },
        });
        return tx.auditLog.findFirstOrThrow({ where: { entityId } });
      });
      expect(row.before).toEqual({ password: "[redacted]", note: "visible" });
      expect(row.after).toEqual({ cardNumber: "[redacted]" });
    });
  });

  describe("inmutabilidad de audit_logs (permisos de BD + trigger)", () => {
    let client: Client;

    beforeAll(async () => {
      client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
    });

    afterAll(async () => {
      await client?.end();
    });

    it("caribe_app: INSERT y SELECT permitidos; UPDATE y DELETE rechazados", async () => {
      await client.query("SET ROLE caribe_app");
      const id = randomUUID();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.platform', 'on', true)");
        await client.query(
          "INSERT INTO audit_logs (id, tenant_id, action, entity, entity_id) VALUES ($1, NULL, 'test.immutable', 'test', $2)",
          [id, `immutable-${suffix}`],
        );
        const read = await client.query<{ count: string }>(
          "SELECT count(*) AS count FROM audit_logs WHERE id = $1",
          [id],
        );
        expect(read.rows[0]?.count).toBe("1");

        // Savepoints: la primera sentencia fallida aborta la transaccion y la
        // segunda seguiria fallando por la transaccion abortada, no por
        // permisos.
        await client.query("SAVEPOINT upd");
        await expect(
          client.query("UPDATE audit_logs SET action = 'test.tamper' WHERE id = $1", [id]),
        ).rejects.toThrow(/permission denied/i);
        await client.query("ROLLBACK TO SAVEPOINT upd");
        await client.query("SAVEPOINT del");
        await expect(client.query("DELETE FROM audit_logs WHERE id = $1", [id])).rejects.toThrow(
          /permission denied/i,
        );
        await client.query("ROLLBACK TO SAVEPOINT del");
      } finally {
        await client.query("ROLLBACK");
        await client.query("RESET ROLE");
      }
    });

    it("el trigger rechaza UPDATE y DELETE para caribe_app si recibiera privilegios (GRANT solo dentro de la transaccion)", async () => {
      const id = randomUUID();
      try {
        await client.query("RESET ROLE");
        await client.query("BEGIN");
        // Con el REVOKE vigente, caribe_app recibe permission denied y nunca
        // llega al trigger (primera capa funcionando, probada arriba). Para
        // ejercitar la SEGUNDA capa con el rol real de la aplicacion se le
        // devuelve el privilegio solo dentro de esta transaccion: es el
        // escenario de un GRANT accidental que el trigger tiene que seguir
        // bloqueando. El ROLLBACK final deshace el GRANT.
        await client.query("GRANT UPDATE, DELETE ON audit_logs TO caribe_app");
        await client.query("SET ROLE caribe_app");
        await client.query("SELECT set_config('app.platform', 'on', true)");
        await client.query(
          "INSERT INTO audit_logs (id, tenant_id, action, entity, entity_id) VALUES ($1, NULL, 'test.grant', 'test', $2)",
          [id, `grant-${suffix}`],
        );
        await client.query("SAVEPOINT upd");
        await expect(
          client.query("UPDATE audit_logs SET action = 'test.tamper' WHERE id = $1", [id]),
        ).rejects.toThrow(/audit_logs es inmutable/i);
        await client.query("ROLLBACK TO SAVEPOINT upd");
        await client.query("SAVEPOINT del");
        await expect(client.query("DELETE FROM audit_logs WHERE id = $1", [id])).rejects.toThrow(
          /audit_logs es inmutable/i,
        );
        await client.query("ROLLBACK TO SAVEPOINT del");
      } finally {
        await client.query("ROLLBACK");
        await client.query("RESET ROLE");
      }
      // El GRANT transitorio quedo deshecho: el rol vuelve a estar sin UPDATE.
      const restored = await client.query<{ ok: boolean }>(
        "SELECT has_table_privilege('caribe_app', 'audit_logs', 'UPDATE') AS ok",
      );
      expect(restored.rows[0]?.ok).toBe(false);
    });

    it("el trigger rechaza UPDATE y DELETE incluso para el dueno de la tabla", async () => {
      // El unico caso que no puede ejecutar como caribe_app: el dueno de la
      // tabla es el rol con privilegios estables, la clase de rol que el
      // trigger defiende (caribe_app sin privilegios la prueba arriba, y con
      // un GRANT accidental, en el test anterior). Cada capa se prueba con
      // el rol que la alcanza.
      const id = randomUUID();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO audit_logs (id, tenant_id, action, entity, entity_id) VALUES ($1, NULL, 'test.trigger', 'test', $2)",
          [id, `trigger-${suffix}`],
        );
        await client.query("SAVEPOINT upd");
        await expect(
          client.query("UPDATE audit_logs SET action = 'test.tamper' WHERE id = $1", [id]),
        ).rejects.toThrow(/audit_logs es inmutable/i);
        await client.query("ROLLBACK TO SAVEPOINT upd");
        await client.query("SAVEPOINT del");
        await expect(client.query("DELETE FROM audit_logs WHERE id = $1", [id])).rejects.toThrow(
          /audit_logs es inmutable/i,
        );
        await client.query("ROLLBACK TO SAVEPOINT del");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });
});
