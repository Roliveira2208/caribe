import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { todayInCaracas } from "@caribe/shared";
import { Client } from "pg";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { apiConfig } from "../src/config.js";
import { INVOICE_PROVIDER, type InvoiceProvider } from "../src/documents/invoice-provider.js";
import { DocumentRenderingService } from "../src/documents/document-rendering.service.js";
import { JobsScheduler } from "../src/jobs/jobs.scheduler.js";
import { authOrigin, createAgency, createUser, setActiveOrg, signIn, userWithTotp } from "./auth-helpers.js";

/**
 * Integración de documentos con el pago (T-F1-11f, spec documents "Voucher",
 * "Comprobante de pago", "Ciclo de vida" y "Reintentos automáticos").
 *
 * Al aprobar un pago, manual o automáticamente, se reservan el voucher y el
 * comprobante DENTRO de la transacción que confirma la reserva; el render se
 * encola DESPUÉS de confirmar. Un fallo del PDF no revierte pago ni reserva.
 */
describe("integración de documentos con pagos", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let rendering: DocumentRenderingService;
  let invoice: InvoiceProvider;
  let scheduler: JobsScheduler;
  let db: Client;

  let manualTenant: string;
  let autoTenant: string;
  let clientCookie: string;
  let autoClientCookie: string;
  let adminCookie: string;
  let clientId: string;
  let autoClientId: string;
  let adminId: string;
  let manualProduct: string;
  let hotelKey: string;

  const suffix = randomUUID().slice(0, 8);
  const title = { es: "Hotel Sol", en: "Sun Hotel" };
  const night1 = "2026-12-10";
  const night2 = "2026-12-12";

  const url = (path: string) => `${baseUrl}/api/v1${path}`;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");
    rendering = app.get(DocumentRenderingService);
    invoice = app.get(INVOICE_PROVIDER);
    scheduler = app.get(JobsScheduler);
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    const admin = await userWithTotp(baseUrl, `docs-int-admin-${suffix}@example.com`);
    adminId = admin.userId;
    manualTenant = (await createAgency(adminId, `Manual ${suffix}`, `int-manual-${suffix}`)).id;
    await setActiveOrg(baseUrl, admin.cookie, manualTenant);
    adminCookie = admin.cookie;

    const autoAdmin = await createUser(`docs-int-owner-${suffix}@example.com`);
    autoTenant = (await createAgency(autoAdmin, `Auto ${suffix}`, `int-auto-${suffix}`)).id;

    const clientEmail = `docs-int-client-${suffix}@example.com`;
    clientId = await createUser(clientEmail);
    clientCookie = await signIn(baseUrl, clientEmail);
    const autoEmail = `docs-int-auto-client-${suffix}@example.com`;
    autoClientId = await createUser(autoEmail);
    autoClientCookie = await signIn(baseUrl, autoEmail);

    const today = todayInCaracas();
    for (const [tenantId, mode] of [
      [manualTenant, "MANUAL"],
      [autoTenant, "AUTO"],
    ] as const) {
      await db.query(
        `INSERT INTO "tenant_settings" (tenant_id, hold_minutes, payment_mode, updated_at)
         VALUES ($1, 30, $2, now())`,
        [tenantId, mode],
      );
      await db.query(
        `INSERT INTO "exchange_rates"
           (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
         VALUES ($1, $2, 'MANUAL', 36.0000, $3::date, now(), true, 'Prueba de documentos', $4)`,
        [randomUUID(), tenantId, today, adminId],
      );
    }

    const providerId = randomUUID();
    const destinationId = randomUUID();
    await db.query(
      `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [providerId, manualTenant, `Proveedor ${suffix}`],
    );
    await db.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now())`,
      [destinationId, manualTenant, JSON.stringify({ es: "Mérida", en: "Merida" }), `int-${suffix}`],
    );
    manualProduct = randomUUID();
    hotelKey = randomUUID();
    await db.query(
      `INSERT INTO "products"
         (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
          destination_id, status, base_price_usd, cancellation_policy_id, source, attributes,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'HOTEL', $4, 'doble', $5::jsonb, $6::jsonb, $7,
               'PUBLISHED', '100.00', NULL, 'OWN', '{}'::jsonb, now(), now())`,
      [
        manualProduct,
        manualTenant,
        providerId,
        hotelKey,
        JSON.stringify(title),
        JSON.stringify({ es: "Descripción", en: "Description" }),
        destinationId,
      ],
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const files = await db?.query<{ file_url: string | null }>(
      `SELECT file_url FROM documents WHERE file_url IS NOT NULL`,
    );
    for (const row of files?.rows ?? []) {
      if (row.file_url) {
        await import("node:fs/promises")
          .then(({ unlink }) => unlink(`${apiConfig.documentsDir}/${row.file_url}`))
          .catch(() => undefined);
      }
    }
    await db?.query(`DELETE FROM "organization" WHERE id IN ($1, $2)`, [manualTenant, autoTenant]);
    await db?.end();
    await app?.close();
  });

  /** Reserva PENDING_PAYMENT con línea para poder renderizar si hace falta. */
  const makeBooking = async (
    tenantId: string,
    userId: string,
    withItem = false,
  ): Promise<string> => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO "bookings"
         (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', '100.00', $5::jsonb,
               now() + interval '30 minutes', now())`,
      [
        id,
        tenantId,
        generateBookingCode(),
        userId,
        JSON.stringify([
          { fullName: "Ana Pérez", documentType: "V", documentNumber: "12345678" },
        ]),
      ],
    );
    if (withItem) {
      await db.query(
        `INSERT INTO "booking_items"
           (id, booking_id, tenant_id, product_id, hotel_key, room_type, check_in, check_out,
            quantity, nightly_prices, subtotal_usd, product_title, policy_snapshot)
         VALUES ($1, $2, $3, $4, $5, 'doble', $6::date, $7::date, 1, $8::jsonb,
                 '100.00', $9::jsonb, $10::jsonb)`,
        [
          randomUUID(),
          id,
          tenantId,
          manualProduct,
          hotelKey,
          night1,
          night2,
          JSON.stringify([{ night: night1, price_usd: "100.00" }]),
          JSON.stringify(title),
          JSON.stringify({ policyId: null, name: "Flexible", rules: [] }),
        ],
      );
    }
    return id;
  };

  const postPayment = async (cookie: string, bookingId: string, reference: string) =>
    fetch(url(`/bookings/${bookingId}/payments`), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: authOrigin,
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        method: "PAGO_MOVIL",
        bank: "Banesco",
        phone: "+584141234567",
        reference,
      }),
    });

  const documentsOf = async (bookingId: string) => {
    const result = await db.query<{
      id: string;
      type: string;
      status: string;
      number: number;
      payment_id: string | null;
      tenant_id: string;
    }>(
      `SELECT id, type, status, number, payment_id, tenant_id
         FROM documents WHERE booking_id = $1 ORDER BY type`,
      [bookingId],
    );
    return result.rows;
  };

  it("la aprobación manual reserva ambos documentos y encola tras el commit", async () => {
    const bookingId = await makeBooking(manualTenant, clientId, true);
    const payment = await postPayment(clientCookie, bookingId, `manual${suffix}`);
    expect(payment.status).toBe(201);
    const paymentId = ((await payment.json()) as { id: string }).id;

    const calls: Array<{ documentId: string; tenantId: string }> = [];
    const spy = vi.spyOn(scheduler, "enqueueDocumentRender").mockImplementation(async (payload) => {
      // Otra conexión solo ve las filas después de que la transacción confirmó.
      const committed = await documentsOf(bookingId);
      expect(committed).toHaveLength(2);
      calls.push(payload);
    });

    const approved = await fetch(url(`/admin/payments/${paymentId}/approve`), {
      method: "PATCH",
      headers: { cookie: adminCookie, origin: authOrigin },
    });
    expect(approved.status).toBe(200);

    const docs = await documentsOf(bookingId);
    expect(docs).toHaveLength(2);
    expect(docs.map((doc) => doc.type).sort()).toEqual(["RECEIPT", "VOUCHER"]);
    expect(docs.every((doc) => doc.status === "PENDING")).toBe(true);
    expect(docs.every((doc) => doc.tenant_id === manualTenant)).toBe(true);
    expect(docs.find((doc) => doc.type === "VOUCHER")?.payment_id).toBeNull();
    expect(docs.find((doc) => doc.type === "RECEIPT")?.payment_id).toBe(paymentId);
    expect(calls.map((call) => call.documentId).sort()).toEqual(docs.map((doc) => doc.id).sort());
    expect(calls.every((call) => call.tenantId === manualTenant)).toBe(true);

    const retry = await fetch(url(`/admin/payments/${paymentId}/approve`), {
      method: "PATCH",
      headers: { cookie: adminCookie, origin: authOrigin },
    });
    expect(retry.status).toBe(409);
    expect(await documentsOf(bookingId)).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("la aprobación automática reserva ambos documentos sin duplicar en el reintento", async () => {
    const bookingId = await makeBooking(autoTenant, autoClientId);
    const spy = vi
      .spyOn(scheduler, "enqueueDocumentRender")
      .mockImplementation(async () => undefined);

    const payment = await postPayment(autoClientCookie, bookingId, `auto${suffix}`);
    expect(payment.status).toBe(201);
    await expect(payment.json()).resolves.toMatchObject({ status: "APPROVED" });

    const docs = await documentsOf(bookingId);
    expect(docs).toHaveLength(2);
    expect(docs.every((doc) => doc.status === "PENDING")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);

    const booking = await db.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [
      bookingId,
    ]);
    expect(booking.rows[0]?.status).toBe("CONFIRMED");
  });

  it("un fallo al encolar no revierte la aprobación del pago", async () => {
    const bookingId = await makeBooking(manualTenant, clientId, true);
    const payment = await postPayment(clientCookie, bookingId, `queue${suffix}`);
    const paymentId = ((await payment.json()) as { id: string }).id;

    vi.spyOn(scheduler, "enqueueDocumentRender").mockRejectedValue(
      new Error("Redis caído"),
    );
    const approved = await fetch(url(`/admin/payments/${paymentId}/approve`), {
      method: "PATCH",
      headers: { cookie: adminCookie, origin: authOrigin },
    });
    expect(approved.status).toBe(200);

    const storedPayment = await db.query<{ status: string }>(
      `SELECT status FROM payments WHERE id = $1`,
      [paymentId],
    );
    const storedBooking = await db.query<{ status: string }>(
      `SELECT status FROM bookings WHERE id = $1`,
      [bookingId],
    );
    expect(storedPayment.rows[0]?.status).toBe("APPROVED");
    expect(storedBooking.rows[0]?.status).toBe("CONFIRMED");
    expect((await documentsOf(bookingId)).every((doc) => doc.status === "PENDING")).toBe(true);
  });

  it("un fallo del PDF deja el pago aprobado y la reserva confirmada", async () => {
    const bookingId = await makeBooking(manualTenant, clientId, true);
    const payment = await postPayment(clientCookie, bookingId, `fail${suffix}`);
    const paymentId = ((await payment.json()) as { id: string }).id;
    await fetch(url(`/admin/payments/${paymentId}/approve`), {
      method: "PATCH",
      headers: { cookie: adminCookie, origin: authOrigin },
    });

    vi.spyOn(invoice, "issue").mockRejectedValue(new Error("PDF caído"));
    for (const doc of await documentsOf(bookingId)) {
      const result = await rendering.renderWithRetries(doc.id, doc.tenant_id, {
        sleep: async () => undefined,
      });
      expect(result.status).toBe("FAILED");
    }

    const storedPayment = await db.query<{ status: string }>(
      `SELECT status FROM payments WHERE id = $1`,
      [paymentId],
    );
    const storedBooking = await db.query<{ status: string }>(
      `SELECT status FROM bookings WHERE id = $1`,
      [bookingId],
    );
    expect(storedPayment.rows[0]?.status).toBe("APPROVED");
    expect(storedBooking.rows[0]?.status).toBe("CONFIRMED");
  });
});
