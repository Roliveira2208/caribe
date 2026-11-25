import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInCaracas } from "@caribe/shared";
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
 * Escenarios obligatorios del panel de tasas de f2-admin-rates (T-F2-8/T-F2-9)
 * sobre las rutas existentes. El panel es solo UI: la autoridad es esta API,
 * que ya impone TOTP, permisos, membresía activa, tenant y cuerpo estricto.
 */
describe("exchange-rates: panel F2 (T-F2-8/T-F2-9)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  const suffix = randomUUID().slice(0, 8);
  const globalRateId = randomUUID();
  const today = todayInCaracas();

  let orgA: string;
  let ownerAId: string;
  let ownerACookie: string;
  let adminACookie: string;
  let agentACookie: string;
  let providerACookie: string;
  let memberACookie: string;
  let noTotpCookie: string;
  let revokedCookie: string;
  let revokedMemberId: string;

  async function call(
    method: string,
    path: string,
    cookie: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: {
        cookie,
        origin: authOrigin,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  }

  const current = (cookie: string) => call("GET", "/admin/exchange-rates/current", cookie);
  const override = (cookie: string, body: Record<string, unknown>) =>
    call("PUT", "/admin/exchange-rates/override", cookie, body);

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    const ownerA = await userWithTotp(baseUrl, `owner-f2-a-${suffix}@example.com`);
    ownerAId = ownerA.userId;
    ownerACookie = ownerA.cookie;
    orgA = (await createAgency(ownerAId, `F2 A ${suffix}`, `f2-a-${suffix}`)).id;
    await setActiveOrg(baseUrl, ownerACookie, orgA);

    const adminA = await userWithTotp(baseUrl, `admin-f2-a-${suffix}@example.com`);
    await addMember(orgA, adminA.userId, "admin");
    adminACookie = adminA.cookie;
    await setActiveOrg(baseUrl, adminACookie, orgA);

    for (const [role, label] of [
      ["agent", "agent"],
      ["provider", "provider"],
      ["member", "member"],
    ] as const) {
      const email = `${label}-f2-a-${suffix}@example.com`;
      const id = await createUser(email);
      await addMember(orgA, id, role);
      const cookie = await signIn(baseUrl, email);
      await setActiveOrg(baseUrl, cookie, orgA);
      if (role === "agent") agentACookie = cookie;
      if (role === "provider") providerACookie = cookie;
      if (role === "member") memberACookie = cookie;
    }

    // Owner sin segundo factor: mismo rol, distinta sesión.
    const noTotpEmail = `nototp-f2-a-${suffix}@example.com`;
    const noTotpId = await createUser(noTotpEmail);
    await addMember(orgA, noTotpId, "owner");
    noTotpCookie = await signIn(baseUrl, noTotpEmail);
    await setActiveOrg(baseUrl, noTotpCookie, orgA);

    // Sesión con la membresía revocada después de fijar la agencia activa.
    const revokedEmail = `revoked-f2-a-${suffix}@example.com`;
    revokedMemberId = await createUser(revokedEmail);
    await addMember(orgA, revokedMemberId, "admin");
    revokedCookie = await signIn(baseUrl, revokedEmail);
    await setActiveOrg(baseUrl, revokedCookie, orgA);
    await prisma.member.deleteMany({ where: { organizationId: orgA, userId: revokedMemberId } });

    // El stub de setup-env apunta a un puerto muerto: se siembra la tasa global
    // de hoy para que `current` no dependa del orden de archivos de la suite.
    await prisma.$executeRaw`
      INSERT INTO "exchange_rates"
        (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
      VALUES (${globalRateId}, NULL, 'COTIZAVE', 900.0000, ${today}::date, now(), false, NULL, NULL)
      ON CONFLICT (value_date) WHERE tenant_id IS NULL DO UPDATE SET
        source = EXCLUDED.source,
        rate = EXCLUDED.rate,
        is_override = false,
        reason = NULL
    `;
    const ready = await current(ownerACookie);
    expect(ready.status).toBe(200);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$executeRaw`DELETE FROM "exchange_rates" WHERE "id" = ${globalRateId}`;
    await prisma.$disconnect();
  });

  it("ver tasa vigente: owner, admin, agente y proveedor leen el texto del servidor", async () => {
    for (const cookie of [ownerACookie, adminACookie, agentACookie, providerACookie]) {
      const res = await current(cookie);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        scope: "agency",
        valueDate: today,
        rate: expect.stringMatching(/^\d{1,14}\.\d{4}$/),
      });
    }
  });

  it("sin segundo factor: 403 TWO_FACTOR_REQUIRED y ninguna escritura", async () => {
    const res = await override(noTotpCookie, { rate: "950.0000", reason: "Sin TOTP" });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "TWO_FACTOR_REQUIRED" });
    expect(
      await prisma.exchangeRate.count({ where: { tenantId: orgA, valueDate: new Date(today) } }),
    ).toBe(0);
  });

  it("sin permiso de tasa: member no lee y agente/provider no escriben", async () => {
    for (const cookie of [memberACookie, agentACookie, providerACookie]) {
      const res = await current(cookie);
      expect(res.status).toBe(cookie === memberACookie ? 403 : 200);
      const write = await override(cookie, { rate: "950.0000", reason: "Intento" });
      expect(write.status).toBe(403);
      await expect(write.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("membresía revocada: 403 ACTIVE_ORGANIZATION_REQUIRED", async () => {
    const read = await current(revokedCookie);
    expect(read.status).toBe(403);
    await expect(read.json()).resolves.toMatchObject({ code: "ACTIVE_ORGANIZATION_REQUIRED" });

    const write = await override(revokedCookie, { rate: "950.0000", reason: "Revocada" });
    expect(write.status).toBe(403);
    await expect(write.json()).resolves.toMatchObject({ code: "ACTIVE_ORGANIZATION_REQUIRED" });
  });

  it("campos calculados del cliente: 422 y ninguna tasa escrita", async () => {
    const res = await override(ownerACookie, {
      rate: "950.0000",
      reason: "BCV no publicó",
      amountUsd: "100.00",
      amountVes: "95000.00",
      amount_ves: "95000.00",
      exchange_rate_id: randomUUID(),
      calculatedRate: "950.0000",
    });
    expect(res.status).toBe(422);
    const problem = (await res.json()) as { code: string; errors?: unknown[] };
    expect(problem.code).toBe("VALIDATION_ERROR");
    expect(problem.errors?.length).toBeGreaterThan(0);
    expect(
      await prisma.exchangeRate.count({ where: { tenantId: orgA, valueDate: new Date(today) } }),
    ).toBe(0);
  });

  it("override con motivo desde el panel: se crea is_override y se audita", async () => {
    const res = await override(ownerACookie, {
      rate: "950.0000",
      reason: "BCV no publicó",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      scope: "agency",
      rate: "950.0000",
      source: "MANUAL",
      isOverride: true,
    });

    const row = await prisma.exchangeRate.findFirstOrThrow({
      where: { tenantId: orgA, valueDate: new Date(today) },
    });
    expect(row.isOverride).toBe(true);
    expect(row.reason).toBe("BCV no publicó");
    expect(row.createdBy).toBe(ownerAId);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "exchange-rate.override", tenantId: orgA, entityId: row.id },
      orderBy: { at: "desc" },
    });
    expect(audit.actorId).toBe(ownerAId);
    expect(audit.before).toBeNull();
    expect(audit.after).toMatchObject({
      rate: "950.0000",
      reason: "BCV no publicó",
      isOverride: true,
    });
    // IP resuelta de forma confiable o null detrás de proxy no confiable.
    expect(audit.ip === null || typeof audit.ip === "string").toBe(true);
  });

});
