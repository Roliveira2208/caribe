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
  const future = shiftDate(today, 2);

  let orgA: string;
  let orgB: string;
  let ownerAId: string;
  let ownerACookie: string;
  let adminACookie: string;
  let agentACookie: string;
  let providerACookie: string;
  let memberACookie: string;
  let noTotpCookie: string;
  let revokedCookie: string;
  let revokedMemberId: string;
  let ownerBCookie: string;
  let superCookie: string;

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
  const globalOverride = (cookie: string, body: Record<string, unknown>) =>
    call("PUT", "/admin/exchange-rates/global-override", cookie, body);

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

    const ownerB = await userWithTotp(baseUrl, `owner-f2-b-${suffix}@example.com`);
    ownerBCookie = ownerB.cookie;
    orgB = (await createAgency(ownerB.userId, `F2 B ${suffix}`, `f2-b-${suffix}`)).id;
    await setActiveOrg(baseUrl, ownerBCookie, orgB);

    const superAdmin = await userWithTotp(baseUrl, `super-f2-${suffix}@example.com`);
    await prisma.user.update({ where: { id: superAdmin.userId }, data: { role: "super_admin" } });
    superCookie = superAdmin.cookie;

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

  it("sin permiso de tasa: member, agente y Super Admin de agencia reciben 403", async () => {
    for (const cookie of [memberACookie, agentACookie]) {
      const res = await current(cookie);
      expect(res.status).toBe(cookie === memberACookie ? 403 : 200);
      const write = await override(cookie, { rate: "950.0000", reason: "Intento" });
      expect(write.status).toBe(403);
      await expect(write.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
    }
    const superWrite = await override(superCookie, { rate: "950.0000", reason: "Intento" });
    expect(superWrite.status).toBe(403);
    await expect(superWrite.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
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

  it("confirmación de override vigente: el segundo guarda el antes y el después", async () => {
    const res = await override(adminACookie, { rate: "960.0000", reason: "Ajuste corregido" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ rate: "960.0000", isOverride: true });

    const row = await prisma.exchangeRate.findFirstOrThrow({
      where: { tenantId: orgA, valueDate: new Date(today) },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "exchange-rate.override", entityId: row.id },
      orderBy: { at: "desc" },
    });
    expect(audit.before).toMatchObject({ rate: "950.0000", isOverride: true });
    expect(audit.after).toMatchObject({ rate: "960.0000", reason: "Ajuste corregido" });
  });

  it("auditoría y override de otra agencia: A no ve la fila ni el motivo de B", async () => {
    const foreign = await override(ownerBCookie, {
      rate: "980.0000",
      reason: `Motivo privado de B ${suffix}`,
    });
    expect(foreign.status).toBe(200);

    await expect((await current(ownerACookie)).json()).resolves.toMatchObject({
      rate: "960.0000",
      isOverride: true,
    });

    const logs = await call("GET", "/admin/audit-logs", ownerACookie);
    expect(logs.status).toBe(200);
    const { items } = (await logs.json()) as { items: Array<Record<string, unknown>> };
    const reasons = JSON.stringify(items);
    expect(reasons).toContain("Ajuste corregido");
    expect(reasons).not.toContain(`Motivo privado de B ${suffix}`);
    expect(orgB).not.toBe("");

    // No hay ruta por id: un intento de inyectar la entidad de B en el cuerpo
    // se rechaza como campo desconocido, sin filas ni motivo de B en A.
    const injected = await override(ownerACookie, {
      rate: "970.0000",
      reason: "Intento sobre B",
      entityId: (await prisma.exchangeRate.findFirstOrThrow({
        where: { tenantId: orgB, valueDate: new Date(today) },
      })).id,
    });
    expect(injected.status).toBe(422);
  });

  it("fecha valor futura: no se aplica como vigente antes de esa fecha", async () => {
    const res = await override(ownerACookie, {
      rate: "940.0000",
      reason: "Ajuste programado",
      valueDate: future,
    });
    expect(res.status).toBe(200);
    await expect((await current(ownerACookie)).json()).resolves.toMatchObject({
      rate: "960.0000",
      valueDate: today,
    });
    const pending = await prisma.exchangeRate.findFirstOrThrow({
      where: { tenantId: orgA, valueDate: new Date(future) },
    });
    expect(pending.isOverride).toBe(true);
  });

  it("tasa global del Super Admin: tenant NULL sin revelar la de las agencias", async () => {
    const res = await globalOverride(superCookie, {
      rate: "920.0000",
      reason: "Contingencia global",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      scope: "platform",
      rate: "920.0000",
      isOverride: true,
    });
    const row = await prisma.exchangeRate.findFirstOrThrow({
      where: { tenantId: null, valueDate: new Date(today) },
    });
    expect(row.isOverride).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "exchange-rate.global-override", entityId: row.id },
    });
    expect(audit.tenantId).toBeNull();
    await expect((await current(ownerACookie)).json()).resolves.toMatchObject({ rate: "960.0000" });
  });
});

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
