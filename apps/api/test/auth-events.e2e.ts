import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import {
  BETTER_AUTH_ADMIN_READ_ONLY_PATHS,
  BETTER_AUTH_ADMIN_ROUTES,
  betterAuthAdminRouteOf,
  isBetterAuthAdminWriteRoute,
} from "../src/admin/admin-route.js";
import { authEventService } from "../src/audit/auth-event.service.js";
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
 * E2E de auth_events (T-F1-0b, delta de audit "Registro de intentos y
 * resultados de acciones administrativas", "Visibilidad de los intentos" y
 * "Consulta de intentos").
 *
 * Cubre: rechazo TOTP (resultado escrito en el catch del before porque el
 * after no corre), escritura administrativa exitosa, error de validación de
 * la lib, peticiones sin sesión, rutas de solo lectura, agencia desconocida,
 * ausencia de secretos, fallo al escribir intento (cerrado) y resultado
 * (best-effort), inmutabilidad de BD, alcance de lectura, filtros, cursor y
 * validación de query. El escenario "Petición limitada" queda fuera de la
 * suite: depende de la ventana del rate limiter y sería intermitente; el
 * rate limiter corre antes de los hooks (sin hooks no hay filas) y eso lo
 * fija el orden del router de Better Auth, no este e2e.
 *
 * Usuarios TOTP: ownerA y superAdmin (el plugin 2FA limita /two-factor/* a 3
 * peticiones por ventana de 10 s y ruta; la suite gasta dos activaciones).
 * admin y agente van sin TOTP para los rechazos y el 403 de lectura.
 */
describe("audit: intentos y resultados de acciones administrativas (T-F1-0b)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  const suffix = randomUUID().slice(0, 8);

  let orgA: string;
  let orgB: string;
  let ownerAId: string;
  let ownerACookie: string;
  let adminNoTotpId: string;
  let adminNoTotpCookie: string;
  let agentCookie: string;
  let superAdminId: string;
  let superCookie: string;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    // Agencia A: owner con TOTP (escrituras de agencia), admin y agente sin TOTP.
    const ownerA = await userWithTotp(baseUrl, `owner-events-${suffix}@example.com`);
    ownerAId = ownerA.userId;
    ownerACookie = ownerA.cookie;
    orgA = (await createAgency(ownerAId, `Agencia EVENTS ${suffix}`, `agencia-events-${suffix}`)).id;
    await setActiveOrg(baseUrl, ownerACookie, orgA);

    adminNoTotpId = await createUser(`admin-events-${suffix}@example.com`);
    await addMember(orgA, adminNoTotpId, "admin");
    adminNoTotpCookie = await signIn(baseUrl, `admin-events-${suffix}@example.com`);
    await setActiveOrg(baseUrl, adminNoTotpCookie, orgA);

    const agentId = await createUser(`agent-events-${suffix}@example.com`);
    await addMember(orgA, agentId, "agent");
    agentCookie = await signIn(baseUrl, `agent-events-${suffix}@example.com`);
    await setActiveOrg(baseUrl, agentCookie, orgA);

    // Super Admin de plataforma con TOTP.
    const superAdmin = await userWithTotp(baseUrl, `super-events-${suffix}@example.com`);
    superAdminId = superAdmin.userId;
    await prisma.user.update({ where: { id: superAdminId }, data: { role: "super_admin" } });
    superCookie = superAdmin.cookie;

    // Agencia B: filas de otro tenant que el admin de A no debe ver.
    const ownerB = await createUser(`owner-events-b-${suffix}@example.com`);
    orgB = (await createAgency(ownerB, `Agencia EVENTS B ${suffix}`, `agencia-events-b-${suffix}`))
      .id;
    await prisma.authEvent.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId: orgB,
          correlationId: `b-attempt-${suffix}`,
          phase: "attempt",
          actorId: ownerB,
          route: "/organization/invite-member",
          method: "POST",
          at: new Date(),
        },
        {
          id: randomUUID(),
          tenantId: orgB,
          correlationId: `b-attempt-${suffix}`,
          phase: "result",
          actorId: ownerB,
          route: "/organization/invite-member",
          method: "POST",
          outcome: "success",
          entity: "invitation",
          entityId: `b-invitation-${suffix}`,
          at: new Date(),
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Petición JSON con cookie opcional. */
  function post(path: string, body: unknown, cookie?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: authOrigin,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  describe("registro de intentos y resultados", () => {
    it("rechazo por falta de segundo factor: attempt + result error TWO_FACTOR_REQUIRED", async () => {
      const res = await post(
        "/api/auth/organization/invite-member",
        {
          email: `invitado-totp-${suffix}@example.com`,
          role: "provider",
          organizationId: orgA,
        },
        adminNoTotpCookie,
      );
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({ code: "TWO_FACTOR_REQUIRED" });

      const attempt = await prisma.authEvent.findFirstOrThrow({
        where: {
          route: "/organization/invite-member",
          phase: "attempt",
          actorId: adminNoTotpId,
        },
        orderBy: { at: "desc" },
      });
      expect(attempt.tenantId).toBe(orgA);
      expect(attempt.method).toBe("POST");
      expect(attempt.ip).toBeTruthy();
      expect(attempt.outcome).toBe(null);

      const result = await prisma.authEvent.findFirstOrThrow({
        where: { correlationId: attempt.correlationId, phase: "result" },
      });
      expect(result.outcome).toBe("error");
      expect(result.errorCode).toBe("TWO_FACTOR_REQUIRED");
      expect(result.errorStatus).toBe(403);
      expect(result.errorName).toBe("APIError");
      expect(result.tenantId).toBe(orgA);
      // El intento rechazado no se ejecuta: no queda invitación.
      await expect(
        prisma.invitation.findFirst({
          where: { email: `invitado-totp-${suffix}@example.com` },
        }),
      ).resolves.toBeNull();
    });

    it("escritura administrativa exitosa: attempt + result success con el mismo correlation_id", async () => {
      const res = await post(
        "/api/auth/organization/invite-member",
        {
          email: `invitado-ok-${suffix}@example.com`,
          role: "provider",
          organizationId: orgA,
        },
        ownerACookie,
      );
      expect(res.status).toBe(200);
      const invitation = (await res.json()) as { id: string };

      const attempt = await prisma.authEvent.findFirstOrThrow({
        where: {
          route: "/organization/invite-member",
          phase: "attempt",
          actorId: ownerAId,
        },
        orderBy: { at: "desc" },
      });
      expect(attempt.tenantId).toBe(orgA);

      const result = await prisma.authEvent.findFirstOrThrow({
        where: { correlationId: attempt.correlationId, phase: "result" },
      });
      expect(result.outcome).toBe("success");
      expect(result.tenantId).toBe(orgA);
      expect(result.entity).toBe("invitation");
      expect(result.entityId).toBe(invitation.id);
      expect(result.errorCode).toBe(null);
      expect(result.errorStatus).toBe(null);
      expect(result.errorName).toBe(null);
    });

    it("error de validación de la lib: result error con el código de validación", async () => {
      const res = await post(
        "/api/auth/organization/invite-member",
        {},
        ownerACookie,
      );
      expect(res.status).toBe(400);

      const attempt = await prisma.authEvent.findFirstOrThrow({
        where: {
          route: "/organization/invite-member",
          phase: "attempt",
          actorId: ownerAId,
        },
        orderBy: { at: "desc" },
      });
      const result = await prisma.authEvent.findFirstOrThrow({
        where: { correlationId: attempt.correlationId, phase: "result" },
      });
      expect(result.outcome).toBe("error");
      expect(result.errorCode).toBe("VALIDATION_ERROR");
      expect(result.errorStatus).toBe(400);
      expect(result.errorName).toBe("APIError");
    });

    it("sin sesión no se escribe ninguna fila", async () => {
      const before = await prisma.authEvent.count({ where: { route: "/admin/ban-user" } });
      const res = await post("/api/auth/admin/ban-user", { userId: ownerAId });
      expect(res.status).toBe(401);
      const after = await prisma.authEvent.count({ where: { route: "/admin/ban-user" } });
      expect(after).toBe(before);
    });

    it("las rutas de solo lectura no generan filas aunque usen POST", async () => {
      const res = await post(
        "/api/auth/admin/list-user-sessions",
        { userId: ownerAId },
        superCookie,
      );
      expect(res.status).toBe(200);
      expect(
        await prisma.authEvent.count({ where: { route: "/admin/list-user-sessions" } }),
      ).toBe(0);
      expect(await prisma.authEvent.count({ where: { route: "/admin/list-users" } })).toBe(0);
    });

    it("agencia desconocida: el intento queda con tenant_id NULL y el resultado con la agencia de la entidad", async () => {
      // cancel-invitation no acepta organizationId: la agencia de la entidad
      // (la invitación) solo se conoce al ejecutar. El intento queda en NULL
      // (solo lo lee el Super Admin) y el resultado en la agencia devuelta.
      const invitationId = randomUUID();
      await prisma.invitation.create({
        data: {
          id: invitationId,
          organizationId: orgA,
          email: `invitado-cancel-${suffix}@example.com`,
          role: "provider",
          status: "pending",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          inviterId: ownerAId,
        },
      });

      const res = await post(
        "/api/auth/organization/cancel-invitation",
        { invitationId },
        ownerACookie,
      );
      expect(res.status).toBe(200);

      const attempt = await prisma.authEvent.findFirstOrThrow({
        where: {
          route: "/organization/cancel-invitation",
          phase: "attempt",
          actorId: ownerAId,
        },
        orderBy: { at: "desc" },
      });
      expect(attempt.tenantId).toBe(null);

      const result = await prisma.authEvent.findFirstOrThrow({
        where: { correlationId: attempt.correlationId, phase: "result" },
      });
      expect(result.outcome).toBe("success");
      expect(result.tenantId).toBe(orgA);
      expect(result.entity).toBe("invitation");
      expect(result.entityId).toBe(invitationId);
    });

    it("evento de plataforma: tenant_id NULL en intento y resultado", async () => {
      const targetId = await createUser(`target-role-${suffix}@example.com`);
      const res = await post(
        "/api/auth/admin/set-role",
        { userId: targetId, role: "user" },
        superCookie,
      );
      expect(res.status).toBe(200);

      const attempt = await prisma.authEvent.findFirstOrThrow({
        where: { route: "/admin/set-role", phase: "attempt", actorId: superAdminId },
        orderBy: { at: "desc" },
      });
      expect(attempt.tenantId).toBe(null);
      const result = await prisma.authEvent.findFirstOrThrow({
        where: { correlationId: attempt.correlationId, phase: "result" },
      });
      expect(result.outcome).toBe("success");
      expect(result.tenantId).toBe(null);
      expect(result.entity).toBe("user");
      expect(result.entityId).toBe(targetId);
    });

    it("sin secretos en el evento: no guarda cuerpo, contraseña, token ni cookie", async () => {
      const targetId = await createUser(`target-pass-${suffix}@example.com`);
      const secret = `Secreta-${suffix}-123!`;
      const res = await post(
        "/api/auth/admin/set-user-password",
        { userId: targetId, newPassword: secret },
        superCookie,
      );
      expect(res.status).toBe(200);

      const rows = await prisma.authEvent.findMany({
        where: { route: "/admin/set-user-password" },
        orderBy: { at: "desc" },
      });
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("newPassword");
      expect(serialized).not.toContain(superCookie.split("=")[1] ?? "cookie-imposible");
      for (const row of rows) {
        // No hay columna de cuerpo ni de mensaje: solo código, estado y nombre.
        expect(Object.keys(row)).not.toContain("body");
        expect(Object.keys(row)).not.toContain("message");
      }
    });
  });

  describe("fallos de escritura", () => {
    it("si falla el intento, la API responde 500 y la escritura no se ejecuta", async () => {
      const email = `invitado-fail-attempt-${suffix}@example.com`;
      vi.spyOn(authEventService, "recordAttempt").mockRejectedValueOnce(
        new Error("base rechaza el intento"),
      );

      const res = await post(
        "/api/auth/organization/invite-member",
        { email, role: "provider", organizationId: orgA },
        ownerACookie,
      );
      expect(res.status).toBe(500);
      await expect(prisma.invitation.findFirst({ where: { email } })).resolves.toBeNull();
    });

    it("si falla el resultado, la acción confirmada se mantiene y el fallo solo va al log", async () => {
      const email = `invitado-fail-result-${suffix}@example.com`;
      const marker = new Date();
      const spy = vi
        .spyOn(authEventService, "recordResult")
        .mockRejectedValueOnce(new Error("base rechaza el resultado"));

      const res = await post(
        "/api/auth/organization/invite-member",
        { email, role: "provider", organizationId: orgA },
        ownerACookie,
      );
      expect(res.status).toBe(200);
      const invitation = (await res.json()) as { id: string };
      expect(spy).toHaveBeenCalledTimes(1);

      // La acción sigue confirmada.
      await expect(
        prisma.invitation.findFirst({ where: { id: invitation.id } }),
      ).resolves.not.toBeNull();

      // El intento quedó escrito y su resultado no: el par no está completo.
      const attempt = await prisma.authEvent.findFirstOrThrow({
        where: {
          route: "/organization/invite-member",
          phase: "attempt",
          actorId: ownerAId,
          at: { gte: marker },
        },
        orderBy: { at: "desc" },
      });
      await expect(
        prisma.authEvent.findFirst({
          where: { correlationId: attempt.correlationId, phase: "result" },
        }),
      ).resolves.toBeNull();
    });
  });

  describe("inventario de rutas de escritura", () => {
    it("las rutas administrativas de solo lectura están declaradas y no generan intentos", () => {
      const readOnly = new Set(BETTER_AUTH_ADMIN_READ_ONLY_PATHS);
      expect([...readOnly].sort()).toEqual([
        "/admin/get-user",
        "/admin/has-permission",
        "/admin/list-user-sessions",
        "/admin/list-users",
      ]);

      for (const path of BETTER_AUTH_ADMIN_READ_ONLY_PATHS) {
        expect(betterAuthAdminRouteOf(path), `${path} no está en la tabla administrativa`).toBeDefined();
      }
      for (const route of BETTER_AUTH_ADMIN_ROUTES) {
        expect(isBetterAuthAdminWriteRoute(route.path), route.path).toBe(!readOnly.has(route.path));
      }
      expect(isBetterAuthAdminWriteRoute("/organization/list-members")).toBe(false);
      expect(isBetterAuthAdminWriteRoute(undefined)).toBe(false);
    });
  });

  describe("visibilidad de los intentos (GET /admin/auth-events)", () => {
    it("agente no lee eventos -> 403", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/auth-events`, {
        headers: { cookie: agentCookie, origin: authOrigin },
      });
      expect(res.status).toBe(403);
    });

    it("el admin de agencia solo recibe los eventos de su agencia (nunca los de plataforma)", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/auth-events?limit=100`, {
        headers: { cookie: ownerACookie, origin: authOrigin },
      });
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as {
        items: Array<{ tenantId: string | null; actorId: string | null }>;
      };
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.tenantId === orgA)).toBe(true);
      expect(items.some((item) => item.tenantId === null)).toBe(false);
      expect(items.some((item) => item.tenantId === orgB)).toBe(false);
    });

    it("el Super Admin consulta todos: plataforma, agencia A y agencia B", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/auth-events?limit=100`, {
        headers: { cookie: superCookie, origin: authOrigin },
      });
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as {
        items: Array<{ tenantId: string | null; correlationId: string }>;
      };
      expect(items.some((item) => item.tenantId === null)).toBe(true);
      expect(items.some((item) => item.tenantId === orgA)).toBe(true);
      expect(items.some((item) => item.tenantId === orgB)).toBe(true);
      expect(items.some((item) => item.correlationId === `b-attempt-${suffix}`)).toBe(true);
    });
  });

  describe("consulta de intentos: filtros, cursor y validación", () => {
    it("filtro por resultado: outcome=error solo devuelve los fallidos", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/auth-events?outcome=error&limit=100`, {
        headers: { cookie: ownerACookie, origin: authOrigin },
      });
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as {
        items: Array<{ outcome: string | null; error: { code: string } | null }>;
      };
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.outcome === "error")).toBe(true);
      expect(items.some((item) => item.error?.code === "TWO_FACTOR_REQUIRED")).toBe(true);
      expect(items.some((item) => item.error?.code === "VALIDATION_ERROR")).toBe(true);
    });

    it("filtro por ruta: solo devuelve la ruta pedida", async () => {
      const res = await fetch(
        `${baseUrl}/api/v1/admin/auth-events?route=${encodeURIComponent(
          "/organization/invite-member",
        )}&limit=100`,
        { headers: { cookie: ownerACookie, origin: authOrigin } },
      );
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as { items: Array<{ route: string }> };
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.route === "/organization/invite-member")).toBe(true);
    });

    it("sin mensaje interno: el error expone solo código, estado y nombre", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/auth-events?outcome=error&limit=100`, {
        headers: { cookie: ownerACookie, origin: authOrigin },
      });
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as {
        items: Array<{ error: Record<string, unknown> | null }>;
      };
      const failed = items.find((item) => item.error !== null);
      expect(failed).toBeDefined();
      expect(Object.keys(failed?.error ?? {}).sort()).toEqual(["code", "name", "status"]);
      expect(JSON.stringify(failed)).not.toContain("message");
    });

    it("paginación por cursor: no repite filas y avanza", async () => {
      const first = await fetch(`${baseUrl}/api/v1/admin/auth-events?limit=2`, {
        headers: { cookie: ownerACookie, origin: authOrigin },
      });
      expect(first.status).toBe(200);
      const pageOne = (await first.json()) as {
        items: Array<{ id: string }>;
        nextCursor: string | null;
      };
      expect(pageOne.items).toHaveLength(2);
      expect(pageOne.nextCursor).toBeTruthy();

      const second = await fetch(
        `${baseUrl}/api/v1/admin/auth-events?limit=2&cursor=${encodeURIComponent(
          pageOne.nextCursor ?? "",
        )}`,
        { headers: { cookie: ownerACookie, origin: authOrigin } },
      );
      expect(second.status).toBe(200);
      const pageTwo = (await second.json()) as { items: Array<{ id: string }> };
      expect(pageTwo.items.length).toBeGreaterThan(0);
      const firstIds = new Set(pageOne.items.map((item) => item.id));
      expect(pageTwo.items.every((item) => !firstIds.has(item.id))).toBe(true);
    });

    it("query inválida -> 400", async () => {
      const cases = ["outcome=bogus", "from=no-es-fecha", "cursor=%%%", "limit=0", "limit=101"];
      for (const query of cases) {
        const res = await fetch(`${baseUrl}/api/v1/admin/auth-events?${query}`, {
          headers: { cookie: ownerACookie, origin: authOrigin },
        });
        expect(res.status, query).toBe(400);
      }
    });
  });

  describe("inmutabilidad de auth_events (permisos de BD + trigger)", () => {
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
      const correlationId = `immutable-${suffix}`;
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.platform', 'on', true)");
        await client.query(
          `INSERT INTO auth_events
             (id, tenant_id, correlation_id, phase, actor_id, route, method, ip, outcome, entity, entity_id, at)
           VALUES ($1, NULL, $2, 'attempt', NULL, '/admin/set-role', 'POST', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP)`,
          [id, correlationId],
        );
        const read = await client.query<{ count: string }>(
          "SELECT count(*) AS count FROM auth_events WHERE id = $1",
          [id],
        );
        expect(read.rows[0]?.count).toBe("1");

        // Savepoints: la primera sentencia fallida aborta la transaccion y la
        // segunda seguiria fallando por la transaccion abortada, no por
        // permisos.
        await client.query("SAVEPOINT update_attempt");
        await expect(
          client.query("UPDATE auth_events SET route = '/admin/ban-user' WHERE id = $1", [id]),
        ).rejects.toThrow(/permission denied/i);
        await client.query("ROLLBACK TO SAVEPOINT update_attempt");

        await client.query("SAVEPOINT delete_attempt");
        await expect(client.query("DELETE FROM auth_events WHERE id = $1", [id])).rejects.toThrow(
          /permission denied/i,
        );
        await client.query("ROLLBACK TO SAVEPOINT delete_attempt");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.query("RESET ROLE");
      }
    });

    it("el trigger rechaza UPDATE y DELETE para caribe_app si recibiera privilegios (GRANT solo dentro de la transaccion)", async () => {
      const id = randomUUID();
      try {
        await client.query("RESET ROLE");
        await client.query("BEGIN");
        // Con el REVOKE vigente, caribe_app recibe permission denied y nunca
        // llega al trigger (primera capa, probada arriba). Para ejercitar la
        // SEGUNDA capa con el rol real de la aplicacion se le devuelve el
        // privilegio solo dentro de esta transaccion: es el escenario de un
        // GRANT accidental que el trigger tiene que seguir bloqueando.
        await client.query("GRANT UPDATE, DELETE ON auth_events TO caribe_app");
        await client.query("SET ROLE caribe_app");
        await client.query("SELECT set_config('app.platform', 'on', true)");
        await client.query(
          `INSERT INTO auth_events
             (id, tenant_id, correlation_id, phase, actor_id, route, method, ip, outcome, entity, entity_id, at)
           VALUES ($1, NULL, $2, 'attempt', NULL, '/admin/set-role', 'POST', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP)`,
          [id, `grant-${suffix}`],
        );
        await client.query("SAVEPOINT upd");
        await expect(
          client.query("UPDATE auth_events SET route = '/admin/ban-user' WHERE id = $1", [id]),
        ).rejects.toThrow(/auth_events es inmutable/i);
        await client.query("ROLLBACK TO SAVEPOINT upd");
        await client.query("SAVEPOINT del");
        await expect(client.query("DELETE FROM auth_events WHERE id = $1", [id])).rejects.toThrow(
          /auth_events es inmutable/i,
        );
        await client.query("ROLLBACK TO SAVEPOINT del");
      } finally {
        await client.query("ROLLBACK");
        await client.query("RESET ROLE");
      }
      // El GRANT transitorio quedo deshecho: el rol vuelve a estar sin UPDATE.
      const restored = await client.query<{ ok: boolean }>(
        "SELECT has_table_privilege('caribe_app', 'auth_events', 'UPDATE') AS ok",
      );
      expect(restored.rows[0]?.ok).toBe(false);
    });

    it("el trigger rechaza UPDATE y DELETE incluso para el dueno de la tabla", async () => {
      // Cada capa se prueba con el rol que la alcanza: caribe_app no llega al
      // trigger (sin privilegios) y el dueno, que si los tiene, tambien queda
      // bloqueado.
      const id = randomUUID();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO auth_events
             (id, tenant_id, correlation_id, phase, actor_id, route, method, ip, outcome, entity, entity_id, at)
           VALUES ($1, NULL, $2, 'attempt', NULL, '/admin/set-role', 'POST', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP)`,
          [id, `owner-${suffix}`],
        );
        await client.query("SAVEPOINT upd");
        await expect(
          client.query("UPDATE auth_events SET route = '/admin/ban-user' WHERE id = $1", [id]),
        ).rejects.toThrow(/auth_events es inmutable/i);
        await client.query("ROLLBACK TO SAVEPOINT upd");
        await client.query("SAVEPOINT del");
        await expect(client.query("DELETE FROM auth_events WHERE id = $1", [id])).rejects.toThrow(
          /auth_events es inmutable/i,
        );
        await client.query("ROLLBACK TO SAVEPOINT del");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });
});
