import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { apiConfig } from "../src/config.js";
import { DocumentIssuanceService } from "../src/documents/document-issuance.service.js";
import { DocumentRenderingService } from "../src/documents/document-rendering.service.js";
import { INVOICE_PROVIDER, type InvoiceProvider } from "../src/documents/invoice-provider.js";
import { createAgency, createUser } from "./auth-helpers.js";

/**
 * Ciclo de vida de documentos (T-F1-11d, spec documents "Ciclo de vida del
 * documento", "Generación fallida", "Reintentos automáticos" y caso límite
 * "Un documento FAILED no bloquea una nueva reserva ni un nuevo pago").
 *
 * El renderizado se invoca directamente: en pruebas no hay Redis y el trabajo
 * BullMQ no arranca. Los errores se inyectan en el proveedor para comprobar
 * que la reserva y el pago quedan intactos.
 */

/** PDFKit escribe el texto como hexadecimal dentro de `TJ`. */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  return [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map((match) => Buffer.from(match[1] ?? "", "hex").toString("latin1"))
    .join("");
}

describe("ciclo de vida de documentos", () => {
  let app: ApiApplication;
  let issuance: DocumentIssuanceService;
  let rendering: DocumentRenderingService;
  let invoice: InvoiceProvider;
  let db: Client;
  let tenantId: string;
  let userId: string;
  let bookingA: string;
  let bookingB: string;
  let paymentA: string;
  let paymentB: string;
  let productId: string;
  let hotelKey: string;
  let rateId: string;
  const writtenFiles: string[] = [];

  const suffix = randomUUID().slice(0, 8);
  const title = { es: "Hotel Sol", en: "Sun Hotel" };
  const description = { es: "Descripción", en: "Description" };
  const night1 = "2026-12-10";
  const night2 = "2026-12-12";

  beforeAll(async () => {
    app = await createApp();
    issuance = app.get(DocumentIssuanceService);
    rendering = app.get(DocumentRenderingService);
    invoice = app.get(INVOICE_PROVIDER);
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    userId = await createUser(`docs-lifecycle-${suffix}@example.com`);
    const agency = await createAgency(userId, `Ciclo ${suffix}`, `ciclo-${suffix}`);
    tenantId = agency.id;

    await db.query(
      `INSERT INTO "tenant_settings"
         (tenant_id, legal_name, rif, address, phone, email, updated_at)
       VALUES ($1, 'Caribe Viajes C.A.', 'J-123456789', 'Av. Principal 1',
               '+58 212 1234567', 'contacto@example.com', now())`,
      [tenantId],
    );

    const providerId = randomUUID();
    const destinationId = randomUUID();
    await db.query(
      `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [providerId, tenantId, `Proveedor ${suffix}`],
    );
    await db.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now())`,
      [destinationId, tenantId, JSON.stringify({ es: "Mérida", en: "Merida" }), `mer-${suffix}`],
    );
    productId = randomUUID();
    hotelKey = randomUUID();
    await db.query(
      `INSERT INTO "products"
         (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
          destination_id, status, base_price_usd, cancellation_policy_id, source, attributes,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'HOTEL', $4, 'doble', $5::jsonb, $6::jsonb, $7,
               'PUBLISHED', '100.00', NULL, 'OWN', '{}'::jsonb, now(), now())`,
      [
        productId,
        tenantId,
        providerId,
        hotelKey,
        JSON.stringify(title),
        JSON.stringify(description),
        destinationId,
      ],
    );

    const makeBooking = async (): Promise<string> => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO "bookings"
           (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
         VALUES ($1, $2, $3, $4, 'CONFIRMED', '100.00', $5::jsonb,
                 now() + interval '30 minutes', now())`,
        [
          id,
          tenantId,
          generateBookingCode(),
          userId,
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
         VALUES ($1, $2, $3, $4, $5, 'doble', $6::date, $7::date, 1, $8::jsonb,
                 '100.00', $9::jsonb, $10::jsonb)`,
        [
          randomUUID(),
          id,
          tenantId,
          productId,
          hotelKey,
          night1,
          night2,
          JSON.stringify([{ night: night1, price_usd: "100.00" }]),
          JSON.stringify(title),
          JSON.stringify({
            policyId: null,
            name: "Flexible hasta 48 horas",
            rules: [{ hours_before: 48, percentage: 100 }],
          }),
        ],
      );
      return id;
    };
    bookingA = await makeBooking();
    bookingB = await makeBooking();

    rateId = randomUUID();
    await db.query(
      `INSERT INTO "exchange_rates"
         (id, tenant_id, source, rate, value_date, fetched_at, is_override)
       VALUES ($1, $2, 'cotizave', '36.0000', CURRENT_DATE, now(), false)`,
      [rateId, tenantId],
    );

    const makePayment = async (bookingId: string, reference: string | null): Promise<string> => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO "payments"
           (id, tenant_id, booking_id, method, amount_usd, amount_ves, exchange_rate_id,
            rate, value_date, reference, status, reported_by, reviewed_at, paid_at, created_at)
         VALUES ($1, $2, $3, 'PAGO_MOVIL', '100.00', '3600.00', $4,
            '36.0000', CURRENT_DATE, $5, 'APPROVED', $6, now(), now(), now())`,
        [id, tenantId, bookingId, rateId, reference, userId],
      );
      return id;
    };
    paymentA = await makePayment(bookingA, "REF-998877");
    paymentB = await makePayment(bookingB, null);
  });

  afterEach(() => {
    // Si una aserción falla, el spy no se restauraría y el siguiente test
    // capturaría el spy como "implementación real" (recursión infinita).
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await Promise.all(writtenFiles.map((path) => unlink(path).catch(() => undefined)));
    await db?.query(`DELETE FROM "organization" WHERE id = $1`, [tenantId]);
    await db?.end();
    await app?.close();
  });

  const reserve = async (type: "VOUCHER" | "RECEIPT", bookingId: string, paymentId?: string) => {
    const document = await issuance.reserveForTenant(tenantId, {
      tenantId,
      bookingId,
      paymentId,
      type,
    });
    writtenFiles.push(
      join(
        apiConfig.documentsDir,
        type === "VOUCHER" ? "vouchers" : "receipts",
        `${document.id}.pdf`,
      ),
    );
    return document;
  };

  const stored = async (documentId: string) => {
    const result = await db.query<{
      status: string;
      file_url: string | null;
      error: string | null;
      issued_at: Date | null;
    }>(`SELECT status, file_url, error, issued_at FROM documents WHERE id = $1`, [documentId]);
    return result.rows[0];
  };

  it("renderiza un PENDING en READY con archivo UUID y no cambia la reserva", async () => {
    const document = await reserve("VOUCHER", bookingA);
    const result = await rendering.render(document.id, tenantId);

    expect(result.status).toBe("READY");
    expect(result.fileUrl).toMatch(/^vouchers\/[0-9a-f-]{36}\.pdf$/);
    expect(result.fileUrl).toContain(document.id);
    const row = await stored(document.id);
    expect(row).toMatchObject({ status: "READY", file_url: result.fileUrl, error: null });
    expect(row?.issued_at).toBeInstanceOf(Date);

    assert.ok(result.fileUrl, "Un documento READY debe tener archivo");
    const pdf = await readFile(join(apiConfig.documentsDir, result.fileUrl));
    const text = pdfText(pdf);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(text).toContain("Documento no fiscal");
    expect(text).toContain("Flexible hasta 48 horas");
    expect(text).toContain("Caribe Viajes C.A.");
    expect(text).toContain("J-123456789");

    const booking = await db.query<{ status: string }>(
      `SELECT status FROM bookings WHERE id = $1`,
      [bookingA],
    );
    expect(booking.rows[0]?.status).toBe("CONFIRMED");
  });

  it("un segundo render no reemplaza el PDF ni consume otro número", async () => {
    const document = await reserve("VOUCHER", bookingA);
    const first = await rendering.render(document.id, tenantId);
    const spy = vi.spyOn(invoice, "issue");

    const second = await rendering.render(document.id, tenantId);

    expect(second.fileUrl).toBe(first.fileUrl);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("renderiza el comprobante con la tasa y el total VES congelados del pago", async () => {
    const document = await reserve("RECEIPT", bookingA, paymentA);
    const result = await rendering.render(document.id, tenantId);

    expect(result.fileUrl).toMatch(/^receipts\/[0-9a-f-]{36}\.pdf$/);
    assert.ok(result.fileUrl, "Un comprobante READY debe tener archivo");
    const text = pdfText(await readFile(join(apiConfig.documentsDir, result.fileUrl)));
    expect(text).toContain("36.0000");
    expect(text).toContain("3600.00");
    expect(text).toContain("REF-998877");
  });

  it("tras 3 fallos marca FAILED, guarda el error y no bloquea pago ni reserva", async () => {
    const document = await reserve("RECEIPT", bookingB, paymentB);
    const spy = vi.spyOn(invoice, "issue").mockRejectedValue(new Error("fallo temporal de PDF"));
    const sleeps: number[] = [];

    const result = await rendering.renderWithRetries(document.id, tenantId, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result).toMatchObject({ status: "FAILED", attempts: 3 });
    expect(result.error).toContain("fallo temporal de PDF");
    expect(sleeps).toEqual([1000, 2000]);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(await stored(document.id)).toMatchObject({
      status: "FAILED",
      error: "fallo temporal de PDF",
    });

    const payment = await db.query<{ status: string }>(
      `SELECT status FROM payments WHERE id = $1`,
      [paymentB],
    );
    const booking = await db.query<{ status: string }>(
      `SELECT status FROM bookings WHERE id = $1`,
      [bookingB],
    );
    expect(payment.rows[0]?.status).toBe("APPROVED");
    expect(booking.rows[0]?.status).toBe("CONFIRMED");
    spy.mockRestore();
  });

  it("un fallo temporal se recupera en el tercer intento con espera creciente", async () => {
    const document = await reserve("VOUCHER", bookingB);
    const real = invoice.issue.bind(invoice);
    let calls = 0;
    const spy = vi.spyOn(invoice, "issue").mockImplementation(async (booking, payment) => {
      calls += 1;
      if (calls <= 2) throw new Error("proveedor ocupado");
      return real(booking, payment);
    });
    const sleeps: number[] = [];

    const result = await rendering.renderWithRetries(document.id, tenantId, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.status).toBe("READY");
    expect(result.attempts).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
    expect(result.fileUrl).toMatch(/^vouchers\/[0-9a-f-]{36}\.pdf$/);
    expect(await stored(document.id)).toMatchObject({ status: "READY", error: null });
    spy.mockRestore();
  });
});
