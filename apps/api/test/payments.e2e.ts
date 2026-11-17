import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { todayInCaracas } from "@caribe/shared";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { addDays } from "../src/catalog/catalog.schemas.js";
import { ApiProblemException } from "../src/errors/api-problem.exception.js";
import { BookingExpirationService } from "../src/jobs/booking-expiration.service.js";
import { prisma } from "../src/prisma.js";
import { ExchangeRateService } from "../src/rates/exchange-rate.service.js";
import {
  createAuditFailureTrigger,
  type AuditFailureTrigger,
} from "./audit-failure-trigger.js";
import { authOrigin, addMember, createUser, setActiveOrg, signIn, userWithTotp } from "./auth-helpers.js";

/**
 * E2E de pagos (T-F1-9, delta de payments "Creación de pago", "Modo de
 * aprobación", "Datos por método de pago", "Serialización de montos" y
 * "Máquina de estados del pago").
 *
 * Agencias, productos, tasas, reservas y pagos en revisión se montan por SQL
 * directo (el cliente de pruebas conecta como superusuario y no pasa por RLS);
 * el alta y la revisión se ejercitan por HTTP con sesiones reales. Cada caso
 * parte de un estado limpio: antes de cada prueba se borran los pagos, las
 * reservas y las claves de idempotencia de las agencias y usuarios de la
 * suite. Los reembolsos (refunds) pasan a T-F1-10 y no se prueban aquí.
 */
