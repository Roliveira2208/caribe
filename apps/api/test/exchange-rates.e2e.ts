import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatRate, todayInCaracas } from "@caribe/shared";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { Prisma } from "../src/generated/prisma/client.js";
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
 * E2E de tasas (T-F1-5 y T-F1-5b, specs/exchange-rates).
 *
 * Cubre el refresco perezoso ("Fuente disponible", "Segundo login del mismo
 * día no consulta", "Fuente caída", "Alta de pago asegura la tasa del día") y
 * los overrides ("Ajuste manual", "Precedencia del override", "El proveedor no
 * pisa el override", "Override global", "Override global gana a la tasa BCV" y
 * "Tenencia de las tasas") con sesiones reales.
 *
 * Cotizave se sustituye por un servidor HTTP local: la app se crea después de
 * fijar `COTIZAVE_API_URL`, así que el proveedor real apunta al doble. El alta
 * de usuarios en pruebas no crea sesión (`autoSignIn: false`), de modo que el
 * primer login del archivo es el que dispara la consulta.
 */
describe("exchange-rates (tasas)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let provider: Server;
  let providerStatus = 200;
  let providerPayload: unknown = cotizaveRate("900.0000");
  let providerCalls = 0;
  let providerGate: Promise<void> | null = null;
  const suffix = randomUUID().slice(0, 8);
  const today = todayInCaracas();
  const yesterday = shiftDate(today, -1);
  const backupRateId = randomUUID();

  let loginEmail = "";

  beforeAll(async () => {
    provider = createServer((_request, response) => {
      providerCalls += 1;
      const gate = providerGate;
      const respond = (): void => {
        response.statusCode = providerStatus;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(providerPayload));
      };
      if (gate) {
        void gate.then(respond).catch(() => {
          response.statusCode = 500;
          response.end();
        });
      } else {
        respond();
      }
    });
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    const address = provider.address() as AddressInfo;
    process.env.COTIZAVE_API_URL = `http://127.0.0.1:${address.port}/v2/fx/VE/rates`;
    process.env.COTIZAVE_API_KEY = "ctz_live_test_no_usar";

    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    // La BD conserva filas entre corridas: se eliminan las globales no
    // referenciadas por pagos para que el refresco sea determinista y el seed
    // de demostración pueda crear la suya.
    await deleteUnreferencedGlobalRates();
    await deleteBackupRate();

    loginEmail = `rates-login-${suffix}@example.com`;
    await createUser(loginEmail);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => provider?.close(() => resolve()));
    await app.close();
    // Restaura la tasa global: el seed de demostración (seed.e2e.ts) espera
    // poder crearla y no debe heredar las filas de este e2e.
    await deleteUnreferencedGlobalRates();
    await deleteBackupRate();
    await prisma.$disconnect();
  });

  // La caída va primero a propósito: el refresco del login guarda la tasa del
  // proveedor en una caché de 1 h, así que solo la primera consulta del archivo
  // llega de verdad a Cotizave. El alta de usuarios no crea sesión
  // (`autoSignIn: false` en pruebas), de modo que este primer login es el que
  // dispara el refresco.
  it("fuente caída: el login responde igual y se usa la última tasa guardada", async () => {
    providerStatus = 500;
    providerCalls = 0;
    await deleteUnreferencedGlobalRates();
    await insertBackupRate();

    // La advertencia del refresco es la señal de que el proveedor ya falló y
    // la promesa compartida quedó liberada antes del siguiente login.
    const warn = vi.spyOn(Logger.prototype, "warn");
    try {
      const cookie = await signIn(baseUrl, loginEmail);
      expect(cookie).toContain("better-auth.session_token");

      await waitFor(() =>
        warn.mock.calls.some((call) =>
          String(call[0]).includes("se usa el respaldo guardado"),
        ),
      );
      // El `finally` de `ensureTodayRate` libera la promesa en el microtask
      // siguiente; un turno basta para que el próximo login no la reutilice.
      await delay(0);
    } finally {
      warn.mockRestore();
    }

    expect(providerCalls).toBeGreaterThanOrEqual(1);
    expect(await hasTodayRow()).toBe(false);
    const service = app.get(ExchangeRateService);
    await expect(service.globalRate(today)).resolves.toMatchObject({
      scope: "platform",
      valueDate: yesterday,
      rate: "890.0000",
      isOverride: false,
    });
  });

  it("fuente disponible: el primer login consulta y guarda COTIZAVE sin bloquear", async () => {
    providerStatus = 200;
    providerPayload = cotizaveRate("900.0000");
    await deleteUnreferencedGlobalRates();
    providerCalls = 0;

    const release = gateProvider();
    try {
      // El proveedor queda retenido: si el login esperase su respuesta, esta
      // promesa no resolvería y el test fallaría por tiempo.
      const cookie = await withTimeout(
        signIn(baseUrl, loginEmail),
        3_000,
        "el login esperó la respuesta de Cotizave",
      );
      expect(cookie).toContain("better-auth.session_token");
    } finally {
      release();
    }

    await waitFor(hasTodayRow);
    await delay(50);

    expect(providerCalls).toBeGreaterThanOrEqual(1);
    const row = await prisma.exchangeRate.findFirstOrThrow({
      where: { tenantId: null, valueDate: dateAt(today) },
    });
    expect(row.source).toBe("COTIZAVE");
    expect(formatRate(row.rate)).toBe("900.0000");
    expect(todayInCaracas(row.fetchedAt)).toBe(today);
  });

  it("segundo login del mismo día no consulta", async () => {
    providerCalls = 0;
    const cookie = await signIn(baseUrl, loginEmail);
    expect(cookie).toContain("better-auth.session_token");

    // El hook corre en segundo plano: se le da margen para que consulte la
    // base y decida no llamar al proveedor.
    await delay(300);
    expect(providerCalls).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Overrides y tenencia: aquí ya se usan sesiones administrativas con TOTP.
  // -------------------------------------------------------------------------
  describe("overrides y tenencia", () => {
    let orgA: string;
    let orgB: string;
    let orgC: string;
    let ownerACookie: string;
    let adminACookie: string;
    let ownerBCookie: string;
    let ownerCCookie: string;
    let ownerCUser: string;
    let agentCookie: string;
    let superCookie: string;

    const orgCProviderId = randomUUID();
    const orgCDestinationId = randomUUID();
    const orgCProductId = randomUUID();
    const orgCHotelKey = randomUUID();
    let paymentBookingId: string | null = null;

    beforeAll(async () => {
      // La tasa global de hoy ya existe (900) desde el login anterior: el
      // refresco de este bloque no consulta al proveedor y los overrides
      // parten de 900.
      providerStatus = 200;
      providerPayload = cotizaveRate("900.0000");

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
      ownerCUser = ownerC.userId;
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

      await waitFor(hasTodayRow);
    });

    afterAll(async () => {
      if (paymentBookingId) {
        await prisma.$executeRaw`
          DELETE FROM "payments" WHERE "booking_id" = ${paymentBookingId}
        `;
        await prisma.$executeRaw`
          DELETE FROM "bookings" WHERE "id" = ${paymentBookingId}
        `;
      }
      await prisma.$executeRaw`
        DELETE FROM "idempotency_keys" WHERE "user_id" = ${ownerCUser}
      `;
      await prisma.$executeRaw`
        DELETE FROM "products" WHERE "tenant_id" = ${orgC}
      `;
      await prisma.$executeRaw`
        DELETE FROM "destinations" WHERE "tenant_id" = ${orgC}
      `;
      await prisma.$executeRaw`
        DELETE FROM "providers" WHERE "tenant_id" = ${orgC}
      `;
      await prisma.$executeRaw(
        Prisma.sql`DELETE FROM "exchange_rates" WHERE "tenant_id" IN (${Prisma.join([orgA, orgB])})`,
      );
    });

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
        where: { tenantId: orgA, valueDate: dateAt(today) },
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
        where: { tenantId: orgA, valueDate: dateAt(today) },
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
        where: { tenantId: null, valueDate: dateAt(today) },
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
      // Un GET comprueba el refresco: hay una fila consultada hoy (el
      // override global), así que el proveedor no debe pisarla.
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
        where: { tenantId: null, valueDate: dateAt(today) },
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

    it("alta de pago asegura la tasa del día antes de congelarla", async () => {
      providerStatus = 200;
      providerPayload = cotizaveRate("910.0000");
      providerCalls = 0;
      // Sin fila global de hoy y con la de ayer como respaldo: el alta debe
      // consultar a Cotizave y congelar la tasa de hoy, no la de ayer.
      await deleteUnreferencedGlobalRates();
      await insertBackupRate();

      const bookingId = await createPayableBooking({
        tenantId: orgC,
        userId: ownerCUser,
        productId: orgCProductId,
        providerId: orgCProviderId,
        destinationId: orgCDestinationId,
        hotelKey: orgCHotelKey,
      });
      paymentBookingId = bookingId;

      const res = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/payments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerCCookie,
          origin: authOrigin,
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({
          method: "PAGO_MOVIL",
          bank: "Banesco",
          phone: "+584141234567",
          reference: `REF${suffix}`,
        }),
      });
      expect(res.status).toBe(201);
      await expect(res.json()).resolves.toMatchObject({
        amountUsd: "100.00",
        rate: "910.0000",
        valueDate: today,
      });
      expect(providerCalls).toBeGreaterThanOrEqual(1);

      const row = await prisma.exchangeRate.findFirstOrThrow({
        where: { tenantId: null, valueDate: dateAt(today) },
      });
      expect(row.source).toBe("COTIZAVE");
      expect(formatRate(row.rate)).toBe("910.0000");
    });

    async function createPayableBooking(params: {
      tenantId: string;
      userId: string;
      productId: string;
      providerId: string;
      destinationId: string;
      hotelKey: string;
    }): Promise<string> {
      const title = { es: "Hotel Tasas", en: "Rates Hotel" };
      const description = { es: "Habitación standard", en: "Standard room" };
      const attributes = JSON.stringify({
        stars: 4,
        maxGuests: 2,
        amenities: ["wifi"],
        images: [],
      });

      await prisma.$executeRaw`
        INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
        VALUES (${params.providerId}, ${params.tenantId}, ${`Proveedor ${suffix}`}, now(), now())
        ON CONFLICT ("id") DO NOTHING
      `;
      await prisma.$executeRaw`
        INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
        VALUES (${params.destinationId}, ${params.tenantId}, ${JSON.stringify({
          es: "Margarita",
          en: "Margarita",
        })}::jsonb, 'VE', ${`pmv-${suffix}`}, now(), now())
        ON CONFLICT ("id") DO NOTHING
      `;
      await prisma.$executeRaw`
        INSERT INTO "products"
          (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
           destination_id, status, base_price_usd, cancellation_policy_id, source, attributes,
           deleted_at, created_at, updated_at)
        VALUES (${params.productId}, ${params.tenantId}, ${params.providerId}, 'HOTEL',
                ${params.hotelKey}, 'standard', ${JSON.stringify(title)}::jsonb,
                ${JSON.stringify(description)}::jsonb, ${params.destinationId}, 'PUBLISHED',
                '100.00', NULL, 'OWN', ${attributes}::jsonb, NULL, now(), now())
        ON CONFLICT ("id") DO NOTHING
      `;

      const bookingId = randomUUID();
      const night1 = shiftDate(today, 10);
      const night2 = shiftDate(today, 11);
      await prisma.$executeRaw`
        INSERT INTO "bookings"
          (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
        VALUES (${bookingId}, ${params.tenantId}, ${generateBookingCode()}, ${params.userId},
                'PENDING_PAYMENT', '100.00', ${JSON.stringify([
                  {
                    fullName: "Ana Pérez",
                    documentType: "V",
                    documentNumber: "12345678",
                    phone: "+584141234567",
                    email: "ana@example.com",
                  },
                ])}::jsonb, now() + interval '30 minutes', now())
      `;
      await prisma.$executeRaw`
        INSERT INTO "booking_items"
          (id, booking_id, tenant_id, product_id, hotel_key, room_type, check_in, check_out,
           quantity, nightly_prices, subtotal_usd, product_title, policy_snapshot)
        VALUES (${randomUUID()}, ${bookingId}, ${params.tenantId}, ${params.productId},
                ${params.hotelKey}, 'standard', ${night1}::date, ${night2}::date, 1,
                ${JSON.stringify([{ night: night1, price_usd: "100.00" }])}::jsonb, '100.00',
                ${JSON.stringify(title)}::jsonb,
                ${JSON.stringify({ policyId: null, name: null, rules: [] })}::jsonb)
      `;
      return bookingId;
    }
  });

  // -------------------------------------------------------------------------
  // Utilidades del archivo
  // -------------------------------------------------------------------------

  /** Respuesta mínima de Cotizave V2: la tasa oficial del BCV en `mid`. */
  function cotizaveRate(mid: string): unknown {
    return { rates: [{ id: "ve-bcv", mid }] };
  }

  /** Fecha calendario `YYYY-MM-DD` desplazada en días. */
  function shiftDate(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  }

  /** Medianoche UTC de una fecha calendario, como la mapea Prisma `@db.Date`. */
  function dateAt(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(message)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function waitFor(
    check: () => Promise<boolean> | boolean,
    timeoutMs = 3_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await delay(25);
    }
    throw new Error("tiempo de espera agotado");
  }

  /** Retiene las respuestas del proveedor hasta que se suelte la compuerta. */
  function gateProvider(): () => void {
    let release!: () => void;
    providerGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      providerGate = null;
      release();
    };
  }

  async function hasTodayRow(): Promise<boolean> {
    const row = await prisma.exchangeRate.findFirst({
      where: { tenantId: null, valueDate: dateAt(today) },
      select: { id: true },
    });
    return row !== null;
  }

  /** Borra las tasas globales que ningún pago o reembolso referencia. */
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

  /** Tasa global de ayer, el respaldo cuando el proveedor no responde. */
  async function insertBackupRate(): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "exchange_rates"
        (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
      VALUES (${backupRateId}, NULL, 'COTIZAVE', 890.0000, ${yesterday}::date,
              now() - interval '1 day', false, NULL, NULL)
      ON CONFLICT ("id") DO UPDATE SET
        rate = EXCLUDED.rate,
        value_date = EXCLUDED.value_date,
        fetched_at = EXCLUDED.fetched_at
    `);
  }

  async function deleteBackupRate(): Promise<void> {
    await prisma.$executeRaw`
      DELETE FROM "exchange_rates" WHERE "id" = ${backupRateId}
    `;
  }
});
