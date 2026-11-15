import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatRate, todayInCaracas } from "@caribe/shared";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { prisma } from "../src/prisma.js";
import { ExchangeRateService } from "../src/rates/exchange-rate.service.js";
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
 * E2E de tasas (T-F1-5, specs/exchange-rates).
 *
 * Cubre "Fuente disponible", "Ajuste manual", "Precedencia del override",
 * "El proveedor no pisa el override", "Override global", "Override global
 * gana a la tasa BCV" y "Tenencia de las tasas" con sesiones reales. El
 * proveedor DolarAPI se sustituye por un servidor HTTP local: la app se crea
 * después de fijar DOLARAPI_URL, así que el proveedor real apunta al doble.
 */
describe("exchange-rates (tasas)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let provider: Server;
  let providerStatus = 200;
  let providerPayload: unknown = { promedio: 900 };
  const suffix = randomUUID().slice(0, 8);
  const today = todayInCaracas();

  let orgA: string;
  let orgB: string;
  let orgC: string;
  let ownerACookie: string;
  let adminACookie: string;
  let ownerBCookie: string;
  let ownerCCookie: string;
  let agentCookie: string;
  let superCookie: string;

  beforeAll(async () => {
    provider = createServer((_request, response) => {
      response.statusCode = providerStatus;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(providerPayload));
    });
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    const address = provider.address() as AddressInfo;
    process.env.DOLARAPI_URL = `http://127.0.0.1:${address.port}/oficial`;

    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    // La BD conserva filas entre corridas: se eliminan las globales de hoy
    // que no estén referenciadas por un pago, para que el proveedor pueda
    // escribir la fila BCV y el caso "fuente disponible" sea determinista.
    await deleteTodayGlobalRates();

    const ownerA = await userWithTotp(baseUrl, `rates-owner-a-${suffix}@example.com`);
    orgA = (
      await createAgency(ownerA.userId, `Agencia Tasas A ${suffix}`, `tasas-a-${suffix}`)
    ).id;
    await setActiveOrg(baseUrl, ownerA.cookie, orgA);
    ownerACookie = ownerA.cookie;

    const adminA = await userWithTotp(baseUrl, `rates-admin-a-${suffix}@example.com`);
    await addMember(orgA, adminA.userId, "admin");
    await setActiveOrg(baseUrl, adminA.cookie, orgA);
    adminACookie = adminA.cookie;

    const agentEmail = `rates-agent-a-${suffix}@example.com`;
    const agentId = await createUser(agentEmail);
    await addMember(orgA, agentId, "agent");
    agentCookie = await signIn(baseUrl, agentEmail);
    await setActiveOrg(baseUrl, agentCookie, orgA);

    const ownerB = await userWithTotp(baseUrl, `rates-owner-b-${suffix}@example.com`);
    orgB = (
      await createAgency(ownerB.userId, `Agencia Tasas B ${suffix}`, `tasas-b-${suffix}`)
    ).id;
    await setActiveOrg(baseUrl, ownerB.cookie, orgB);
    ownerBCookie = ownerB.cookie;

    const ownerC = await userWithTotp(baseUrl, `rates-owner-c-${suffix}@example.com`);
    orgC = (
      await createAgency(ownerC.userId, `Agencia Tasas C ${suffix}`, `tasas-c-${suffix}`)
    ).id;
    await setActiveOrg(baseUrl, ownerC.cookie, orgC);
    ownerCCookie = ownerC.cookie;

    const superAdmin = await userWithTotp(baseUrl, `rates-super-${suffix}@example.com`);
    await prisma.user.update({
      where: { id: superAdmin.userId },
      data: { role: "super_admin" },
    });
    superCookie = superAdmin.cookie;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => provider?.close(() => resolve()));
    await app.close();
    // Restaura la tasa global de hoy: el seed de demostración (seed.e2e.ts)
    // espera la suya y no debe heredar el override MANUAL de este e2e.
    await deleteTodayGlobalRates();
    await prisma.$disconnect();
  });

  /**
   * Borra las tasas globales de hoy no referenciadas por pagos o reembolsos.
   * La BD es compartida entre archivos e2e: el seed solo crea su tasa `SEED`
   * si no existe una fila para la fecha, así que este archivo debe dejarla
   * como la encontró.
   */
  async function deleteTodayGlobalRates(): Promise<void> {
    await prisma.$executeRaw`
      DELETE FROM "exchange_rates"
      WHERE "tenant_id" IS NULL
        AND "value_date" = ${today}::date
        AND NOT EXISTS (
          SELECT 1 FROM "payments" p WHERE p."exchange_rate_id" = "exchange_rates"."id"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "refunds" r WHERE r."exchange_rate_id" = "exchange_rates"."id"
        )
    `;
  }

  function call(
    method: "GET" | "PUT",
    path: string,
    cookie: string,
    body?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = { cookie, origin: authOrigin };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(`${baseUrl}/api/v1${path}`, init);
  }

  function current(cookie: string): Promise<Response> {
    return call("GET", "/admin/exchange-rates/current", cookie);
  }

  function override(cookie: string, body: unknown): Promise<Response> {
    return call("PUT", "/admin/exchange-rates/override", cookie, body);
  }

  function globalOverride(cookie: string, body: unknown): Promise<Response> {
    return call("PUT", "/admin/exchange-rates/global-override", cookie, body);
  }

  it("fuente disponible: guarda la tasa global del día y la devuelve", async () => {
    providerStatus = 200;
    providerPayload = { promedio: 900 };

    const res = await current(ownerACookie);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      scope: "agency",
      valueDate: today,
      rate: "900.0000",
      source: "DOLARAPI",
      isOverride: false,
    });

    const row = await prisma.exchangeRate.findFirstOrThrow({
      where: { tenantId: null, valueDate: new Date(`${today}T00:00:00.000Z`) },
    });
    expect(row.source).toBe("DOLARAPI");
    expect(formatRate(row.rate)).toBe("900.0000");
    expect(row.isOverride).toBe(false);
  });

  it("override de agencia: escribe, audita antes/después y gana a la global", async () => {
    const res = await override(adminACookie, {
      rate: "950.0000",
      reason: "BCV no publicó",
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as Record<string, unknown>;
    expect(view).toMatchObject({
      scope: "agency",
      valueDate: today,
      rate: "950.0000",
      source: "MANUAL",
      isOverride: true,
    });

    const rateRow = await prisma.exchangeRate.findFirstOrThrow({
      where: { tenantId: orgA, valueDate: new Date(`${today}T00:00:00.000Z`) },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "exchange-rate.override", entityId: rateRow.id },
      orderBy: { at: "desc" },
    });
    expect(audit.tenantId).toBe(orgA);
    expect(audit.before).toBeNull();
    expect(audit.after).toMatchObject({ rate: "950.0000", isOverride: true });

    await expect(current(ownerACookie)).resolves.toMatchObject({ status: 200 });
    await expect((await current(ownerACookie)).json()).resolves.toMatchObject({
      rate: "950.0000",
      isOverride: true,
    });
    await expect((await current(ownerBCookie)).json()).resolves.toMatchObject({
      rate: "900.0000",
      isOverride: false,
    });
  });

  it("un segundo override de la misma fecha deja el estado previo en la auditoría", async () => {
    const res = await override(ownerACookie, {
      rate: "960.0000",
      reason: "Ajuste corregido",
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as Record<string, unknown>;

    const rateRow = await prisma.exchangeRate.findFirstOrThrow({
      where: { tenantId: orgA, valueDate: new Date(`${today}T00:00:00.000Z`) },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "exchange-rate.override", entityId: rateRow.id },
      orderBy: { at: "desc" },
    });
    expect(view).toMatchObject({ rate: "960.0000", isOverride: true });
    expect(audit.before).toMatchObject({ rate: "950.0000", isOverride: true });
    expect(audit.after).toMatchObject({ rate: "960.0000", reason: "Ajuste corregido" });
  });

  it("la agencia B no ve el override de A y puede fijar el suyo", async () => {
    const res = await override(ownerBCookie, {
      rate: "970.0000",
      reason: "Ajuste de B",
    });
    expect(res.status).toBe(200);

    await expect((await current(ownerACookie)).json()).resolves.toMatchObject({
      rate: "960.0000",
    });
    await expect((await current(ownerBCookie)).json()).resolves.toMatchObject({
      rate: "970.0000",
    });
  });

  it("override global: solo plataforma, con auditoría de tenant_id NULL", async () => {
    const res = await globalOverride(superCookie, {
      rate: "920.0000",
      reason: "Tasa global de contingencia",
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as Record<string, unknown>;
    expect(view).toMatchObject({
      scope: "platform",
      valueDate: today,
      rate: "920.0000",
      source: "MANUAL",
      isOverride: true,
    });

    const rateRow = await prisma.exchangeRate.findFirstOrThrow({
      where: { tenantId: null, valueDate: new Date(`${today}T00:00:00.000Z`) },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "exchange-rate.global-override",
        entityId: rateRow.id,
      },
      orderBy: { at: "desc" },
    });
    expect(audit.tenantId).toBeNull();
    expect(audit.after).toMatchObject({ rate: "920.0000", isOverride: true });
  });

  it("el override global gana a la tasa BCV para las agencias sin override", async () => {
    // Un GET fuerza el refresco global: el upsert del proveedor no debe pisar
    // la fila `is_override` de la fecha.
    await current(ownerCCookie);
    await expect((await current(ownerCCookie)).json()).resolves.toMatchObject({
      rate: "920.0000",
      isOverride: true,
    });
    // La agencia B conserva su propio override.
    await expect((await current(ownerBCookie)).json()).resolves.toMatchObject({
      rate: "970.0000",
      isOverride: true,
    });

    const row = await prisma.exchangeRate.findFirstOrThrow({
      where: { tenantId: null, valueDate: new Date(`${today}T00:00:00.000Z`) },
    });
    expect(row.isOverride).toBe(true);
    expect(formatRate(row.rate)).toBe("920.0000");
  });

  it("el catálogo público usa la tasa global, no el override de una agencia", async () => {
    const service = app.get(ExchangeRateService);
    await expect(service.globalRate(today)).resolves.toMatchObject({
      scope: "platform",
      rate: "920.0000",
      isOverride: true,
    });
  });

  it("un agente sin permiso recibe 403 y el Super Admin no fija overrides de agencia", async () => {
    const agent = await override(agentCookie, { rate: "950.0000", reason: "Intento" });
    expect(agent.status).toBe(403);

    const superAdmin = await override(superCookie, {
      rate: "950.0000",
      reason: "Intento",
    });
    expect(superAdmin.status).toBe(403);
  });

  it("una agencia activa no puede fijar el override global", async () => {
    const res = await globalOverride(ownerACookie, {
      rate: "930.0000",
      reason: "Intento",
    });
    expect(res.status).toBe(403);
  });

  it("valida el cuerpo del override: motivo, tasa y fecha valor", async () => {
    const noReason = await override(ownerACookie, { rate: "950.0000" });
    expect(noReason.status).toBe(422);

    const invalidRate = await override(ownerACookie, {
      rate: "0",
      reason: "Cero no es tasa",
    });
    expect(invalidRate.status).toBe(422);

    const tooManyDecimals = await override(ownerACookie, {
      rate: "900.00001",
      reason: "Demasiados decimales",
    });
    expect(tooManyDecimals.status).toBe(422);

    const pastDate = await override(ownerACookie, {
      rate: "950.0000",
      valueDate: "2020-01-01",
      reason: "Fecha pasada",
    });
    expect(pastDate.status).toBe(422);
  });
});
