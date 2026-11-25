import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { todayInCaracas, type PaymentProvider, type RefundIntent } from "@caribe/shared";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { AuditService } from "../src/audit/audit.service.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { BookingsService } from "../src/bookings/bookings.service.js";
import type { BookingActor } from "../src/bookings/bookings.guard.js";
import { addDays } from "../src/catalog/catalog.schemas.js";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider.token.js";
import { RefundReconciliationService } from "../src/payments/refund-reconciliation.service.js";
import { TenantService } from "../src/tenant/tenant.service.js";

/**
 * Reembolsos idempotentes y atomicidad del efecto externo (T-F2-5,
 * F-FINAL-003, specs/security "Idempotencia de reembolsos", "Efectos externos
 * y rollback" y "Reconciliación de reembolsos").
 *
 * Las reservas y los pagos se insertan por SQL directo; el reembolso se
 * ejercita llamando al mismo servicio que usa la ruta de cancelación. El
 * proveedor simulado se espió para comprobar cuándo se invoca y con qué
 * `refundId`, sin depender de una pasarela real.
 */
describe("seguridad de reembolsos (T-F2-5)", () => {
  let app: ApiApplication;
  let db: Client;
  let bookings: BookingsService;
  let tenants: TenantService;
  let reconciliation: RefundReconciliationService;
  let refundCalls: RefundIntent[];

  const suffix = randomUUID().slice(0, 8);
  const org = randomUUID();
  const buyer = randomUUID();
  const providerRow = randomUUID();
  const destination = randomUUID();
  const product = randomUUID();
  const hotelKey = randomUUID();
  const rate = randomUUID();

  const today = todayInCaracas();
  const checkIn = addDays(today, 10);
  const checkOut = addDays(today, 11);

  const actor: BookingActor = {
    tenantId: org,
    userId: buyer,
    membershipRole: "owner",
    canCancelAgency: true,
    isPlatform: false,
  };

  beforeAll(async () => {
    app = await createApp();
    bookings = app.get(BookingsService);
    tenants = app.get(TenantService);
    reconciliation = app.get(RefundReconciliationService);
    const provider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const originalRefund = provider.refund.bind(provider);
    vi.spyOn(provider, "refund").mockImplementation(async (intent) => {
      refundCalls.push(intent);
      return originalRefund(intent);
    });

    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    await db.query(
      `INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, $2, $3, now())`,
      [org, `Reembolsos ${suffix}`, `reembolsos-${suffix}`],
    );
    await db.query(
      `INSERT INTO "user" (id, name, email, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now())`,
      [buyer, `Cliente ${suffix}`, `reembolsos-${suffix}@example.com`],
    );
    await db.query(
      `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [providerRow, org, `Proveedor ${suffix}`],
    );
    await db.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now())`,
      [destination, org, JSON.stringify({ es: "Mérida", en: "Merida" }), `mer-${suffix}`],
    );
    await db.query(
      `INSERT INTO "products"
         (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
          destination_id, status, base_price_usd, source, attributes, created_at, updated_at)
       VALUES ($1, $2, $3, 'HOTEL', $4, 'standard', $5::jsonb, $6::jsonb, $7, 'PUBLISHED',
               100.00, 'OWN', '{}'::jsonb, now(), now())`,
      [
        product,
        org,
        providerRow,
        hotelKey,
        JSON.stringify({ es: "Hotel", en: "Hotel" }),
        JSON.stringify({ es: "Habitación", en: "Room" }),
        destination,
      ],
    );
    await db.query(
      `INSERT INTO "exchange_rates"
         (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
       VALUES ($1, $2, 'MANUAL', 900.0000, $3::date, now(), true, 'Prueba de reembolso', $4)`,
      [rate, org, today, buyer],
    );
  });

  beforeEach(async () => {
    refundCalls = [];
    vi.restoreAllMocks();
    const provider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const originalRefund = provider.refund.bind(provider);
    vi.spyOn(provider, "refund").mockImplementation(async (intent) => {
      refundCalls.push(intent);
      return originalRefund(intent);
    });
    await db.query(`DELETE FROM "refund_dispatches" WHERE "tenant_id" = $1`, [org]);
    await deleteRefunds();
    await db.query(`DELETE FROM "payments" WHERE "tenant_id" = $1`, [org]);
    await db.query(`DELETE FROM "bookings" WHERE "tenant_id" = $1`, [org]);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM "refund_dispatches" WHERE "tenant_id" = $1`, [org]);
    await deleteRefunds();
    await db.query(`DELETE FROM "payments" WHERE "tenant_id" = $1`, [org]);
    await db.query(`DELETE FROM "bookings" WHERE "tenant_id" = $1`, [org]);
    await db.query(`DELETE FROM "exchange_rates" WHERE "id" = $1`, [rate]);
    await db.query(`DELETE FROM "products" WHERE "id" = $1`, [product]);
    await db.query(`DELETE FROM "destinations" WHERE "id" = $1`, [destination]);
    await db.query(`DELETE FROM "providers" WHERE "id" = $1`, [providerRow]);
    await db.query(`DELETE FROM "user" WHERE "id" = $1`, [buyer]);
    await db.query(`DELETE FROM "organization" WHERE "id" = $1`, [org]);
    await db.end();
    await app.close();
  });

  /** `refunds` es append-only hasta para el superusuario: se aparta el trigger. */
  async function deleteRefunds(): Promise<void> {
    await db.query(`ALTER TABLE "refunds" DISABLE TRIGGER "refunds_append_only"`);
    try {
      await db.query(`DELETE FROM "refunds" WHERE "tenant_id" = $1`, [org]);
    } finally {
      await db.query(`ALTER TABLE "refunds" ENABLE TRIGGER "refunds_append_only"`);
    }
  }

  async function paidBooking(): Promise<{ bookingId: string; paymentId: string }> {
    const bookingId = randomUUID();
    const paymentId = randomUUID();
    await db.query(
      `INSERT INTO "bookings"
         (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at)
       VALUES ($1, $2, $3, $4, 'CONFIRMED', 100.00, $5::jsonb, now() + interval '1 day')`,
      [
        bookingId,
        org,
        generateBookingCode(),
        buyer,
        JSON.stringify([
          {
            fullName: "Ana Pérez",
            documentType: "V",
            documentNumber: "12345678",
            phone: "+584141234567",
            email: "ana@example.com",
          },
        ]),
      ],
    );
    await db.query(
      `INSERT INTO "booking_items"
         (id, booking_id, tenant_id, product_id, hotel_key, room_type, check_in, check_out,
          quantity, nightly_prices, subtotal_usd, product_title, policy_snapshot)
       VALUES ($1, $2, $3, $4, $9, 'standard', $5::date, $6::date, 1,
               '[]'::jsonb, 100.00, $7::jsonb, $8::jsonb)`,
      [
        randomUUID(),
        bookingId,
        org,
        product,
        checkIn,
        checkOut,
        JSON.stringify({ es: "Hotel", en: "Hotel" }),
        JSON.stringify({
          policyId: null,
          name: "Flexible",
          rules: [{ hours_before: 72, percentage: 100 }],
        }),
        hotelKey,
      ],
    );
    await db.query(
      `INSERT INTO "payments"
         (id, tenant_id, booking_id, method, amount_usd, amount_ves, exchange_rate_id, rate,
          value_date, reference, status, reported_by, paid_at)
       VALUES ($1, $2, $3, 'PAGO_MOVIL', 100.00, 90000.00, $4, 900.0000, $5::date, $6,
               'APPROVED', $7, now())`,
      [paymentId, org, bookingId, rate, today, `ref-${randomUUID()}`, buyer],
    );
    return { bookingId, paymentId };
  }

  it("Reembolso idempotente: repetir cancelación no emite un segundo reembolso", async () => {
    const { bookingId, paymentId } = await paidBooking();

    const first = await bookings.cancel({ actor, bookingId, ip: null });
    expect(first.refund).not.toBeNull();
    const refundId = first.refund?.id as string;
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0]).toMatchObject({ refundId, paymentId });

    const second = await bookings.cancel({ actor, bookingId, ip: null });
    expect(second.refund).toEqual(first.refund);
    expect(refundCalls).toHaveLength(1);

    const dispatches = await db.query(
      `SELECT "refund_id", "status", "provider_reference" FROM "refund_dispatches"`,
    );
    expect(dispatches.rows).toHaveLength(1);
    expect(dispatches.rows[0]).toMatchObject({ refund_id: refundId, status: "COMPLETED" });
    expect(dispatches.rows[0]?.provider_reference).toBeTruthy();

    await expect(
      app.get(PAYMENT_PROVIDER).refund({ ...refundCalls[0]!, refundId: randomUUID() }),
    ).rejects.toMatchObject({ code: "REFUND_ALREADY_ISSUED" });
  });

  it("Rollback sin reembolso externo: si revierte la transacción no se llama al proveedor", async () => {
    const { bookingId } = await paidBooking();
    vi.spyOn(AuditService.prototype, "record").mockRejectedValueOnce(new Error("fallo local"));

    await expect(bookings.cancel({ actor, bookingId, ip: null })).rejects.toThrow("fallo local");
    expect(refundCalls).toHaveLength(0);
    expect((await db.query(`SELECT "refund_id" FROM "refund_dispatches"`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT "id" FROM "refunds"`)).rows).toHaveLength(0);
  });

  it("Rollback sin reembolso externo: un fallo al registrar el resultado deja la fila pendiente", async () => {
    const { bookingId } = await paidBooking();
    const realWithTenant = tenants.withTenant.bind(tenants);
    vi.spyOn(tenants, "withTenant")
      .mockImplementationOnce(realWithTenant)
      .mockRejectedValueOnce(new Error("fallo al registrar"));

    const result = await bookings.cancel({ actor, bookingId, ip: null });
    expect(result.refund).not.toBeNull();
    expect(refundCalls).toHaveLength(1);

    const dispatch = await db.query(
      `SELECT "status", "provider_reference" FROM "refund_dispatches"`,
    );
    expect(dispatch.rows).toHaveLength(1);
    expect(dispatch.rows[0]).toMatchObject({ status: "PENDING", provider_reference: null });
  });

  it("Reconciliación de reembolsos: cierra los aplicados, deja los pendientes y audita", async () => {
    const applied = await paidBooking();
    const pending = await paidBooking();
    const first = await bookings.cancel({ actor, bookingId: applied.bookingId, ip: null });
    const second = await bookings.cancel({ actor, bookingId: pending.bookingId, ip: null });
    const appliedId = first.refund?.id as string;
    const pendingId = second.refund?.id as string;

    await db.query(`UPDATE "refund_dispatches" SET "status" = 'PENDING', "provider_reference" = NULL`);
    const callsBefore = refundCalls.length;

    const provider = app.get(PAYMENT_PROVIDER);
    vi.spyOn(provider, "getRefund").mockImplementation(async (refundId) => ({
      refundId,
      providerReference: refundId === appliedId ? `sim-${refundId}` : null,
      status: refundId === appliedId ? "COMPLETED" : "PENDING",
    }));

    const summary = await reconciliation.reconcileRefunds({ organizationIds: [org] });
    expect(summary).toEqual({ organizations: 1, completed: 1, pending: 1, failed: 0 });

    const statuses = await db.query(
      `SELECT "refund_id", "status", "provider_reference" FROM "refund_dispatches"
        ORDER BY "refund_id"`,
    );
    const byId = new Map(statuses.rows.map((row) => [row.refund_id as string, row]));
    expect(byId.get(appliedId)).toMatchObject({ status: "COMPLETED" });
    expect(byId.get(pendingId)).toMatchObject({ status: "PENDING", provider_reference: null });

    expect(refundCalls).toHaveLength(callsBefore);
    const audit = await db.query(
      `SELECT "entity_id", "after" FROM "audit_logs"
        WHERE "action" = 'refund.reconciled' AND "tenant_id" = $1 AND "entity_id" = $2`,
      [org, appliedId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.entity_id).toBe(appliedId);
    expect(audit.rows[0]?.after).toMatchObject({ refundId: appliedId });
  });

  it("no expone secretos del proveedor en la respuesta de la cancelación", async () => {
    const { bookingId } = await paidBooking();
    const result = await bookings.cancel({ actor, bookingId, ip: null });
    expect(result.refund).not.toHaveProperty("providerReference");
    expect(result.refund).not.toHaveProperty("provider_reference");
    expect(result.refund).toMatchObject({ paymentStatus: "REFUNDED" });
  });
});
