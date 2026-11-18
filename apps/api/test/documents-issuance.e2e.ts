import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { DocumentIssuanceService } from "../src/documents/document-issuance.service.js";
import { prisma } from "../src/prisma.js";
import { createAgency, createUser } from "./auth-helpers.js";

/**
 * Numeración e idempotencia (T-F1-11c, spec documents "Numeración
 * correlativa", "Reintento del mismo pago", "Un voucher por reserva",
 * "Un comprobante por pago" y "Número único por agencia y tipo").
 *
 * Dos emisiones simultáneas compiten por el contador de la agencia dentro de
 * su transacción: deben salir con números distintos y correlativos, sin
 * huecos. Reintentar la misma entidad devuelve la misma fila y no consume
 * número. La identidad del documento la protege un trigger de la BD.
 */
describe("emisión de documentos", () => {
  let app: ApiApplication;
  let issuance: DocumentIssuanceService;
  let db: Client;
  let tenantId: string;
  let bookingA: string;
  let bookingB: string;
  let paymentId: string;
  let rateId: string;

  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    app = await createApp();
    issuance = app.get(DocumentIssuanceService);
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    const userId = await createUser(`docs-issuance-${suffix}@example.com`);
    const agency = await createAgency(userId, `Docs ${suffix}`, `docs-${suffix}`);
    tenantId = agency.id;

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
            },
          ]),
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

    paymentId = randomUUID();
    await db.query(
      `INSERT INTO "payments"
         (id, tenant_id, booking_id, method, amount_usd, amount_ves, exchange_rate_id,
          rate, value_date, status, reported_by, created_at)
       VALUES ($1, $2, $3, 'PAGO_MOVIL', '100.00', '3600.00', $4,
          '36.0000', CURRENT_DATE, 'APPROVED', $5, now())`,
      [paymentId, tenantId, bookingA, rateId, userId],
    );
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM "organization" WHERE id = $1`, [tenantId]);
    await db?.end();
    await app?.close();
  });

  const counter = async (type: "VOUCHER" | "RECEIPT"): Promise<number> => {
    const result = await db.query<{ next_value: number }>(
      `SELECT next_value FROM document_counters WHERE tenant_id = $1 AND type = $2`,
      [tenantId, type],
    );
    return result.rows[0]?.next_value ?? 0;
  };

  it("asigna números distintos y correlativos a dos emisiones simultáneas", async () => {
    const [first, second] = await Promise.all([
      issuance.reserveForTenant(tenantId, {
        tenantId,
        bookingId: bookingA,
        type: "VOUCHER",
      }),
      issuance.reserveForTenant(tenantId, {
        tenantId,
        bookingId: bookingB,
        type: "VOUCHER",
      }),
    ]);

    expect([first.number, second.number].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(first.id).not.toBe(second.id);
    expect(first.status).toBe("PENDING");
    expect(first.language).toBe("ES");
    expect(await counter("VOUCHER")).toBe(3);
  });

  it("reintentar el mismo pago devuelve el mismo documento sin consumir número", async () => {
    const [a, b] = await Promise.all([
      issuance.reserveForTenant(tenantId, {
        tenantId,
        bookingId: bookingA,
        paymentId,
        type: "RECEIPT",
      }),
      issuance.reserveForTenant(tenantId, {
        tenantId,
        bookingId: bookingA,
        paymentId,
        type: "RECEIPT",
      }),
    ]);

    expect(b.id).toBe(a.id);
    expect(b.number).toBe(a.number);
    expect(await counter("RECEIPT")).toBe(2);
    const rows = await prisma.document.count({
      where: { tenantId, paymentId, type: "RECEIPT" },
    });
    expect(rows).toBe(1);
  });

  it("reintentar el mismo voucher no duplica la fila", async () => {
    const again = await issuance.reserveForTenant(tenantId, {
      tenantId,
      bookingId: bookingA,
      type: "VOUCHER",
    });
    const rows = await prisma.document.findMany({
      where: { tenantId, bookingId: bookingA, type: "VOUCHER" },
    });
    expect(rows).toHaveLength(1);
    expect(again.id).toBe(rows[0]?.id);
    expect(await counter("VOUCHER")).toBe(3);
  });

  it("la base rechaza cambiar la identidad o el número del documento", async () => {
    const [document] = await prisma.document.findMany({
      where: { tenantId, bookingId: bookingB, type: "VOUCHER" },
    });
    expect(document).toBeDefined();

    await expect(
      prisma.document.update({
        where: { id: document!.id },
        data: { number: 99 },
      }),
    ).rejects.toThrow(/inmutable/i);

    const unchanged = await prisma.document.findUniqueOrThrow({
      where: { id: document!.id },
    });
    expect(unchanged.number).toBe(document!.number);
  });
});