describe("payments (alta y revisión)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let owner: Client;
  let expiration: BookingExpirationService;

  let clientA = "";
  let clientB = "";
  let cookieA = "";
  let cookieB = "";

  let ownerA = "";
  let adminA = "";
  let agentA = "";
  let providerA = "";
  let ownerB = "";
  let adminB = "";
  let ownerFail = "";
  let superAdmin = "";

  let cookieOwnerA = "";
  let cookieAdminA = "";
  let cookieAgentA = "";
  let cookieProviderA = "";
  let cookieOwnerB = "";
  let cookieAdminB = "";
  let cookieOwnerFail = "";
  let cookieSuper = "";

  let auditFailure: AuditFailureTrigger | undefined;

  const suffix = randomUUID().slice(0, 8);

  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgFail = randomUUID();
  const orgNoRate = randomUUID();

  const providerRowA = randomUUID();
  const providerRowB = randomUUID();
  const providerRowFail = randomUUID();
  const providerRowNoRate = randomUUID();

  const destA = randomUUID();
  const destB = randomUUID();
  const destFail = randomUUID();
  const destNoRate = randomUUID();

  const pA = randomUUID();
  const pB = randomUUID();
  const pFail = randomUUID();
  const pNoRate = randomUUID();
  const pExpire = randomUUID();

  const hotelA = randomUUID();
  const hotelB = randomUUID();
  const hotelFail = randomUUID();
  const hotelNoRate = randomUUID();
  const hotelExpire = randomUUID();

  const rateA = randomUUID();
  const rateB = randomUUID();
  const rateFail = randomUUID();

  const today = todayInCaracas();
  const night1 = addDays(today, 10);
  const night2 = addDays(today, 11);

  /** Valores iniciales de `reserved` para restaurarlos antes de cada prueba. */
  const availabilityBaseline: Array<{ productId: string; night: string; reserved: number }> = [];

  const title = { es: "Hotel Sol", en: "Sun Hotel" };
  const description = { es: "Habitación standard", en: "Standard room" };
  const attributes = JSON.stringify({
    stars: 4,
    maxGuests: 2,
    amenities: ["wifi", "pool"],
    images: [],
  });

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");
    expiration = app.get(BookingExpirationService);

    owner = new Client({ connectionString: process.env.DATABASE_URL });
    await owner.connect();

    clientA = await createUser(`payments-a-${suffix}@example.com`);
    clientB = await createUser(`payments-b-${suffix}@example.com`);
    cookieA = await signIn(baseUrl, `payments-a-${suffix}@example.com`);
    cookieB = await signIn(baseUrl, `payments-b-${suffix}@example.com`);

    await owner.query(
      `INSERT INTO "organization" (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, now()), ($4, $5, $6, now()),
              ($7, $8, $9, now()), ($10, $11, $12, now())`,
      [
        orgA,
        `Pagos A ${suffix}`,
        `pagos-a-${suffix}`,
        orgB,
        `Pagos B ${suffix}`,
        `pagos-b-${suffix}`,
        orgFail,
        `Pagos auditoría ${suffix}`,
        `pagos-fail-${suffix}`,
        orgNoRate,
        `Pagos sin tasa ${suffix}`,
        `pagos-sin-tasa-${suffix}`,
      ],
    );

    // Revisores y personal. Owner/admin/super admin necesitan TOTP para las
    // rutas /admin; el agente y el proveedor no son roles administrativos.
    const ownerAUser = await userWithTotp(baseUrl, `payments-owner-a-${suffix}@example.com`);
    ownerA = ownerAUser.userId;
    cookieOwnerA = ownerAUser.cookie;
    await addMember(orgA, ownerA, "owner");
    await setActiveOrg(baseUrl, cookieOwnerA, orgA);

    const adminAUser = await userWithTotp(baseUrl, `payments-admin-a-${suffix}@example.com`);
    adminA = adminAUser.userId;
    cookieAdminA = adminAUser.cookie;
    await addMember(orgA, adminA, "admin");
    await setActiveOrg(baseUrl, cookieAdminA, orgA);

    agentA = await createUser(`payments-agent-a-${suffix}@example.com`);
    cookieAgentA = await signIn(baseUrl, `payments-agent-a-${suffix}@example.com`);
    await addMember(orgA, agentA, "agent");
    await setActiveOrg(baseUrl, cookieAgentA, orgA);

    providerA = await createUser(`payments-provider-a-${suffix}@example.com`);
    cookieProviderA = await signIn(baseUrl, `payments-provider-a-${suffix}@example.com`);
    await addMember(orgA, providerA, "provider");
    await setActiveOrg(baseUrl, cookieProviderA, orgA);

    const ownerBUser = await userWithTotp(baseUrl, `payments-owner-b-${suffix}@example.com`);
    ownerB = ownerBUser.userId;
    cookieOwnerB = ownerBUser.cookie;
    await addMember(orgB, ownerB, "owner");
    await setActiveOrg(baseUrl, cookieOwnerB, orgB);

    const adminBUser = await userWithTotp(baseUrl, `payments-admin-b-${suffix}@example.com`);
    adminB = adminBUser.userId;
    cookieAdminB = adminBUser.cookie;
    await addMember(orgB, adminB, "admin");
    await setActiveOrg(baseUrl, cookieAdminB, orgB);

    const ownerFailUser = await userWithTotp(baseUrl, `payments-owner-fail-${suffix}@example.com`);
    ownerFail = ownerFailUser.userId;
    cookieOwnerFail = ownerFailUser.cookie;
    await addMember(orgFail, ownerFail, "owner");
    await setActiveOrg(baseUrl, cookieOwnerFail, orgFail);

    const superUser = await userWithTotp(baseUrl, `payments-super-${suffix}@example.com`);
    superAdmin = superUser.userId;
    cookieSuper = superUser.cookie;
    await owner.query(`UPDATE "user" SET role = 'super_admin' WHERE id = $1`, [superAdmin]);

    await owner.query(
      `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now()), ($4, $5, $6, now(), now()),
              ($7, $8, $9, now(), now()), ($10, $11, $12, now(), now())`,
      [
        providerRowA,
        orgA,
        `Proveedor A ${suffix}`,
        providerRowB,
        orgB,
        `Proveedor B ${suffix}`,
        providerRowFail,
        orgFail,
        `Proveedor auditoría ${suffix}`,
        providerRowNoRate,
        orgNoRate,
        `Proveedor sin tasa ${suffix}`,
      ],
    );

    await owner.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now()),
              ($5, $6, $7::jsonb, 'VE', $8, now(), now()),
              ($9, $10, $11::jsonb, 'VE', $12, now(), now()),
              ($13, $14, $15::jsonb, 'VE', $16, now(), now())`,
      [
        destA,
        orgA,
        JSON.stringify({ es: "Mérida", en: "Merida" }),
        `mer-${suffix}`,
        destB,
        orgB,
        JSON.stringify({ es: "Margarita", en: "Margarita" }),
        `pmv-${suffix}`,
        destFail,
        orgFail,
        JSON.stringify({ es: "Canaima", en: "Canaima" }),
        `cna-${suffix}`,
        destNoRate,
        orgNoRate,
        JSON.stringify({ es: "Coro", en: "Coro" }),
        `crh-${suffix}`,
      ],
    );

    // Modo de aprobación: orgA AUTO, orgB y orgFail MANUAL.
    await owner.query(
      `INSERT INTO "tenant_settings" (tenant_id, hold_minutes, payment_mode, updated_at)
       VALUES ($1, 30, 'AUTO', now()), ($2, 30, 'MANUAL', now()),
              ($3, 30, 'MANUAL', now()), ($4, 30, 'AUTO', now())`,
      [orgA, orgB, orgFail, orgNoRate],
    );

    // Tasa congelada de cada agencia. orgNoRate se queda sin tasa a propósito.
    await owner.query(
      `INSERT INTO "exchange_rates"
         (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
       VALUES ($1, $2, 'MANUAL', 900.0000, $3::date, now(), true, 'Prueba de pagos', $4),
              ($5, $6, 'MANUAL', 800.0000, $3::date, now(), true, 'Prueba de pagos', $7),
              ($8, $9, 'MANUAL', 900.0000, $3::date, now(), true, 'Prueba de pagos', $10)`,
      [rateA, orgA, today, ownerA, rateB, orgB, ownerB, rateFail, orgFail, ownerFail],
    );

    await product({
      id: pA,
      tenantId: orgA,
      providerId: providerRowA,
      destinationId: destA,
      hotelKey: hotelA,
      roomType: "standard",
    });
    await product({
      id: pB,
      tenantId: orgB,
      providerId: providerRowB,
      destinationId: destB,
      hotelKey: hotelB,
      roomType: "standard",
    });
    await product({
      id: pFail,
      tenantId: orgFail,
      providerId: providerRowFail,
      destinationId: destFail,
      hotelKey: hotelFail,
      roomType: "standard",
    });
    await product({
      id: pNoRate,
      tenantId: orgNoRate,
      providerId: providerRowNoRate,
      destinationId: destNoRate,
      hotelKey: hotelNoRate,
      roomType: "standard",
    });
    await product({
      id: pExpire,
      tenantId: orgB,
      providerId: providerRowB,
      destinationId: destB,
      hotelKey: hotelExpire,
      roomType: "suite",
    });

    // Disponibilidad de la reserva de la carrera pago/expiración: una noche
    // retenida que la expiración debe liberar exactamente una vez.
    await availability(pExpire, orgB, night1, 5, 0, "100.00");
    await availability(pExpire, orgB, night2, 5, 0, "100.00");

    auditFailure = await createAuditFailureTrigger(owner, orgFail);
  });

  beforeEach(async () => {
    const tenantIds = [orgA, orgB, orgFail, orgNoRate];
    const userIds = [clientA, clientB].filter((id) => id.length > 0);
    await dropSlowPaymentUpdate();
    await owner.query(`DELETE FROM "payments" WHERE "tenant_id" = ANY($1::text[])`, [
      tenantIds,
    ]);
    await owner.query(`DELETE FROM "bookings" WHERE "tenant_id" = ANY($1::text[])`, [
      tenantIds,
    ]);
    if (userIds.length > 0) {
      await owner.query(`DELETE FROM "idempotency_keys" WHERE "user_id" = ANY($1::text[])`, [
        userIds,
      ]);
    }
    await owner.query(
      `UPDATE "tenant_settings" SET "payment_mode" = 'AUTO' WHERE "tenant_id" = $1`,
      [orgA],
    );
    await owner.query(
      `UPDATE "tenant_settings" SET "payment_mode" = 'MANUAL' WHERE "tenant_id" = ANY($1::text[])`,
      [[orgB, orgFail]],
    );
    for (const row of availabilityBaseline) {
      await owner.query(
        `UPDATE "availability" SET "reserved" = $1
          WHERE "product_id" = $2 AND "night" = $3::date`,
        [row.reserved, row.productId, row.night],
      );
    }
  });

  afterAll(async () => {
    if (owner) {
      await auditFailure?.drop();
      await dropSlowPaymentUpdate();
      const tenantIds = [orgA, orgB, orgFail, orgNoRate];
      const userIds = [clientA, clientB].filter((id) => id.length > 0);
      await owner.query(`DELETE FROM "payments" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "bookings" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      if (userIds.length > 0) {
        await owner.query(`DELETE FROM "idempotency_keys" WHERE "user_id" = ANY($1::text[])`, [
          userIds,
        ]);
      }
      await owner.query(`DELETE FROM "exchange_rates" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "availability" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "products" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "tenant_settings" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "destinations" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "providers" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "organization" WHERE "id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.end();
    }
    await app?.close();
    await prisma.$disconnect();
  });

  interface PaymentBodyResponse {
    id: string;
    tenantId: string;
    bookingId: string;
    method: string;
    status: string;
    amountUsd: string;
    amountVes: string;
    rate: string;
    valueDate: string;
    reference: string | null;
    reportedBy: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    rejectionReason: string | null;
    paidAt: string | null;
    createdAt: string;
  }

  interface PaymentPageBody {
    items: PaymentBodyResponse[];
    nextCursor: string | null;
  }

  interface BookingPaymentsBody {
    items: PaymentBodyResponse[];
  }

  interface ProblemBody {
    status: number;
    code: string;
    detail?: string;
    errors?: Array<{ path: string; message: string }>;
  }

  async function product(params: {
    id: string;
    tenantId: string;
    providerId: string;
    destinationId: string;
    hotelKey: string;
    roomType: string;
  }): Promise<void> {
    await owner.query(
      `INSERT INTO "products"
         (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
          destination_id, status, base_price_usd, cancellation_policy_id, source, attributes,
          deleted_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'HOTEL', $4, $5, $6::jsonb, $7::jsonb, $8, 'PUBLISHED', '100.00', NULL,
               'OWN', $9::jsonb, NULL, now(), now())`,
      [
        params.id,
        params.tenantId,
        params.providerId,
        params.hotelKey,
        params.roomType,
        JSON.stringify(title),
        JSON.stringify(description),
        params.destinationId,
        attributes,
      ],
    );
  }

  async function availability(
    productId: string,
    tenantId: string,
    night: string,
    capacity: number,
    reserved: number,
    price: string,
  ): Promise<void> {
    await owner.query(
      `INSERT INTO "availability"
         (id, tenant_id, product_id, night, capacity, reserved, price_usd, created_at, updated_at)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, now(), now())`,
      [randomUUID(), tenantId, productId, night, capacity, reserved, price],
    );
    availabilityBaseline.push({ productId, night, reserved });
  }

  async function createBooking(params: {
    tenantId: string;
    userId: string;
    productId: string;
    hotelKey: string;
    roomType: string;
    status?: "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "EXPIRED";
    totalUsd?: string;
    expiresInMinutes?: number;
  }): Promise<string> {
    const id = randomUUID();
    const total = params.totalUsd ?? "100.00";
    await owner.query(
      `INSERT INTO "bookings"
         (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb,
               now() + make_interval(mins => $8), now())`,
      [
        id,
        params.tenantId,
        generateBookingCode(),
        params.userId,
        params.status ?? "PENDING_PAYMENT",
        total,
        JSON.stringify([
          {
            fullName: "Ana Pérez",
            documentType: "V",
            documentNumber: "12345678",
            phone: "+584141234567",
            email: "ana@example.com",
          },
        ]),
        params.expiresInMinutes ?? 30,
      ],
    );
    await owner.query(
      `INSERT INTO "booking_items"
         (id, booking_id, tenant_id, product_id, hotel_key, room_type, check_in, check_out,
          quantity, nightly_prices, subtotal_usd, product_title, policy_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, 1, $9::jsonb, $10, $11::jsonb, $12::jsonb)`,
      [
        randomUUID(),
        id,
        params.tenantId,
        params.productId,
        params.hotelKey,
        params.roomType,
        night1,
        night2,
        JSON.stringify([{ night: night1, price_usd: total }]),
        total,
        JSON.stringify(title),
        JSON.stringify({ policyId: null, name: null, rules: [] }),
      ],
    );
    return id;
  }

  async function createPaymentFixture(params: {
    tenantId: string;
    bookingId: string;
    reportedBy: string;
    rateId: string;
    rate: string;
    totalUsd?: string;
    status: "IN_REVIEW" | "REJECTED" | "APPROVED";
    method?: "PAGO_MOVIL" | "ZELLE" | "BINANCE_PAY" | "CARD";
    reference?: string | null;
    reviewedBy?: string | null;
  }): Promise<string> {
    const id = randomUUID();
    const total = params.totalUsd ?? "100.00";
    const amountVes = (Number(total) * Number(params.rate)).toFixed(2);
    const reviewed = params.status !== "IN_REVIEW";
    await owner.query(
      `INSERT INTO "payments"
         (id, tenant_id, booking_id, method, amount_usd, amount_ves, exchange_rate_id, rate,
          value_date, reference, status, reported_by, reviewed_by, reviewed_at,
          rejection_reason, paid_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12, $13, $14, $15, $16, now())`,
      [
        id,
        params.tenantId,
        params.bookingId,
        params.method ?? "PAGO_MOVIL",
        total,
        amountVes,
        params.rateId,
        params.rate,
        today,
        params.reference ?? null,
        params.status,
        params.reportedBy,
        reviewed ? (params.reviewedBy ?? null) : null,
        reviewed ? new Date() : null,
        params.status === "REJECTED" ? "Motivo previo" : null,
        params.status === "APPROVED" ? new Date() : null,
      ],
    );
    return id;
  }

  /**
   * Retrasa la escritura de un pago concreto 300 ms para que dos revisiones
   * concurrentes se solapen de verdad: ambas leen IN_REVIEW y la perdedora
   * espera el bloqueo y responde PAYMENT_ALREADY_REVIEWED.
   */
  async function createSlowPaymentUpdate(paymentId: string): Promise<void> {
    await dropSlowPaymentUpdate();
    await owner.query(
      `CREATE FUNCTION "payments_slow_test_fn"() RETURNS trigger AS $$
       BEGIN
         PERFORM pg_sleep(0.3);
         RETURN NEW;
       END;
       $$ LANGUAGE plpgsql`,
    );
    await owner.query(
      `CREATE TRIGGER "payments_slow_test"
         BEFORE UPDATE ON "payments"
         FOR EACH ROW
         WHEN (NEW."id" = '${paymentId}')
         EXECUTE FUNCTION "payments_slow_test_fn"()`,
    );
  }

  async function dropSlowPaymentUpdate(): Promise<void> {
    await owner.query(`DROP TRIGGER IF EXISTS "payments_slow_test" ON "payments"`);
    await owner.query(`DROP FUNCTION IF EXISTS "payments_slow_test_fn"()`);
  }

  function url(path: string): string {
    return `${baseUrl}/api/v1${path}`;
  }

  function keyFor(): string {
    return randomUUID();
  }

  function pagoMovilBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      method: "PAGO_MOVIL",
      bank: "Banesco",
      phone: "+584141234567",
      reference: "1234",
      ...overrides,
    };
  }

  async function postPayment(
    cookie: string | null,
    bookingId: string,
    key: string | null,
    body: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      origin: authOrigin,
    };
    if (cookie) headers["cookie"] = cookie;
    if (key) headers["Idempotency-Key"] = key;
    return fetch(url(`/bookings/${bookingId}/payments`), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  async function review(
    cookie: string,
    paymentId: string,
    action: "approve" | "reject",
    body?: unknown,
  ): Promise<Response> {
    return fetch(url(`/admin/payments/${paymentId}/${action}`), {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: authOrigin,
        cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function listPayments(cookie: string, query = ""): Promise<Response> {
    return fetch(url(`/admin/payments${query}`), {
      headers: { cookie, origin: authOrigin },
    });
  }

  async function jsonOf<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  async function expectProblem(
    res: Response,
    status: number,
    code: string,
  ): Promise<ProblemBody> {
    expect(res.status).toBe(status);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await jsonOf<ProblemBody>(res);
    expect(body).toMatchObject({ status, code });
    return body;
  }

  async function countPayments(tenantId: string): Promise<number> {
    return prisma.payment.count({ where: { tenantId } });
  }

  async function bookingStatus(bookingId: string): Promise<string> {
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { status: true },
    });
    return row.status;
  }

  async function paymentStatus(paymentId: string): Promise<string> {
    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true },
    });
    return row.status;
  }

  async function reservedOf(productId: string): Promise<number[]> {
    const rows = await prisma.availability.findMany({
      where: { productId },
      orderBy: { night: "asc" },
      select: { reserved: true },
    });
    return rows.map((row) => row.reserved);
  }

  describe("Creación de pago", () => {
    it("crea el pago en VES con la tasa congelada y aprueba en modo AUTO", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });

      const res = await postPayment(cookieA, bookingId, keyFor(), pagoMovilBody());
      expect(res.status).toBe(201);

      const payment = await jsonOf<PaymentBodyResponse>(res);
      expect(payment).toMatchObject({
        tenantId: orgA,
        bookingId,
        method: "PAGO_MOVIL",
        status: "APPROVED",
        amountUsd: "100.00",
        amountVes: "90000.00",
        rate: "900.0000",
        valueDate: today,
        reference: "1234",
        reportedBy: clientA,
        reviewedBy: null,
        rejectionReason: null,
      });
      // PENDING es interno: nunca se observa por la API.
      expect(payment.status).not.toBe("PENDING");
      expect(payment.paidAt).toMatch(/Z$/);
      expect(payment.createdAt).toMatch(/Z$/);

      const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(stored.amountUsd.toString()).toBe("100");
      expect(stored.amountVes.toString()).toBe("90000");
      expect(stored.exchangeRateId).toBe(rateA);
      await expect(bookingStatus(bookingId)).resolves.toBe("CONFIRMED");
    });

    it("deja el pago en revisión en modo MANUAL", async () => {
      const bookingId = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
      });

      const res = await postPayment(cookieB, bookingId, keyFor(), pagoMovilBody());
      expect(res.status).toBe(201);
      const payment = await jsonOf<PaymentBodyResponse>(res);
      expect(payment).toMatchObject({ status: "IN_REVIEW", amountVes: "80000.00", rate: "800.0000" });
      expect(payment.status).not.toBe("PENDING");
      await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");
    });

    it("rechaza montos, tasas y campos calculados enviados por el cliente", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });

      const res = await postPayment(cookieA, bookingId, keyFor(), {
        ...pagoMovilBody(),
        amount_usd: "1.00",
        amount_ves: "1.00",
        rate: "1.0000",
        tenant_id: orgB,
        user_id: clientB,
      });
      const problem = await expectProblem(res, 422, "VALIDATION_ERROR");
      expect(problem.errors?.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(["amount_usd", "amount_ves", "rate", "tenant_id", "user_id"]),
      );
      await expect(countPayments(orgA)).resolves.toBe(0);
      await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");
    });

    it("rechaza una reserva vencida con 410", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        status: "EXPIRED",
        expiresInMinutes: -5,
      });
      const res = await postPayment(cookieA, bookingId, keyFor(), pagoMovilBody());
      await expectProblem(res, 410, "HOLD_EXPIRED");
      await expect(countPayments(orgA)).resolves.toBe(0);
    });

    it("rechaza una reserva vencida por fecha aunque siga pendiente con 410", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        expiresInMinutes: -5,
      });
      const res = await postPayment(cookieA, bookingId, keyFor(), pagoMovilBody());
      await expectProblem(res, 410, "HOLD_EXPIRED");
      await expect(countPayments(orgA)).resolves.toBe(0);
    });

    it("rechaza una reserva cancelada con 409", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        status: "CANCELLED",
      });
      const res = await postPayment(cookieA, bookingId, keyFor(), pagoMovilBody());
      await expectProblem(res, 409, "BOOKING_CANCELLED");
      await expect(countPayments(orgA)).resolves.toBe(0);
    });

    it("rechaza una reserva ya confirmada con 409", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        status: "CONFIRMED",
      });
      const res = await postPayment(cookieA, bookingId, keyFor(), pagoMovilBody());
      await expectProblem(res, 409, "BOOKING_ALREADY_PAID");
      await expect(countPayments(orgA)).resolves.toBe(0);
    });

    it("responde 404 si la reserva es de otro cliente", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const res = await postPayment(cookieB, bookingId, keyFor(), pagoMovilBody());
      await expectProblem(res, 404, "NOT_FOUND");
      await expect(countPayments(orgA)).resolves.toBe(0);
    });

    it("responde 401 a un visitante anónimo", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const res = await postPayment(null, bookingId, keyFor(), pagoMovilBody());
      await expectProblem(res, 401, "UNAUTHENTICATED");
      await expect(countPayments(orgA)).resolves.toBe(0);
    });

    it("exige el encabezado Idempotency-Key", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const res = await postPayment(cookieA, bookingId, null, pagoMovilBody());
      await expectProblem(res, 400, "IDEMPOTENCY_KEY_REQUIRED");
      await expect(countPayments(orgA)).resolves.toBe(0);
    });

    it("devuelve la misma respuesta en un reintento y rechaza la clave con otro cuerpo", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const key = keyFor();

      const first = await postPayment(cookieA, bookingId, key, pagoMovilBody());
      expect(first.status).toBe(201);
      const created = await jsonOf<PaymentBodyResponse>(first);

      const replay = await postPayment(cookieA, bookingId, key, pagoMovilBody());
      expect(replay.status).toBe(201);
      const replayed = await jsonOf<PaymentBodyResponse>(replay);
      expect(replayed.id).toBe(created.id);
      expect(replayed.status).toBe(created.status);
      await expect(countPayments(orgA)).resolves.toBe(1);

      const reused = await postPayment(
        cookieA,
        bookingId,
        key,
        pagoMovilBody({ reference: "9999" }),
      );
      await expectProblem(reused, 409, "IDEMPOTENCY_KEY_REUSED");
      await expect(countPayments(orgA)).resolves.toBe(1);

      const audit = await prisma.auditLog.count({
        where: { entityId: created.id, action: "payment.create" },
      });
      expect(audit).toBe(1);
    });

    it("responde 503 RATE_UNAVAILABLE y no crea el pago si no hay tasa", async () => {
      const bookingId = await createBooking({
        tenantId: orgNoRate,
        userId: clientA,
        productId: pNoRate,
        hotelKey: hotelNoRate,
        roomType: "standard",
      });
      // La base local puede tener una tasa global de otra suite: se fuerza la
      // ausencia en el servicio para probar la superficie 503 de la ruta. El
      // camino real sin filas está cubierto en rates.test.ts.
      const rates = app.get(ExchangeRateService);
      const spy = vi
        .spyOn(rates, "rateForPayment")
        .mockRejectedValueOnce(new ApiProblemException("RATE_UNAVAILABLE", "Sin tasa"));
      try {
        const res = await postPayment(cookieA, bookingId, keyFor(), pagoMovilBody());
        await expectProblem(res, 503, "RATE_UNAVAILABLE");
      } finally {
        spy.mockRestore();
      }
      await expect(countPayments(orgNoRate)).resolves.toBe(0);
      await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");
    });
  });

  describe("Modo de aprobación", () => {
    it("aprueba en modo MANUAL, confirma la reserva y audita el antes/después", async () => {
      const bookingId = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
      });
      const created = await postPayment(cookieB, bookingId, keyFor(), pagoMovilBody());
      expect(created.status).toBe(201);
      const payment = await jsonOf<PaymentBodyResponse>(created);
      expect(payment.status).toBe("IN_REVIEW");

      const res = await review(cookieOwnerB, payment.id, "approve");
      expect(res.status).toBe(200);
      const approved = await jsonOf<PaymentBodyResponse>(res);
      expect(approved).toMatchObject({
        status: "APPROVED",
        reviewedBy: ownerB,
        rejectionReason: null,
      });
      expect(approved.reviewedAt).toMatch(/Z$/);
      await expect(bookingStatus(bookingId)).resolves.toBe("CONFIRMED");

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: payment.id, action: "payment.approve" },
      });
      expect(audit.actorId).toBe(ownerB);
      expect(audit.tenantId).toBe(orgB);
      expect(audit.before).toMatchObject({ status: "IN_REVIEW", bookingStatus: "PENDING_PAYMENT" });
      expect(audit.after).toMatchObject({ status: "APPROVED", bookingStatus: "CONFIRMED" });
    });

    it("rechaza con motivo, deja la reserva pendiente y guarda el motivo", async () => {
      const bookingId = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
      });
      const created = await postPayment(cookieB, bookingId, keyFor(), pagoMovilBody());
      const payment = await jsonOf<PaymentBodyResponse>(created);

      const res = await review(cookieOwnerB, payment.id, "reject", {
        reason: "  Comprobante ilegible  ",
      });
      expect(res.status).toBe(200);
      const rejected = await jsonOf<PaymentBodyResponse>(res);
      expect(rejected).toMatchObject({
        status: "REJECTED",
        reviewedBy: ownerB,
        rejectionReason: "Comprobante ilegible",
      });
      await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: payment.id, action: "payment.reject" },
      });
      expect(audit.after).toMatchObject({ status: "REJECTED", rejectionReason: "Comprobante ilegible" });
    });

    it("rechaza sin motivo con 422 y mantiene el pago en revisión", async () => {
      const bookingId = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
      });
      const created = await postPayment(cookieB, bookingId, keyFor(), pagoMovilBody());
      const payment = await jsonOf<PaymentBodyResponse>(created);

      const res = await review(cookieOwnerB, payment.id, "reject", {});
      const problem = await expectProblem(res, 422, "VALIDATION_ERROR");
      expect(problem.errors?.map((issue) => issue.path)).toContain("reason");
      await expect(paymentStatus(payment.id)).resolves.toBe("IN_REVIEW");
    });

    it("responde 403 a agente, proveedor, cliente y Super Admin", async () => {
      const bookingId = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgB,
        bookingId,
        reportedBy: clientB,
        rateId: rateB,
        rate: "800.0000",
        status: "IN_REVIEW",
        reference: "5555",
      });

      for (const cookie of [cookieAgentA, cookieProviderA, cookieA, cookieSuper]) {
        const res = await review(cookie, paymentId, "approve");
        expect(res.status).toBe(403);
      }
      await expect(paymentStatus(paymentId)).resolves.toBe("IN_REVIEW");
      await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");
    });

    it("impide que el pagador revise su propio pago (agencia de una sola persona)", async () => {
      const bookingId = await createBooking({
        tenantId: orgB,
        userId: ownerB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgB,
        bookingId,
        reportedBy: ownerB,
        rateId: rateB,
        rate: "800.0000",
        status: "IN_REVIEW",
        reference: "6666",
      });

      const res = await review(cookieOwnerB, paymentId, "approve");
      await expectProblem(res, 403, "FORBIDDEN");
      // No hay otro revisor: el pago permanece en revisión.
      await expect(paymentStatus(paymentId)).resolves.toBe("IN_REVIEW");
      const stored = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(stored.reviewedBy).toBeNull();
    });

    it("resuelve dos revisiones concurrentes con una sola ganadora", async () => {
      const bookingId = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgB,
        bookingId,
        reportedBy: clientB,
        rateId: rateB,
        rate: "800.0000",
        status: "IN_REVIEW",
        reference: "7777",
      });

      // Se retrasa la escritura del pago ganador para que la segunda revisión
      // haga su lectura inicial mientras la primera sigue en vuelo: así el
      // perdedor observa IN_REVIEW y responde PAYMENT_ALREADY_REVIEWED (no
      // INVALID_STATE_TRANSITION, que es para un estado terminal de entrada).
      await createSlowPaymentUpdate(paymentId);
      try {
        const [first, second] = await Promise.all([
          review(cookieOwnerB, paymentId, "approve"),
          review(cookieAdminB, paymentId, "approve"),
        ]);

        expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409]);
        const failed = first.status === 409 ? first : second;
        await expectProblem(failed, 409, "PAYMENT_ALREADY_REVIEWED");
      } finally {
        await dropSlowPaymentUpdate();
      }
      await expect(paymentStatus(paymentId)).resolves.toBe("APPROVED");
      await expect(bookingStatus(bookingId)).resolves.toBe("CONFIRMED");
    });

    it("no aprueba sobre una reserva vencida y mantiene el pago en revisión", async () => {
      const bookingId = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
        status: "EXPIRED",
        expiresInMinutes: -5,
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgB,
        bookingId,
        reportedBy: clientB,
        rateId: rateB,
        rate: "800.0000",
        status: "IN_REVIEW",
        reference: "8888",
      });

      const res = await review(cookieOwnerB, paymentId, "approve");
      await expectProblem(res, 410, "HOLD_EXPIRED");
      await expect(paymentStatus(paymentId)).resolves.toBe("IN_REVIEW");
      await expect(bookingStatus(bookingId)).resolves.toBe("EXPIRED");
    });

    it("rechaza una transición no listada desde un estado terminal", async () => {
      const bookingId = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgB,
        bookingId,
        reportedBy: clientB,
        rateId: rateB,
        rate: "800.0000",
        status: "REJECTED",
        reference: "9999",
        reviewedBy: ownerB,
      });

      const res = await review(cookieOwnerB, paymentId, "approve");
      await expectProblem(res, 409, "INVALID_STATE_TRANSITION");
      await expect(paymentStatus(paymentId)).resolves.toBe("REJECTED");
    });

    it("un pago en revisión impide la expiración de su reserva", async () => {
      const bookingId = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
        expiresInMinutes: -5,
      });
      await createPaymentFixture({
        tenantId: orgB,
        bookingId,
        reportedBy: clientB,
        rateId: rateB,
        rate: "800.0000",
        status: "IN_REVIEW",
        reference: "1010",
      });

      const summary = await expiration.expireDueBookings(new Date(), [orgB]);
      expect(summary.expired).toBe(0);
      await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");
    });
  });

  describe("Datos por método de pago", () => {
    it("rechaza Pago Móvil sin banco, teléfono o referencia", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      for (const [missing, body] of [
        ["bank", { method: "PAGO_MOVIL", phone: "+584141234567", reference: "1234" }],
        ["phone", { method: "PAGO_MOVIL", bank: "Banesco", reference: "1234" }],
        ["reference", { method: "PAGO_MOVIL", bank: "Banesco", phone: "+584141234567" }],
      ] as const) {
        const res = await postPayment(cookieA, bookingId, keyFor(), body);
        const problem = await expectProblem(res, 422, "VALIDATION_ERROR");
        expect(problem.errors?.map((issue) => issue.path), missing).toContain(missing);
      }
      await expect(countPayments(orgA)).resolves.toBe(0);
    });

    it("rechaza un teléfono que no cumple el formato venezolano", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const res = await postPayment(
        cookieA,
        bookingId,
        keyFor(),
        pagoMovilBody({ phone: "0414123456" }),
      );
      const problem = await expectProblem(res, 422, "VALIDATION_ERROR");
      expect(problem.errors?.map((issue) => issue.path)).toContain("phone");
    });

    it("Zelle exige confirmación y nombre o correo del emisor", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const noConfirmation = await postPayment(cookieA, bookingId, keyFor(), {
        method: "ZELLE",
        senderName: "Ana",
      });
      const noSender = await postPayment(cookieA, bookingId, keyFor(), {
        method: "ZELLE",
        confirmationNumber: "Z-1",
      });
      expect(noConfirmation.status).toBe(422);
      expect(noSender.status).toBe(422);
    });

    it("Binance Pay exige identificador de orden", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const res = await postPayment(cookieA, bookingId, keyFor(), { method: "BINANCE_PAY" });
      const problem = await expectProblem(res, 422, "VALIDATION_ERROR");
      expect(problem.errors?.map((issue) => issue.path)).toContain("orderId");
    });

    it("con tarjeta guarda solo últimos 4 dígitos y marca", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const res = await postPayment(cookieA, bookingId, keyFor(), {
        method: "CARD",
        last4: "4242",
        brand: "VISA",
      });
      expect(res.status).toBe(201);
      const payment = await jsonOf<PaymentBodyResponse>(res);
      expect(payment).toMatchObject({ method: "CARD", reference: null, status: "APPROVED" });

      const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(stored.reference).toBeNull();
    });

    it("rechaza cardNumber, pan y cvv y no los registra en logs", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });

      const chunks: string[] = [];
      const spy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: string | Uint8Array): boolean => {
          chunks.push(String(chunk));
          return true;
        });
      try {
        for (const extra of [
          { cardNumber: "4242424242424242" },
          { pan: "4242424242424242" },
          { cvv: "987" },
        ]) {
          const res = await postPayment(cookieA, bookingId, keyFor(), {
            method: "CARD",
            last4: "4242",
            brand: "VISA",
            ...extra,
          });
          await expectProblem(res, 422, "VALIDATION_ERROR");
        }
      } finally {
        spy.mockRestore();
      }

      const output = chunks.join("");
      expect(output).not.toContain("4242424242424242");
      expect(output).not.toContain("987");
      await expect(countPayments(orgA)).resolves.toBe(0);
    });

    it("rechaza una referencia duplicada en la misma agencia", async () => {
      const first = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const second = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });

      const created = await postPayment(cookieA, first, keyFor(), pagoMovilBody());
      expect(created.status).toBe(201);

      const res = await postPayment(cookieA, second, keyFor(), pagoMovilBody());
      await expectProblem(res, 409, "DUPLICATE_PAYMENT_REFERENCE");
      await expect(countPayments(orgA)).resolves.toBe(1);
      await expect(bookingStatus(second)).resolves.toBe("PENDING_PAYMENT");
    });

    it("acepta la misma referencia en otra agencia", async () => {
      const bookingA = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const bookingB = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
      });

      const createdA = await postPayment(cookieA, bookingA, keyFor(), pagoMovilBody());
      expect(createdA.status).toBe(201);
      const createdB = await postPayment(cookieB, bookingB, keyFor(), pagoMovilBody());
      expect(createdB.status).toBe(201);
      await expect(countPayments(orgA)).resolves.toBe(1);
      await expect(countPayments(orgB)).resolves.toBe(1);
    });
  });

  describe("Consulta de pagos", () => {
    it("el dueño consulta los pagos de su reserva y otro cliente recibe 404", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const created = await postPayment(cookieA, bookingId, keyFor(), pagoMovilBody());
      const payment = await jsonOf<PaymentBodyResponse>(created);

      const own = await fetch(url(`/bookings/${bookingId}/payments`), {
        headers: { cookie: cookieA, origin: authOrigin },
      });
      expect(own.status).toBe(200);
      const body = await jsonOf<BookingPaymentsBody>(own);
      expect(body.items.map((item) => item.id)).toEqual([payment.id]);

      const other = await fetch(url(`/bookings/${bookingId}/payments`), {
        headers: { cookie: cookieB, origin: authOrigin },
      });
      await expectProblem(other, 404, "NOT_FOUND");
    });

    it("el panel lista solo la agencia activa, pagina y filtra", async () => {
      const bookingA1 = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const bookingA2 = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const bookingA3 = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      for (const [bookingId, reference] of [
        [bookingA1, "1111"],
        [bookingA2, "2222"],
        [bookingA3, "3333"],
      ] as const) {
        const res = await postPayment(cookieA, bookingId, keyFor(), pagoMovilBody({ reference }));
        expect(res.status).toBe(201);
      }

      const bookingB = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
      });
      await createPaymentFixture({
        tenantId: orgB,
        bookingId: bookingB,
        reportedBy: clientB,
        rateId: rateB,
        rate: "800.0000",
        status: "IN_REVIEW",
        reference: "4444",
      });

      const all = await listPayments(cookieOwnerA);
      expect(all.status).toBe(200);
      const page = await jsonOf<PaymentPageBody>(all);
      expect(page.items).toHaveLength(3);
      expect(page.items.every((item) => item.tenantId === orgA)).toBe(true);
      expect(page.nextCursor).toBeNull();

      const firstPage = await jsonOf<PaymentPageBody>(
        await listPayments(cookieOwnerA, "?limit=2"),
      );
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.nextCursor).toBeTruthy();
      const secondPage = await jsonOf<PaymentPageBody>(
        await listPayments(
          cookieOwnerA,
          `?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
        ),
      );
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();

      const inReview = await jsonOf<PaymentPageBody>(
        await listPayments(cookieOwnerA, "?status=IN_REVIEW"),
      );
      expect(inReview.items).toHaveLength(0);
      const approved = await jsonOf<PaymentPageBody>(
        await listPayments(cookieOwnerA, "?status=APPROVED&method=PAGO_MOVIL"),
      );
      expect(approved.items).toHaveLength(3);
    });

    it("el detalle respeta la agencia y el Super Admin ve todas", async () => {
      const bookingA = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const createdA = await postPayment(cookieA, bookingA, keyFor(), pagoMovilBody());
      const paymentA = await jsonOf<PaymentBodyResponse>(createdA);

      const bookingB = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
      });
      const paymentB = await createPaymentFixture({
        tenantId: orgB,
        bookingId: bookingB,
        reportedBy: clientB,
        rateId: rateB,
        rate: "800.0000",
        status: "IN_REVIEW",
        reference: "1212",
      });

      const own = await fetch(url(`/admin/payments/${paymentA.id}`), {
        headers: { cookie: cookieOwnerA, origin: authOrigin },
      });
      expect(own.status).toBe(200);

      const foreign = await fetch(url(`/admin/payments/${paymentB}`), {
        headers: { cookie: cookieOwnerA, origin: authOrigin },
      });
      await expectProblem(foreign, 404, "NOT_FOUND");

      const platform = await fetch(url(`/admin/payments/${paymentB}`), {
        headers: { cookie: cookieSuper, origin: authOrigin },
      });
      expect(platform.status).toBe(200);
      const detail = await jsonOf<PaymentBodyResponse>(platform);
      expect(detail).toMatchObject({ id: paymentB, tenantId: orgB, status: "IN_REVIEW" });
    });
  });

  describe("Auditoría y concurrencia", () => {
    it("si falla la auditoría no se confirma ni el pago ni la reserva", async () => {
      const bookingId = await createBooking({
        tenantId: orgFail,
        userId: clientA,
        productId: pFail,
        hotelKey: hotelFail,
        roomType: "standard",
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgFail,
        bookingId,
        reportedBy: clientA,
        rateId: rateFail,
        rate: "900.0000",
        status: "IN_REVIEW",
        reference: "1313",
      });

      const res = await review(cookieOwnerFail, paymentId, "approve");
      await expectProblem(res, 500, "INTERNAL_ERROR");
      await expect(paymentStatus(paymentId)).resolves.toBe("IN_REVIEW");
      await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");
      const audit = await prisma.auditLog.count({
        where: { entityId: paymentId, action: "payment.approve" },
      });
      expect(audit).toBe(0);
    });

    it("la carrera entre pago y expiración la gana una sola transacción", async () => {
      const bookingId = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pExpire,
        hotelKey: hotelExpire,
        roomType: "suite",
        expiresInMinutes: 1,
      });
      // La reserva retuvo la única noche: la expiración debe liberarla.
      await owner.query(
        `UPDATE "availability" SET "reserved" = 1
          WHERE "product_id" = $1 AND "night" = $2::date`,
        [pExpire, night1],
      );

      const [payRes] = await Promise.all([
        postPayment(cookieB, bookingId, keyFor(), pagoMovilBody({ reference: "1414" })),
        expiration.expireDueBookings(new Date(Date.now() + 5_000), [orgB]),
      ]);

      if (payRes.status === 201) {
        const payment = await jsonOf<PaymentBodyResponse>(payRes);
        expect(payment.status).toBe("IN_REVIEW");
        await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");
        await expect(countPayments(orgB)).resolves.toBe(1);
        await expect(reservedOf(pExpire)).resolves.toEqual([1, 0]);
      } else {
        await expectProblem(payRes, 410, "HOLD_EXPIRED");
        await expect(bookingStatus(bookingId)).resolves.toBe("EXPIRED");
        await expect(countPayments(orgB)).resolves.toBe(0);
        await expect(reservedOf(pExpire)).resolves.toEqual([0, 0]);
      }
    });
  });
});
