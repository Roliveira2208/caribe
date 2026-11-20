import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { todayInCaracas } from "@caribe/shared";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { Prisma } from "../src/generated/prisma/client.js";
import { prisma } from "../src/prisma.js";
import { createAgency, createUser, setActiveOrg, signIn } from "./auth-helpers.js";

/**
 * E2E de la lectura pública de la tasa (change public-rate-and-price-filters,
 * spec exchange-rates "Lectura pública de la tasa vigente").
 *
 * El endpoint debe ser anónimo, no consultar al proveedor ni revelar overrides
 * de agencia. Sin tasa global responde 200 con `available: false` para que la
 * web pueda mostrar solo USD. Cotizave se sustituye por un doble que siempre
 * falla: cualquier llamada desde esta lectura se detecta con `providerCalls`.
 */
describe("exchange-rates (lectura pública)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let provider: Server;
  let providerCalls = 0;

  const suffix = randomUUID().slice(0, 8);
  const today = todayInCaracas();
  const yesterday = shiftDate(today, -1);
  const agencyRateId = randomUUID();
  let agencyTenantId: string | null = null;

  beforeAll(async () => {
    provider = createServer((_request, response) => {
      providerCalls += 1;
      response.statusCode = 500;
      response.end();
    });
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    const address = provider.address() as AddressInfo;
    process.env.COTIZAVE_API_URL = `http://127.0.0.1:${address.port}/v2/fx/VE/rates`;
    process.env.COTIZAVE_API_KEY = "ctz_live_test_no_usar";

    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");
  });

  beforeEach(async () => {
    providerCalls = 0;
    await deleteUnreferencedGlobalRates();
  });

  afterAll(async () => {
    await deleteUnreferencedGlobalRates();
    if (agencyTenantId) {
      await prisma.$executeRaw(Prisma.sql`
        DELETE FROM "exchange_rates" WHERE "tenant_id" = ${agencyTenantId}
      `);
    }
    await new Promise<void>((resolve) => provider?.close(() => resolve()));
    await app.close();
    await prisma.$disconnect();
  });

  it("Visitante sin sesión", async () => {
    await insertRate({ rate: "36.0000", valueDate: today });

    const { status, body } = await getJson<Record<string, unknown>>("/rates/today");
    expect(status).toBe(200);
    expect(body).toEqual({ available: true, rate: "36.0000", valueDate: today });
    expect(Object.keys(body)).toEqual(["available", "rate", "valueDate"]);
  });

  it("Feriado o fin de semana", async () => {
    await insertRate({ rate: "35.5000", valueDate: yesterday });

    const { status, body } = await getJson<PublicRate>("/rates/today");
    expect(status).toBe(200);
    expect(body).toEqual({ available: true, rate: "35.5000", valueDate: yesterday });
    expect(providerCalls).toBe(0);
  });

  it("Override global", async () => {
    await insertRate({
      rate: "37.1234",
      valueDate: today,
      isOverride: true,
      source: "MANUAL",
    });

    const { status, body } = await getJson<PublicRate>("/rates/today");
    expect(status).toBe(200);
    expect(body).toEqual({ available: true, rate: "37.1234", valueDate: today });
  });

  it("Override de una agencia", async () => {
    // El login dispara el refresco perezoso en segundo plano; el proveedor
    // siempre falla, así que no escribe ninguna fila que contamine la lectura.
    const email = `public-rate-owner-${suffix}@example.com`;
    const userId = await createUser(email);
    agencyTenantId = (
      await createAgency(userId, `Agencia Tasa Pública ${suffix}`, `public-rate-${suffix}`)
    ).id;
    const cookie = await signIn(baseUrl, email);
    await setActiveOrg(baseUrl, cookie, agencyTenantId);

    await deleteUnreferencedGlobalRates();
    await insertRate({ rate: "36.0000", valueDate: today });
    await insertRate({
      id: agencyRateId,
      tenantId: agencyTenantId,
      rate: "999.0000",
      valueDate: today,
      isOverride: true,
      source: "MANUAL",
    });

    const anonymous = await getJson<PublicRate>("/rates/today");
    expect(anonymous.status).toBe(200);
    expect(anonymous.body).toEqual({ available: true, rate: "36.0000", valueDate: today });

    const withSession = await getJson<PublicRate>("/rates/today", cookie);
    expect(withSession.status).toBe(200);
    expect(withSession.body).toEqual(anonymous.body);
  });

  it("Sin tasa global", async () => {
    const { status, body } = await getJson<PublicRate>("/rates/today");
    expect(status).toBe(200);
    expect(body).toEqual({ available: false, rate: null, valueDate: null });
  });

  it("Consulta perezosa", async () => {
    const before = await countRates();

    const { status, body } = await getJson<PublicRate>("/rates/today");
    expect(status).toBe(200);
    expect(body).toEqual({ available: false, rate: null, valueDate: null });
    expect(providerCalls).toBe(0);
    expect(await countRates()).toBe(before);
  });

  interface PublicRate {
    available: boolean;
    rate: string | null;
    valueDate: string | null;
  }

  async function getJson<T>(
    path: string,
    cookie?: string,
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      headers: cookie ? { cookie } : undefined,
    });
    return { status: response.status, body: (await response.json()) as T };
  }

  async function insertRate(params: {
    id?: string;
    tenantId?: string | null;
    rate: string;
    valueDate: string;
    isOverride?: boolean;
    source?: string;
  }): Promise<string> {
    const id = params.id ?? randomUUID();
    const isOverride = params.isOverride ?? false;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "exchange_rates"
        (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
      VALUES (${id}, ${params.tenantId ?? null}, ${params.source ?? "TEST"},
              ${params.rate}::numeric, ${params.valueDate}::date,
              (now() AT TIME ZONE 'UTC'), ${isOverride},
              ${isOverride ? "Prueba de lectura pública" : null}, NULL)
    `);
    return id;
  }

  async function countRates(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "exchange_rates"
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async function deleteUnreferencedGlobalRates(): Promise<void> {
    await prisma.$executeRaw`
      DELETE FROM "exchange_rates" er
      WHERE er."tenant_id" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "payments" p WHERE p."exchange_rate_id" = er."id"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "refunds" r WHERE r."exchange_rate_id" = er."id"
        )
    `;
  }
});

/** Fecha calendario `YYYY-MM-DD` desplazada en días. */
function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
