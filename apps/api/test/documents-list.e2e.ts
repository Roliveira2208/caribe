import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import {
  authOrigin,
  createAgency,
  createUser,
  setActiveOrg,
  signIn,
  userWithTotp,
} from "./auth-helpers.js";

/** Listado autenticado de documentos: descubrir sin exponer rutas de disco. */
describe("listado de documentos de una reserva", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let db: Client;
  let tenantA: string;
  let tenantB: string;
  let clientCookie: string;
  let otherClientCookie: string;
  let adminACookie: string;
  let ownBookingId: string;
  let foreignBookingId: string;
  let readyDocId: string;
  let pendingDocId: string;

  const suffix = randomUUID().slice(0, 8);

  const get = async (path: string, cookie?: string): Promise<Response> =>
    fetch(`${baseUrl}/api/v1${path}`, {
      headers: cookie ? { cookie, origin: authOrigin } : { origin: authOrigin },
    });

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    const adminA = await userWithTotp(baseUrl, `docs-list-admin-a-${suffix}@example.com`);
    tenantA = (await createAgency(adminA.userId, `Agencia A ${suffix}`, `list-a-${suffix}`)).id;
    await setActiveOrg(baseUrl, adminA.cookie, tenantA);
    adminACookie = adminA.cookie;

    const adminB = await userWithTotp(baseUrl, `docs-list-admin-b-${suffix}@example.com`);
    tenantB = (await createAgency(adminB.userId, `Agencia B ${suffix}`, `list-b-${suffix}`)).id;

    const clientEmail = `docs-list-client-${suffix}@example.com`;
    const clientId = await createUser(clientEmail);
    clientCookie = await signIn(baseUrl, clientEmail);
    const otherEmail = `docs-list-other-${suffix}@example.com`;
    await createUser(otherEmail);
    otherClientCookie = await signIn(baseUrl, otherEmail);

    const makeBooking = async (tenantId: string, userId: string): Promise<string> => {
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
      return id;
    };

    ownBookingId = await makeBooking(tenantA, clientId);
    foreignBookingId = await makeBooking(tenantB, adminB.userId);

    const makeDocument = async (
      tenantId: string,
      bookingId: string,
      type: "VOUCHER" | "RECEIPT",
      number: number,
      status: "PENDING" | "READY" | "FAILED",
      paymentId: string | null = null,
    ): Promise<string> => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO "documents"
           (id, tenant_id, booking_id, payment_id, type, number, status, issued_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::"DocumentStatus", $8, now())`,
        [
          id,
          tenantId,
          bookingId,
          paymentId,
          type,
          number,
          status,
          status === "READY" ? new Date().toISOString() : null,
        ],
      );
      return id;
    };

    // Un RECEIPT exige un pago asociado: el constraint de entidad lo valida.
    const rateId = randomUUID();
    await db.query(
      `INSERT INTO "exchange_rates"
         (id, tenant_id, source, rate, value_date, fetched_at, is_override)
       VALUES ($1, $2, 'cotizave', '36.0000', CURRENT_DATE, now(), false)`,
      [rateId, tenantA],
    );
    const paymentId = randomUUID();
    await db.query(
      `INSERT INTO "payments"
         (id, tenant_id, booking_id, method, amount_usd, amount_ves, exchange_rate_id,
          rate, value_date, status, reported_by, created_at)
       VALUES ($1, $2, $3, 'PAGO_MOVIL', '100.00', '3600.00', $4,
          '36.0000', CURRENT_DATE, 'APPROVED', $5, now())`,
      [paymentId, tenantA, ownBookingId, rateId, clientId],
    );

    readyDocId = await makeDocument(tenantA, ownBookingId, "VOUCHER", 1, "READY");
    pendingDocId = await makeDocument(tenantA, ownBookingId, "RECEIPT", 1, "PENDING", paymentId);
    await makeDocument(tenantB, foreignBookingId, "VOUCHER", 1, "READY");
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM "organization" WHERE id IN ($1, $2)`, [tenantA, tenantB]);
    await db?.end();
    await app?.close();
  });

  it("el dueño ve tipo, número y estado, pero solo el PDF listo tiene ruta de descarga", async () => {
    const response = await get(`/bookings/${ownBookingId}/documents`, clientCookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<Record<string, unknown>>;
    };
    expect(body.items).toHaveLength(2);
    expect(body.items.map((item) => item.status)).toEqual(["READY", "PENDING"]);
    expect(body.items[0]).toMatchObject({
      id: readyDocId,
      type: "VOUCHER",
      number: 1,
      status: "READY",
      downloadPath: `/api/v1/documents/${readyDocId}/download`,
    });
    expect(body.items[1]?.downloadPath).toBeNull();
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual([
        "downloadPath",
        "id",
        "issuedAt",
        "number",
        "status",
        "type",
      ]);
      expect(JSON.stringify(item)).not.toContain("file_url");
      expect(JSON.stringify(item)).not.toContain("tenantId");
      expect(JSON.stringify(item)).not.toContain("Ana");
    }
  });

  it("un admin de la agencia ve los documentos de las reservas de su agencia", async () => {
    const response = await get(`/bookings/${ownBookingId}/documents`, adminACookie);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: readyDocId }, { id: pendingDocId }],
    });
  });

  it("un visitante anónimo recibe 401", async () => {
    const response = await get(`/bookings/${ownBookingId}/documents`);
    expect(response.status).toBe(401);
  });

  it("otro cliente no ve los documentos ajenos (404)", async () => {
    const response = await get(`/bookings/${ownBookingId}/documents`, otherClientCookie);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
  });

  it("un admin de la agencia A no ve documentos de la agencia B (404)", async () => {
    const response = await get(`/bookings/${foreignBookingId}/documents`, adminACookie);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
  });
});
