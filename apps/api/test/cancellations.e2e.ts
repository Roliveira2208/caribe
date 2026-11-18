import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { todayInCaracas } from "@caribe/shared";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { addDays } from "../src/catalog/catalog.schemas.js";
import { prisma } from "../src/prisma.js";
import {
  authOrigin,
  addMember,
  createUser,
  setActiveOrg,
  signIn,
  userWithTotp,
} from "./auth-helpers.js";

/**
 * E2E de cancelación y reembolso (T-F1-10, delta de booking "Cancelación" y
 * delta de payments "Reembolso").
 *
 * Agencias, productos, tasas, reservas y pagos se montan por SQL directo (el
 * cliente de pruebas conecta como superusuario y no pasa por RLS); la
 * cancelación se ejercita por HTTP con sesiones reales. Cada caso parte de un
 * estado limpio: antes de cada prueba se borran reembolsos, pagos, reservas y
 * políticas de las agencias de la suite y se repone la disponibilidad.
 *
 * Los porcentajes se eligen con fechas relativas para que no dependan de la
 * hora de ejecución: D+10 siempre supera 72 h (100 %), D+2 cae entre 39 h y
 * 63 h (50 %) y el check-in de hoy queda a menos de 24 h (0 %).
 */
describe("cancellations (cancelación y reembolso)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let owner: Client;

  let clientA = "";
  let clientB = "";
  let cookieA = "";

  let ownerA = "";
  let adminA = "";
  let agentA = "";
  let providerA = "";
  let superAdmin = "";

  let cookieOwnerA = "";
  let cookieAdminA = "";
  let cookieAgentA = "";
  let cookieProviderA = "";
  let cookieSuper = "";

  const suffix = randomUUID().slice(0, 8);

  const orgA = randomUUID();
  const orgB = randomUUID();

  const providerRowA = randomUUID();
  const providerRowB = randomUUID();

  const destA = randomUUID();
  const destB = randomUUID();

  const pA = randomUUID();
  const pB = randomUUID();

  const hotelA = randomUUID();
  const hotelB = randomUUID();

  const rateA = randomUUID();

  const today = todayInCaracas();
  const tomorrow = addDays(today, 1);
  const day2 = addDays(today, 2);
  const day3 = addDays(today, 3);
  const night1 = addDays(today, 10);
  const night2 = addDays(today, 11);

  const title = { es: "Hotel Sol", en: "Sun Hotel" };
  const description = { es: "Habitación standard", en: "Standard room" };
  const attributes = JSON.stringify({
    stars: 4,
    maxGuests: 2,
    amenities: ["wifi", "pool"],
    images: [],
  });

  const flexibleRules = [
    { hours_before: 72, percentage: 100 },
    { hours_before: 24, percentage: 50 },
  ];

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    owner = new Client({ connectionString: process.env.DATABASE_URL });
    await owner.connect();

    clientA = await createUser(`cancellations-a-${suffix}@example.com`);
    clientB = await createUser(`cancellations-b-${suffix}@example.com`);
    cookieA = await signIn(baseUrl, `cancellations-a-${suffix}@example.com`);

    await owner.query(
      `INSERT INTO "organization" (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, now()), ($4, $5, $6, now())`,
      [
        orgA,
        `Cancelaciones A ${suffix}`,
        `cancelaciones-a-${suffix}`,
        orgB,
        `Cancelaciones B ${suffix}`,
        `cancelaciones-b-${suffix}`,
      ],
    );

    const ownerAUser = await userWithTotp(baseUrl, `cancellations-owner-a-${suffix}@example.com`);
    ownerA = ownerAUser.userId;
    cookieOwnerA = ownerAUser.cookie;
    await addMember(orgA, ownerA, "owner");
    await setActiveOrg(baseUrl, cookieOwnerA, orgA);

    const adminAUser = await userWithTotp(baseUrl, `cancellations-admin-a-${suffix}@example.com`);
    adminA = adminAUser.userId;
    cookieAdminA = adminAUser.cookie;
    await addMember(orgA, adminA, "admin");
    await setActiveOrg(baseUrl, cookieAdminA, orgA);

    agentA = await createUser(`cancellations-agent-a-${suffix}@example.com`);
    cookieAgentA = await signIn(baseUrl, `cancellations-agent-a-${suffix}@example.com`);
    await addMember(orgA, agentA, "agent");
    await setActiveOrg(baseUrl, cookieAgentA, orgA);

    providerA = await createUser(`cancellations-provider-a-${suffix}@example.com`);
    cookieProviderA = await signIn(baseUrl, `cancellations-provider-a-${suffix}@example.com`);
    await addMember(orgA, providerA, "provider");
    await setActiveOrg(baseUrl, cookieProviderA, orgA);

    const superUser = await userWithTotp(baseUrl, `cancellations-super-${suffix}@example.com`);
    superAdmin = superUser.userId;
    cookieSuper = superUser.cookie;
    await owner.query(`UPDATE "user" SET role = 'super_admin' WHERE id = $1`, [superAdmin]);

    await owner.query(
      `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now()), ($4, $5, $6, now(), now())`,
      [
        providerRowA,
        orgA,
        `Proveedor A ${suffix}`,
        providerRowB,
        orgB,
        `Proveedor B ${suffix}`,
      ],
    );

    await owner.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now()),
              ($5, $6, $7::jsonb, 'VE', $8, now(), now())`,
      [
        destA,
        orgA,
        JSON.stringify({ es: "Mérida", en: "Merida" }),
        `mer-${suffix}`,
        destB,
        orgB,
        JSON.stringify({ es: "Margarita", en: "Margarita" }),
        `pmv-${suffix}`,
      ],
    );

    // Modo AUTO: la agencia no revisa pagos en estas pruebas.
    await owner.query(
      `INSERT INTO "tenant_settings" (tenant_id, hold_minutes, payment_mode, updated_at)
       VALUES ($1, 30, 'AUTO', now()), ($2, 30, 'AUTO', now())`,
      [orgA, orgB],
    );

    await owner.query(
      `INSERT INTO "exchange_rates"
         (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
       VALUES ($1, $2, 'MANUAL', 900.0000, $3::date, now(), true, 'Prueba de cancelación', $4)`,
      [rateA, orgA, today, ownerA],
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

    for (const night of [today, tomorrow, day2, day3, night1, night2]) {
      await availability(pA, orgA, night);
    }
    await availability(pB, orgB, night1);
    await availability(pB, orgB, night2);
  });

  beforeEach(async () => {
    const tenantIds = [orgA, orgB];
    await deleteRefunds(tenantIds);
    await owner.query(`DELETE FROM "documents" WHERE "tenant_id" = ANY($1::text[])`, [tenantIds]);
    await owner.query(`DELETE FROM "payments" WHERE "tenant_id" = ANY($1::text[])`, [tenantIds]);
    await owner.query(`DELETE FROM "bookings" WHERE "tenant_id" = ANY($1::text[])`, [tenantIds]);
    await owner.query(
      `UPDATE "products" SET "cancellation_policy_id" = NULL
        WHERE "tenant_id" = ANY($1::text[])`,
      [tenantIds],
    );
    await owner.query(`DELETE FROM "cancellation_policies" WHERE "tenant_id" = ANY($1::text[])`, [
      tenantIds,
    ]);
    await owner.query(
      `UPDATE "availability" SET "reserved" = 0 WHERE "product_id" = ANY($1::text[])`,
      [[pA, pB]],
    );
  });

  afterAll(async () => {
    if (owner) {
      const tenantIds = [orgA, orgB];
      await deleteRefunds(tenantIds);
      await owner.query(`DELETE FROM "documents" WHERE "tenant_id" = ANY($1::text[])`, [tenantIds]);
      await owner.query(`DELETE FROM "payments" WHERE "tenant_id" = ANY($1::text[])`, [tenantIds]);
      await owner.query(`DELETE FROM "bookings" WHERE "tenant_id" = ANY($1::text[])`, [tenantIds]);
      await owner.query(
        `DELETE FROM "cancellation_policies" WHERE "tenant_id" = ANY($1::text[])`,
        [tenantIds],
      );
      await owner.query(`DELETE FROM "exchange_rates" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "availability" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "products" WHERE "tenant_id" = ANY($1::text[])`, [tenantIds]);
      await owner.query(`DELETE FROM "tenant_settings" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "destinations" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "providers" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "organization" WHERE "id" = ANY($1::text[])`, [tenantIds]);
      await owner.end();
    }
    await app?.close();
    await prisma.$disconnect();
  });

  interface CancelBody {
    id: string;
    code: string;
    status: string;
    refund: null | {
      id: string;
      amountUsd: string;
      amountVes: string;
      rate: string;
      valueDate: string;
      paymentStatus: string;
    };
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

  async function availability(productId: string, tenantId: string, night: string): Promise<void> {
    await owner.query(
      `INSERT INTO "availability"
         (id, tenant_id, product_id, night, capacity, reserved, price_usd, created_at, updated_at)
       VALUES ($1, $2, $3, $4::date, 5, 0, '100.00', now(), now())`,
      [randomUUID(), tenantId, productId, night],
    );
  }

  /**
   * `refunds` es append-only para todos los roles (T-F1-1c), así que la
   * limpieza de fixtures desactiva el trigger un instante y lo restaura. La
   * prueba de "por encima del pago" corre con el trigger activo.
   */
  async function deleteRefunds(tenantIds: string[]): Promise<void> {
    await owner.query(`ALTER TABLE "refunds" DISABLE TRIGGER "refunds_append_only"`);
    try {
      await owner.query(`DELETE FROM "refunds" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
    } finally {
      await owner.query(`ALTER TABLE "refunds" ENABLE TRIGGER "refunds_append_only"`);
    }
  }

  /** Retiene una noche por unidad, como haría el alta real de la reserva. */
  async function holdNights(
    productId: string,
    checkIn: string,
    checkOut: string,
    quantity = 1,
  ): Promise<void> {
    await owner.query(
      `UPDATE "availability"
          SET "reserved" = "reserved" + $1
        WHERE "product_id" = $2
          AND "night" >= $3::date
          AND "night" < $4::date`,
      [quantity, productId, checkIn, checkOut],
    );
  }

  async function createBooking(params: {
    tenantId: string;
    userId: string;
    productId: string;
    hotelKey: string;
    roomType: string;
    checkIn?: string;
    checkOut?: string;
    status?: "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "EXPIRED";
    totalUsd?: string;
    expiresInMinutes?: number;
    rules?: Array<{ hours_before: number; percentage: number }>;
    hold?: boolean;
  }): Promise<string> {
    const id = randomUUID();
    const total = params.totalUsd ?? "100.00";
    const checkIn = params.checkIn ?? night1;
    const checkOut = params.checkOut ?? night2;
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
        checkIn,
        checkOut,
        JSON.stringify([{ night: checkIn, price_usd: total }]),
        total,
        JSON.stringify(title),
        JSON.stringify({
          policyId: null,
          name: params.rules ? "Flexible" : null,
          rules: params.rules ?? [],
        }),
      ],
    );
    if (params.hold !== false) {
      await holdNights(params.productId, checkIn, checkOut);
    }
    return id;
  }

  async function createPaymentFixture(params: {
    tenantId: string;
    bookingId: string;
    reportedBy: string;
    rate?: string;
    totalUsd?: string;
    status: "IN_REVIEW" | "REJECTED" | "APPROVED" | "PARTIALLY_REFUNDED" | "REFUNDED";
    reviewedBy?: string | null;
  }): Promise<string> {
    const id = randomUUID();
    const total = params.totalUsd ?? "100.00";
    const rate = params.rate ?? "900.0000";
    const amountVes = (Number(total) * Number(rate)).toFixed(2);
    const reviewed = params.status !== "IN_REVIEW" && params.status !== "REJECTED";
    await owner.query(
      `INSERT INTO "payments"
         (id, tenant_id, booking_id, method, amount_usd, amount_ves, exchange_rate_id, rate,
          value_date, reference, status, reported_by, reviewed_by, reviewed_at,
          rejection_reason, paid_at, created_at)
       VALUES ($1, $2, $3, 'PAGO_MOVIL', $4, $5, $6, $7, $8::date, '1234', $9, $10, $11, $12,
               NULL, $13, now())`,
      [
        id,
        params.tenantId,
        params.bookingId,
        total,
        amountVes,
        rateA,
        rate,
        today,
        params.status,
        params.reportedBy,
        reviewed ? (params.reviewedBy ?? null) : null,
        reviewed ? new Date() : null,
        reviewed ? new Date() : null,
      ],
    );
    return id;
  }

  /** Reembolso directo para montar estados previos (append-only en la base). */
  async function insertRefund(params: {
    paymentId: string;
    bookingId: string;
    amountUsd: string;
    amountVes: string;
    reason?: string;
  }): Promise<string> {
    const id = randomUUID();
    await owner.query(
      `INSERT INTO "refunds"
         (id, tenant_id, payment_id, booking_id, amount_usd, amount_ves, exchange_rate_id, rate,
          value_date, reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '900.0000', $8::date, $9, $10, now())`,
      [
        id,
        orgA,
        params.paymentId,
        params.bookingId,
        params.amountUsd,
        params.amountVes,
        rateA,
        today,
        params.reason ?? "Reembolso previo",
        clientA,
      ],
    );
    return id;
  }

  function url(path: string): string {
    return `${baseUrl}/api/v1${path}`;
  }

  async function cancelBooking(cookie: string | null, bookingId: string): Promise<Response> {
    const headers: Record<string, string> = { origin: authOrigin };
    if (cookie) headers["cookie"] = cookie;
    return fetch(url(`/bookings/${bookingId}/cancel`), { method: "POST", headers });
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

  async function reservedAt(productId: string, night: string): Promise<number> {
    const result = await owner.query<{ reserved: number }>(
      `SELECT "reserved" FROM "availability"
        WHERE "product_id" = $1 AND "night" = $2::date`,
      [productId, night],
    );
    return result.rows[0]?.reserved ?? -1;
  }

  async function refundCount(paymentId: string): Promise<number> {
    return prisma.refund.count({ where: { paymentId } });
  }

  describe("Cancelación", () => {
    it("el cliente cancela una reserva confirmada, libera cupo y reembolsa", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        status: "CONFIRMED",
        rules: flexibleRules,
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgA,
        bookingId,
        reportedBy: clientA,
        status: "APPROVED",
        reviewedBy: adminA,
      });
      await expect(reservedAt(pA, night1)).resolves.toBe(1);

      const res = await cancelBooking(cookieA, bookingId);
      expect(res.status).toBe(200);
      const body = await jsonOf<CancelBody>(res);
      expect(body).toMatchObject({
        id: bookingId,
        status: "CANCELLED",
        refund: {
          amountUsd: "100.00",
          amountVes: "90000.00",
          rate: "900.0000",
          valueDate: today,
          paymentStatus: "REFUNDED",
        },
      });
      const refundId = body.refund?.id;
      if (!refundId) throw new Error("La cancelación no devolvió el reembolso");

      await expect(bookingStatus(bookingId)).resolves.toBe("CANCELLED");
      await expect(paymentStatus(paymentId)).resolves.toBe("REFUNDED");
      await expect(reservedAt(pA, night1)).resolves.toBe(0);
      await expect(reservedAt(pA, night2)).resolves.toBe(0);
      await expect(refundCount(paymentId)).resolves.toBe(1);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: bookingId, action: "booking.cancel" },
      });
      expect(audit.actorId).toBe(clientA);
      expect(audit.tenantId).toBe(orgA);
      const refundAudit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: refundId, action: "booking.refund" },
      });
      expect(refundAudit.after).toMatchObject({ amountUsd: "100.00", bookingId });
    });

    it("aplica la política flexible con 100 % sobre el pago original", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        status: "CONFIRMED",
        rules: flexibleRules,
      });
      await createPaymentFixture({
        tenantId: orgA,
        bookingId,
        reportedBy: clientA,
        status: "APPROVED",
        reviewedBy: adminA,
      });

      const res = await cancelBooking(cookieA, bookingId);
      expect(res.status).toBe(200);
      const body = await jsonOf<CancelBody>(res);
      expect(body.refund).toMatchObject({
        amountUsd: "100.00",
        amountVes: "90000.00",
        rate: "900.0000",
        paymentStatus: "REFUNDED",
      });
    });

    it("aplica la política congelada aunque la agencia cambie la del producto", async () => {
      const policyId = randomUUID();
      await owner.query(
        `INSERT INTO "cancellation_policies" (id, tenant_id, name, rules, created_at, updated_at)
         VALUES ($1, $2, 'Flexible', $3::jsonb, now(), now())`,
        [policyId, orgA, JSON.stringify(flexibleRules)],
      );
      await owner.query(`UPDATE "products" SET "cancellation_policy_id" = $1 WHERE "id" = $2`, [
        policyId,
        pA,
      ]);

      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        checkIn: day2,
        checkOut: day3,
        status: "CONFIRMED",
        rules: flexibleRules,
      });
      await createPaymentFixture({
        tenantId: orgA,
        bookingId,
        reportedBy: clientA,
        status: "APPROVED",
        reviewedBy: adminA,
      });

      // La agencia cambia la política vigente a 0 %: la reserva conserva la
      // suya y debe reembolsar el 50 % (D+2 está entre 39 h y 63 h).
      await owner.query(
        `UPDATE "cancellation_policies" SET "rules" = $1::jsonb WHERE "id" = $2`,
        [JSON.stringify([{ hours_before: 24, percentage: 0 }]), policyId],
      );

      const res = await cancelBooking(cookieA, bookingId);
      expect(res.status).toBe(200);
      const body = await jsonOf<CancelBody>(res);
      expect(body.refund).toMatchObject({
        amountUsd: "50.00",
        amountVes: "45000.00",
        paymentStatus: "PARTIALLY_REFUNDED",
      });
    });

    it("reembolsa parcialmente y deja el pago PARTIALLY_REFUNDED", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        checkIn: day2,
        checkOut: day3,
        status: "CONFIRMED",
        rules: flexibleRules,
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgA,
        bookingId,
        reportedBy: clientA,
        status: "APPROVED",
        reviewedBy: adminA,
      });

      const res = await cancelBooking(cookieA, bookingId);
      expect(res.status).toBe(200);
      const body = await jsonOf<CancelBody>(res);
      expect(body.refund).toMatchObject({
        amountUsd: "50.00",
        amountVes: "45000.00",
        rate: "900.0000",
        paymentStatus: "PARTIALLY_REFUNDED",
      });
      await expect(paymentStatus(paymentId)).resolves.toBe("PARTIALLY_REFUNDED");
      const refund = await prisma.refund.findFirstOrThrow({ where: { paymentId } });
      expect(refund.amountUsd.toString()).toBe("50");
      expect(refund.amountVes.toString()).toBe("45000");
    });

    it("usa la tasa congelada del pago aunque la tasa del día cambie", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        status: "CONFIRMED",
        rules: flexibleRules,
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgA,
        bookingId,
        reportedBy: clientA,
        status: "APPROVED",
        reviewedBy: adminA,
      });

      // Tasa distinta para otra fecha: no debe tocar el reembolso.
      await owner.query(
        `INSERT INTO "exchange_rates"
           (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
         VALUES ($1, $2, 'MANUAL', 950.0000, $3::date, now(), true, 'Tasa posterior', $4)`,
        [randomUUID(), orgA, tomorrow, ownerA],
      );

      const res = await cancelBooking(cookieA, bookingId);
      expect(res.status).toBe(200);
      const body = await jsonOf<CancelBody>(res);
      expect(body.refund).toMatchObject({
        amountUsd: "100.00",
        amountVes: "90000.00",
        rate: "900.0000",
      });
      const refund = await prisma.refund.findFirstOrThrow({ where: { paymentId } });
      expect(refund.exchangeRateId).toBe(rateA);
      expect(refund.valueDate.toISOString().slice(0, 10)).toBe(today);
    });

    it("cancela una reserva pendiente sin pago", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      await expect(reservedAt(pA, night1)).resolves.toBe(1);

      const res = await cancelBooking(cookieA, bookingId);
      expect(res.status).toBe(200);
      const body = await jsonOf<CancelBody>(res);
      expect(body).toMatchObject({ status: "CANCELLED", refund: null });
      await expect(bookingStatus(bookingId)).resolves.toBe("CANCELLED");
      await expect(reservedAt(pA, night1)).resolves.toBe(0);
      await expect(prisma.refund.count({ where: { bookingId } })).resolves.toBe(0);
    });

    it("rechaza cancelar con un pago en revisión", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      await createPaymentFixture({
        tenantId: orgA,
        bookingId,
        reportedBy: clientA,
        status: "IN_REVIEW",
      });

      const res = await cancelBooking(cookieA, bookingId);
      await expectProblem(res, 409, "PAYMENT_IN_REVIEW");
      await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");
      await expect(reservedAt(pA, night1)).resolves.toBe(1);
      await expect(prisma.refund.count({ where: { bookingId } })).resolves.toBe(0);
    });

    it("responde 404 al cancelar la reserva de otro cliente", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientB,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });

      const res = await cancelBooking(cookieA, bookingId);
      await expectProblem(res, 404, "NOT_FOUND");
      await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");
      await expect(reservedAt(pA, night1)).resolves.toBe(1);
    });

    it("el agente cancela solo las reservas propias", async () => {
      const ownBooking = await createBooking({
        tenantId: orgA,
        userId: agentA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });
      const otherBooking = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });

      const denied = await cancelBooking(cookieAgentA, otherBooking);
      await expectProblem(denied, 404, "NOT_FOUND");
      await expect(bookingStatus(otherBooking)).resolves.toBe("PENDING_PAYMENT");

      const allowed = await cancelBooking(cookieAgentA, ownBooking);
      expect(allowed.status).toBe(200);
      const body = await jsonOf<CancelBody>(allowed);
      expect(body.status).toBe("CANCELLED");
      await expect(bookingStatus(ownBooking)).resolves.toBe("CANCELLED");
    });

    it("el admin de la agencia cancela una reserva de su agencia", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientB,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        status: "CONFIRMED",
        rules: flexibleRules,
      });
      await createPaymentFixture({
        tenantId: orgA,
        bookingId,
        reportedBy: clientB,
        status: "APPROVED",
        reviewedBy: adminA,
      });

      const res = await cancelBooking(cookieAdminA, bookingId);
      expect(res.status).toBe(200);
      const body = await jsonOf<CancelBody>(res);
      expect(body).toMatchObject({ status: "CANCELLED", refund: { paymentStatus: "REFUNDED" } });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: bookingId, action: "booking.cancel" },
      });
      expect(audit.actorId).toBe(adminA);
    });

    it("el owner de la agencia cancela una reserva de su agencia", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });

      const res = await cancelBooking(cookieOwnerA, bookingId);
      expect(res.status).toBe(200);
      const body = await jsonOf<CancelBody>(res);
      expect(body.status).toBe("CANCELLED");
    });

    it("el proveedor no puede cancelar", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });

      const res = await cancelBooking(cookieProviderA, bookingId);
      await expectProblem(res, 403, "FORBIDDEN");
      await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");
      await expect(reservedAt(pA, night1)).resolves.toBe(1);
    });

    it("el Super Admin no puede cancelar", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
      });

      const res = await cancelBooking(cookieSuper, bookingId);
      await expectProblem(res, 403, "FORBIDDEN");
      await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");
      await expect(reservedAt(pA, night1)).resolves.toBe(1);
    });

    it("rechaza una reserva ajena de otra agencia", async () => {
      const bookingId = await createBooking({
        tenantId: orgB,
        userId: clientB,
        productId: pB,
        hotelKey: hotelB,
        roomType: "standard",
      });

      const res = await cancelBooking(cookieA, bookingId);
      await expectProblem(res, 404, "NOT_FOUND");
      await expect(bookingStatus(bookingId)).resolves.toBe("PENDING_PAYMENT");
    });

    it("repetir la cancelación es idempotente y no duplica el reembolso", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        status: "CONFIRMED",
        rules: flexibleRules,
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgA,
        bookingId,
        reportedBy: clientA,
        status: "APPROVED",
        reviewedBy: adminA,
      });

      const first = await cancelBooking(cookieA, bookingId);
      expect(first.status).toBe(200);
      const firstBody = await jsonOf<CancelBody>(first);

      const second = await cancelBooking(cookieA, bookingId);
      expect(second.status).toBe(200);
      const secondBody = await jsonOf<CancelBody>(second);
      expect(secondBody).toMatchObject({ status: "CANCELLED" });
      expect(secondBody.refund).toEqual(firstBody.refund);
      await expect(refundCount(paymentId)).resolves.toBe(1);
      await expect(reservedAt(pA, night1)).resolves.toBe(0);
      await expect(paymentStatus(paymentId)).resolves.toBe("REFUNDED");
    });

    it("cancelar una reserva vencida no libera cupo ni reembolsa", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        status: "EXPIRED",
        expiresInMinutes: -5,
        hold: false,
      });

      const res = await cancelBooking(cookieA, bookingId);
      expect(res.status).toBe(200);
      const body = await jsonOf<CancelBody>(res);
      expect(body).toMatchObject({ status: "EXPIRED", refund: null });
      await expect(bookingStatus(bookingId)).resolves.toBe("EXPIRED");
      await expect(reservedAt(pA, night1)).resolves.toBe(0);
      await expect(prisma.refund.count({ where: { bookingId } })).resolves.toBe(0);
    });

    it("un reembolso del 0 % no crea fila y deja el pago APPROVED", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        checkIn: today,
        checkOut: tomorrow,
        status: "CONFIRMED",
        rules: flexibleRules,
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgA,
        bookingId,
        reportedBy: clientA,
        status: "APPROVED",
        reviewedBy: adminA,
      });

      const res = await cancelBooking(cookieA, bookingId);
      expect(res.status).toBe(200);
      const body = await jsonOf<CancelBody>(res);
      expect(body).toMatchObject({ status: "CANCELLED", refund: null });
      await expect(paymentStatus(paymentId)).resolves.toBe("APPROVED");
      await expect(refundCount(paymentId)).resolves.toBe(0);
      await expect(reservedAt(pA, today)).resolves.toBe(0);
    });
  });

  describe("Reembolso", () => {
    it("responde 409 si el pago ya tiene un reembolso y la reserva no está cancelada", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        status: "CONFIRMED",
        rules: flexibleRules,
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgA,
        bookingId,
        reportedBy: clientA,
        status: "PARTIALLY_REFUNDED",
        reviewedBy: adminA,
      });
      await insertRefund({
        paymentId,
        bookingId,
        amountUsd: "50.00",
        amountVes: "45000.00",
      });

      const res = await cancelBooking(cookieA, bookingId);
      await expectProblem(res, 409, "REFUND_ALREADY_ISSUED");
      await expect(bookingStatus(bookingId)).resolves.toBe("CONFIRMED");
      await expect(reservedAt(pA, night1)).resolves.toBe(1);
      await expect(refundCount(paymentId)).resolves.toBe(1);
    });

    it("la base rechaza un reembolso por encima del monto del pago", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        status: "CONFIRMED",
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgA,
        bookingId,
        reportedBy: clientA,
        status: "APPROVED",
        reviewedBy: adminA,
      });

      await expect(
        insertRefund({
          paymentId,
          bookingId,
          amountUsd: "150.00",
          amountVes: "135000.00",
          reason: "Exceso",
        }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(refundCount(paymentId)).resolves.toBe(0);
    });

    it("la base exige la tasa congelada del pago en el reembolso", async () => {
      const bookingId = await createBooking({
        tenantId: orgA,
        userId: clientA,
        productId: pA,
        hotelKey: hotelA,
        roomType: "standard",
        status: "CONFIRMED",
      });
      const paymentId = await createPaymentFixture({
        tenantId: orgA,
        bookingId,
        reportedBy: clientA,
        status: "APPROVED",
        reviewedBy: adminA,
      });

      await expect(
        owner.query(
          `INSERT INTO "refunds"
             (id, tenant_id, payment_id, booking_id, amount_usd, amount_ves, exchange_rate_id,
              rate, value_date, reason, created_by, created_at)
           VALUES ($1, $2, $3, $4, '10.00', '9500.00', $5, '950.0000', $6::date, 'Tasa ajena', $7, now())`,
          [randomUUID(), orgA, paymentId, bookingId, rateA, today, clientA],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(refundCount(paymentId)).resolves.toBe(0);
    });
  });
});
