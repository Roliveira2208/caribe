import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
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
 * E2E de ajustes de la agencia y `user.locale` (T-F1-1a).
 *
 * Cubre los escenarios de auth-access "Operación de agencia sin agencia
 * activa" y de audit "Cambio de ajustes de la agencia", además del contrato
 * del endpoint (defaults, límites, 422 estricto) y el aislamiento RLS de
 * `tenant_settings` probado con el rol real de la aplicación.
 *
 * Cada caso monta sus propias agencias para no depender del orden de los
 * tests: el archivo comparte proceso y la BD conserva filas entre corridas.
 */
describe("tenant-settings (ajustes de la agencia)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  const suffix = randomUUID().slice(0, 8);

  // Agencia con dueño, admin y agente para los casos de rol.
  let orgWrite: string;
  let writeOwnerId: string;
  let writeOwnerCookie: string;
  let adminCookie: string;
  let agentCookie: string;
  let noTotpCookie: string;

  // Agencia sin fila de ajustes: defaults y creación por PUT.
  let orgDefaults: string;
  let defaultsOwnerId: string;
  let defaultsOwnerCookie: string;

  // Agencias para el aislamiento RLS (no necesitan sesión HTTP).
  let orgRlsA: string;
  let orgRlsB: string;
  let orgRlsC: string;

  // Cliente autenticado sin membresía.
  let clientId: string;
  let clientCookie: string;

  let rlsClient: Client;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    const writeOwner = await userWithTotp(baseUrl, `settings-owner-${suffix}@example.com`);
    writeOwnerId = writeOwner.userId;
    writeOwnerCookie = writeOwner.cookie;
    orgWrite = (
      await createAgency(
        writeOwnerId,
        `Agencia Ajustes ${suffix}`,
        `agencia-ajustes-${suffix}`,
      )
    ).id;
    await setActiveOrg(baseUrl, writeOwnerCookie, orgWrite);

    const writeAdmin = await userWithTotp(baseUrl, `settings-admin-${suffix}@example.com`);
    await addMember(orgWrite, writeAdmin.userId, "admin");
    await setActiveOrg(baseUrl, writeAdmin.cookie, orgWrite);
    adminCookie = writeAdmin.cookie;

    const agentEmail = `settings-agent-${suffix}@example.com`;
    const agentId = await createUser(agentEmail);
    await addMember(orgWrite, agentId, "agent");
    agentCookie = await signIn(baseUrl, agentEmail);
    await setActiveOrg(baseUrl, agentCookie, orgWrite);

    const noTotpEmail = `settings-owner-nototp-${suffix}@example.com`;
    const noTotpId = await createUser(noTotpEmail);
    await addMember(orgWrite, noTotpId, "owner");
    noTotpCookie = await signIn(baseUrl, noTotpEmail);
    await setActiveOrg(baseUrl, noTotpCookie, orgWrite);

    const defaultsOwner = await userWithTotp(
      baseUrl,
      `settings-defaults-${suffix}@example.com`,
    );
    defaultsOwnerId = defaultsOwner.userId;
    defaultsOwnerCookie = defaultsOwner.cookie;
    orgDefaults = (
      await createAgency(
        defaultsOwnerId,
        `Agencia Ajustes Defaults ${suffix}`,
        `agencia-ajustes-defaults-${suffix}`,
      )
    ).id;
    await setActiveOrg(baseUrl, defaultsOwnerCookie, orgDefaults);

    orgRlsA = (
      await createAgency(
        await createUser(`settings-rls-a-${suffix}@example.com`),
        `Agencia RLS Ajustes A ${suffix}`,
        `agencia-rls-ajustes-a-${suffix}`,
      )
    ).id;
    orgRlsB = (
      await createAgency(
        await createUser(`settings-rls-b-${suffix}@example.com`),
        `Agencia RLS Ajustes B ${suffix}`,
        `agencia-rls-ajustes-b-${suffix}`,
      )
    ).id;
    orgRlsC = (
      await createAgency(
        await createUser(`settings-rls-c-${suffix}@example.com`),
        `Agencia RLS Ajustes C ${suffix}`,
        `agencia-rls-ajustes-c-${suffix}`,
      )
    ).id;

    await prisma.tenantSettings.createMany({
      data: [
        {
          tenantId: orgRlsA,
          holdMinutes: 25,
          paymentMode: "MANUAL",
          baseCurrency: "USD",
          updatedAt: new Date(),
        },
        {
          tenantId: orgRlsB,
          holdMinutes: 60,
          paymentMode: "AUTO",
          baseCurrency: "EUR",
          updatedAt: new Date(),
        },
      ],
    });

    const clientEmail = `settings-client-${suffix}@example.com`;
    clientId = await createUser(clientEmail);
    clientCookie = await signIn(baseUrl, clientEmail);

    rlsClient = new Client({ connectionString: process.env.DATABASE_URL });
    await rlsClient.connect();
    await rlsClient.query("SET ROLE caribe_app");
  });

  afterAll(async () => {
    await rlsClient?.end();
    await app.close();
    await prisma.$disconnect();
  });

  function getSettings(cookie: string): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/admin/tenant-settings`, {
      headers: { cookie, origin: authOrigin },
    });
  }

  function putSettings(cookie: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/admin/tenant-settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie, origin: authOrigin },
      body: JSON.stringify(body),
    });
  }

  describe("defaults y creación (GET/PUT)", () => {
    it("una agencia sin fila recibe los defaults y GET no crea la fila", async () => {
      const res = await getSettings(defaultsOwnerCookie);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        tenantId: orgDefaults,
        holdMinutes: 30,
        paymentMode: "AUTO",
        baseCurrency: "USD",
        legalName: null,
        rif: null,
        address: null,
        phone: null,
        email: null,
        updatedAt: null,
      });

      await expect(
        prisma.tenantSettings.findUnique({ where: { tenantId: orgDefaults } }),
      ).resolves.toBeNull();
    });

    it("PUT crea la fila, devuelve el estado efectivo y audita antes/después", async () => {
      const startedAt = Date.now();
      const res = await putSettings(defaultsOwnerCookie, {
        holdMinutes: 45,
        paymentMode: "MANUAL",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        tenantId: orgDefaults,
        holdMinutes: 45,
        paymentMode: "MANUAL",
        baseCurrency: "USD",
        legalName: null,
        rif: null,
        address: null,
        phone: null,
        email: null,
      });
      expect(typeof body["updatedAt"]).toBe("string");
      expect(new Date(body["updatedAt"] as string).toISOString()).toBe(body["updatedAt"]);

      const row = await prisma.tenantSettings.findUniqueOrThrow({
        where: { tenantId: orgDefaults },
      });
      expect(row.holdMinutes).toBe(45);
      expect(row.paymentMode).toBe("MANUAL");
      expect(row.updatedAt.toISOString()).toBe(body["updatedAt"]);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: {
          action: "tenant-settings.update",
          entity: "tenant_settings",
          entityId: orgDefaults,
        },
      });
      expect(audit.tenantId).toBe(orgDefaults);
      expect(audit.actorId).toBe(defaultsOwnerId);
      expect(audit.ip).toBeTruthy();
      expect(audit.at.getTime()).toBeGreaterThanOrEqual(startedAt);
      expect(audit.before).toEqual({
        tenantId: orgDefaults,
        holdMinutes: 30,
        paymentMode: "AUTO",
        baseCurrency: "USD",
        legalName: null,
        rif: null,
        address: null,
        phone: null,
        email: null,
        updatedAt: null,
      });
      expect(audit.after).toEqual(body);
    });
  });

  describe("contrato del PUT (límites y validación estricta)", () => {
    it("acepta los límites 5 y 1440 minutos", async () => {
      for (const holdMinutes of [5, 1440]) {
        const res = await putSettings(writeOwnerCookie, { holdMinutes });
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({ holdMinutes });
      }
    });

    it("rechaza 4, 0, 1441 y 1.5 con 422 y sin cambiar la fila", async () => {
      const before = await prisma.tenantSettings.findUniqueOrThrow({
        where: { tenantId: orgWrite },
      });
      for (const holdMinutes of [4, 0, 1441, 1.5]) {
        const res = await putSettings(writeOwnerCookie, { holdMinutes });
        expect(res.status).toBe(422);
        const body = (await res.json()) as { code?: string };
        expect(body.code).toBe("VALIDATION_ERROR");
      }
      const after = await prisma.tenantSettings.findUniqueOrThrow({
        where: { tenantId: orgWrite },
      });
      expect(after.holdMinutes).toBe(before.holdMinutes);
    });

    it("rechaza un payment_mode o una moneda inválidos con 422", async () => {
      for (const body of [
        { paymentMode: "X" },
        { paymentMode: "auto" },
        { baseCurrency: "usd" },
        { baseCurrency: "US" },
        { baseCurrency: "USDT" },
      ]) {
        const res = await putSettings(writeOwnerCookie, body);
        expect(res.status).toBe(422);
        await expect(res.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
      }
    });

    it("rechaza un email inválido con 422", async () => {
      const res = await putSettings(writeOwnerCookie, { email: "no-es-email" });
      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rechaza claves calculadas o desconocidas y el cuerpo vacío con 422", async () => {
      for (const body of [{ tenantId: orgRlsB }, { updatedAt: new Date().toISOString() }, {}]) {
        const res = await putSettings(writeOwnerCookie, body);
        expect(res.status).toBe(422);
        const problem = (await res.json()) as { code?: string };
        expect(problem.code).toBe("VALIDATION_ERROR");
      }
    });

    it("un PUT inválido no deja fila de auditoría", async () => {
      const count = await prisma.auditLog.count({
        where: { action: "tenant-settings.update", entityId: orgWrite },
      });
      const res = await putSettings(writeOwnerCookie, { holdMinutes: 0 });
      expect(res.status).toBe(422);
      await expect(
        prisma.auditLog.count({
          where: { action: "tenant-settings.update", entityId: orgWrite },
        }),
      ).resolves.toBe(count);
    });

    it("actualiza los campos de contacto y los devuelve tal cual", async () => {
      const res = await putSettings(writeOwnerCookie, {
        legalName: "Agencia Ajustes C.A.",
        rif: "J-12345678-9",
        address: "Av. Principal, Caracas",
        phone: "+58 412 1234567",
        email: "ajustes@example.com",
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        legalName: "Agencia Ajustes C.A.",
        rif: "J-12345678-9",
        address: "Av. Principal, Caracas",
        phone: "+58 412 1234567",
        email: "ajustes@example.com",
      });
    });
  });

  describe("roles y segundo factor", () => {
    it("el dueño con TOTP lee y edita", async () => {
      const get = await getSettings(writeOwnerCookie);
      expect(get.status).toBe(200);
      const put = await putSettings(writeOwnerCookie, { holdMinutes: 35 });
      expect(put.status).toBe(200);
    });

    it("el admin con TOTP lee y edita", async () => {
      const get = await getSettings(adminCookie);
      expect(get.status).toBe(200);
      const put = await putSettings(adminCookie, { paymentMode: "AUTO" });
      expect(put.status).toBe(200);
    });

    it("el agente recibe 403 FORBIDDEN en lectura y escritura", async () => {
      const get = await getSettings(agentCookie);
      expect(get.status).toBe(403);
      await expect(get.json()).resolves.toMatchObject({ code: "FORBIDDEN" });

      const put = await putSettings(agentCookie, { holdMinutes: 10 });
      expect(put.status).toBe(403);
      await expect(put.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
    });

    it("el dueño sin TOTP recibe 403 TWO_FACTOR_REQUIRED", async () => {
      const get = await getSettings(noTotpCookie);
      expect(get.status).toBe(403);
      await expect(get.json()).resolves.toMatchObject({ code: "TWO_FACTOR_REQUIRED" });

      const put = await putSettings(noTotpCookie, { holdMinutes: 10 });
      expect(put.status).toBe(403);
      await expect(put.json()).resolves.toMatchObject({ code: "TWO_FACTOR_REQUIRED" });
    });

    it("sin sesión responde 401 UNAUTHENTICATED", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/tenant-settings`, {
        headers: { origin: authOrigin },
      });
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
    });
  });

  describe("cliente sin membresía (auth-access)", () => {
    it("sin agencia activa recibe 403 ACTIVE_ORGANIZATION_REQUIRED", async () => {
      const res = await getSettings(clientCookie);
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({
        code: "ACTIVE_ORGANIZATION_REQUIRED",
      });
    });

    it("con una agencia activa forzada pero sin membresía recibe 403 ACTIVE_ORGANIZATION_REQUIRED", async () => {
      await prisma.session.updateMany({
        where: { userId: clientId },
        data: { activeOrganizationId: orgDefaults },
      });

      const get = await getSettings(clientCookie);
      expect(get.status).toBe(403);
      await expect(get.json()).resolves.toMatchObject({
        code: "ACTIVE_ORGANIZATION_REQUIRED",
      });

      const countBefore = await prisma.auditLog.count({
        where: { action: "tenant-settings.update", entityId: orgDefaults },
      });
      const put = await putSettings(clientCookie, { holdMinutes: 10 });
      expect(put.status).toBe(403);
      await expect(put.json()).resolves.toMatchObject({
        code: "ACTIVE_ORGANIZATION_REQUIRED",
      });
      await expect(
        prisma.auditLog.count({
          where: { action: "tenant-settings.update", entityId: orgDefaults },
        }),
      ).resolves.toBe(countBefore);
    });
  });

  describe("RLS de tenant_settings con el rol de aplicación", () => {
    /** Ejecuta fn como caribe_app en su propia transacción con los GUC pedidos. */
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
      await rlsClient.query("BEGIN");
      try {
        if (guc?.tenantId) {
          await rlsClient.query("SELECT set_config('app.tenant_id', $1, true)", [guc.tenantId]);
        }
        if (guc?.userId) {
          await rlsClient.query("SELECT set_config('app.user_id', $1, true)", [guc.userId]);
        }
        if (guc?.platform) {
          await rlsClient.query("SELECT set_config('app.platform', 'on', true)");
        }
        if (guc?.public) {
          await rlsClient.query("SELECT set_config('app.public', 'on', true)");
        }
        if (guc?.ratesGlobal) {
          await rlsClient.query("SELECT set_config('app.rates_global', 'on', true)");
        }
        return await fn(rlsClient);
      } finally {
        await rlsClient.query("ROLLBACK");
      }
    }

    async function tenantIds(c: Client): Promise<string[]> {
      const { rows } = await c.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM tenant_settings ORDER BY tenant_id",
      );
      return rows.map((row) => row.tenant_id);
    }

    it("la agencia A solo ve su fila y no ve la de B ni por id", async () => {
      const rows = await asCaribeApp({ tenantId: orgRlsA }, tenantIds);
      expect(rows).toEqual([orgRlsA]);

      const byId = await asCaribeApp({ tenantId: orgRlsA }, async (c) => {
        const result = await c.query<{ tenant_id: string }>(
          "SELECT tenant_id FROM tenant_settings WHERE tenant_id = $1",
          [orgRlsB],
        );
        return result.rows.map((row) => row.tenant_id);
      });
      expect(byId).toEqual([]);
    });

    it("la agencia A no puede actualizar ni borrar la fila de B", async () => {
      const updated = await asCaribeApp({ tenantId: orgRlsA }, async (c) => {
        const result = await c.query(
          "UPDATE tenant_settings SET hold_minutes = 99 WHERE tenant_id = $1",
          [orgRlsB],
        );
        return result.rowCount;
      });
      expect(updated).toBe(0);

      const deleted = await asCaribeApp({ tenantId: orgRlsA }, async (c) => {
        const result = await c.query("DELETE FROM tenant_settings WHERE tenant_id = $1", [
          orgRlsB,
        ]);
        return result.rowCount;
      });
      expect(deleted).toBe(0);

      const row = await prisma.tenantSettings.findUniqueOrThrow({
        where: { tenantId: orgRlsB },
      });
      expect(row.holdMinutes).toBe(60);
    });

    it("la agencia A no puede insertar una fila de B (WITH CHECK)", async () => {
      await expect(
        asCaribeApp({ tenantId: orgRlsA }, (c) =>
          c.query(
            `INSERT INTO tenant_settings
               (tenant_id, hold_minutes, payment_mode, base_currency, updated_at)
             VALUES ($1, 30, 'AUTO', 'USD', now())`,
            [orgRlsB],
          ),
        ),
      ).rejects.toThrow();
    });

    it("la agencia C puede insertar, actualizar y borrar su propia fila", async () => {
      await asCaribeApp({ tenantId: orgRlsC }, async (c) => {
        await c.query(
          `INSERT INTO tenant_settings
             (tenant_id, hold_minutes, payment_mode, base_currency, updated_at)
           VALUES ($1, 30, 'AUTO', 'USD', now())`,
          [orgRlsC],
        );
        const updated = await c.query(
          "UPDATE tenant_settings SET hold_minutes = 50 WHERE tenant_id = $1",
          [orgRlsC],
        );
        expect(updated.rowCount).toBe(1);
        const { rows } = await c.query<{ hold_minutes: number }>(
          "SELECT hold_minutes FROM tenant_settings WHERE tenant_id = $1",
          [orgRlsC],
        );
        expect(rows[0]?.hold_minutes).toBe(50);
        const deleted = await c.query("DELETE FROM tenant_settings WHERE tenant_id = $1", [
          orgRlsC,
        ]);
        expect(deleted.rowCount).toBe(1);
      });
    });

    it("sin contexto no se ve ni se escribe nada (fallo cerrado)", async () => {
      const rows = await asCaribeApp(undefined, tenantIds);
      expect(rows).toEqual([]);
      await expect(
        asCaribeApp(undefined, (c) =>
          c.query(
            `INSERT INTO tenant_settings
               (tenant_id, hold_minutes, payment_mode, base_currency, updated_at)
             VALUES ($1, 30, 'AUTO', 'USD', now())`,
            [orgRlsA],
          ),
        ),
      ).rejects.toThrow();
    });

    it("el contexto de plataforma lee todo pero no escribe", async () => {
      const rows = await asCaribeApp({ platform: true }, async (c) => {
        const { rows: result } = await c.query<{ tenant_id: string }>(
          "SELECT tenant_id FROM tenant_settings WHERE tenant_id = ANY($1::text[]) ORDER BY tenant_id",
          [[orgRlsA, orgRlsB]],
        );
        return result.map((row) => row.tenant_id);
      });
      expect(rows).toEqual([orgRlsA, orgRlsB].sort());

      await expect(
        asCaribeApp({ platform: true }, (c) =>
          c.query(
            `INSERT INTO tenant_settings
               (tenant_id, hold_minutes, payment_mode, base_currency, updated_at)
             VALUES ($1, 30, 'AUTO', 'USD', now())`,
            [orgRlsA],
          ),
        ),
      ).rejects.toThrow();

      const updated = await asCaribeApp({ platform: true }, async (c) => {
        const result = await c.query(
          "UPDATE tenant_settings SET hold_minutes = 99 WHERE tenant_id = $1",
          [orgRlsA],
        );
        return result.rowCount;
      });
      expect(updated).toBe(0);
    });

    it("los contextos owner, public y rates_global no ven ni escriben ajustes", async () => {
      for (const guc of [{ userId: writeOwnerId }, { public: true }, { ratesGlobal: true }]) {
        const rows = await asCaribeApp(guc, tenantIds);
        expect(rows).toEqual([]);
        await expect(
          asCaribeApp(guc, (c) =>
            c.query(
              `INSERT INTO tenant_settings
                 (tenant_id, hold_minutes, payment_mode, base_currency, updated_at)
               VALUES ($1, 30, 'AUTO', 'USD', now())`,
              [orgRlsA],
            ),
          ),
        ).rejects.toThrow();
      }
    });
  });

  describe("user.locale", () => {
    it("se registra en es y se puede cambiar a en por /api/auth/update-user", async () => {
      const email = `settings-locale-${suffix}@example.com`;
      const userId = await createUser(email);
      const created = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(created.locale).toBe("es");

      const cookie = await signIn(baseUrl, email);
      const res = await fetch(`${baseUrl}/api/auth/update-user`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: authOrigin },
        body: JSON.stringify({ locale: "en" }),
      });
      expect(res.status).toBe(200);

      const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(updated.locale).toBe("en");
    });
  });
});
