import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { apiConfig } from "../src/config.js";
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
 * F-FINAL-001 (specs/booking y specs/documents): el proveedor solo ve reservas
 * y documentos que contienen productos de su `provider_id`, aunque estén en su
 * misma agencia. El dueño de la reserva y el owner de la agencia conservan su
 * alcance completo.
 */
describe("alcance de proveedor sobre reservas y documentos", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let db: Client;
  let tenantA: string;
  let providerACookie: string;
  let providerBCookie: string;
  let providerNoRowCookie: string;
  let ownerCookie: string;
  let clientCookie: string;
  let bookingA: string;
  let bookingB: string;
  let bookingAB: string;
  let docA: string;
  let docB: string;
  const writtenFiles: string[] = [];

  const suffix = randomUUID().slice(0, 8);
  const travelers = JSON.stringify([
    {
      fullName: "Ana Pérez",
      documentType: "V",
      documentNumber: "12345678",
      phone: "+584141234567",
      email: "ana@example.com",
    },
  ]);

  const get = async (path: string, cookie?: string): Promise<Response> =>
    fetch(`${baseUrl}/api/v1${path}`, {
      headers: cookie ? { cookie, origin: authOrigin } : { origin: authOrigin },
    });

  const getJson = async <T>(path: string, cookie: string): Promise<{ status: number; body: T }> => {
    const response = await get(path, cookie);
    return { status: response.status, body: (await response.json()) as T };
  };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    const owner = await userWithTotp(baseUrl, `scope-owner-${suffix}@example.com`);
    tenantA = (await createAgency(owner.userId, `Agencia scope ${suffix}`, `scope-${suffix}`)).id;
    await setActiveOrg(baseUrl, owner.cookie, tenantA);
    ownerCookie = owner.cookie;

    const makeProvider = async (label: string, withRow: boolean): Promise<string> => {
      const email = `scope-${label}-${suffix}@example.com`;
      const userId = await createUser(email);
      await addMember(tenantA, userId, "provider");
      const cookie = await signIn(baseUrl, email);
      await setActiveOrg(baseUrl, cookie, tenantA);
      if (withRow) {
        await db.query(
          `INSERT INTO "providers" (id, tenant_id, user_id, name, created_at, updated_at)
           VALUES ($1, $2, $3, $4, now(), now())`,
          [randomUUID(), tenantA, userId, `Proveedor ${label} ${suffix}`],
        );
      }
      return cookie;
    };
    providerACookie = await makeProvider("a", true);
    providerBCookie = await makeProvider("b", true);
    providerNoRowCookie = await makeProvider("no-row", false);

    const clientEmail = `scope-client-${suffix}@example.com`;
    const clientId = await createUser(clientEmail);
    clientCookie = await signIn(baseUrl, clientEmail);

    const providerIds = await db.query<{ id: string }>(
      `SELECT id FROM "providers" WHERE tenant_id = $1 ORDER BY name`,
      [tenantA],
    );
    const providerAId = providerIds.rows.find((row) => row.id)?.id;
    const providerBId = providerIds.rows[1]?.id;
    if (!providerAId || !providerBId) throw new Error("faltan los proveedores de prueba");

    const destinationId = randomUUID();
    await db.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now())`,
      [
        destinationId,
        tenantA,
        JSON.stringify({ es: "Mérida", en: "Merida" }),
        `scope-${suffix}`,
      ],
    );

    const makeProduct = async (providerId: string): Promise<{ id: string; hotelKey: string }> => {
      const id = randomUUID();
      const hotelKey = randomUUID();
      await db.query(
        `INSERT INTO "products"
           (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
            destination_id, status, base_price_usd, cancellation_policy_id, source, attributes,
            created_at, updated_at)
         VALUES ($1, $2, $3, 'HOTEL', $4, 'doble', $5::jsonb, $6::jsonb, $7,
                 'PUBLISHED', '100.00', NULL, 'OWN', '{}'::jsonb, now(), now())`,
        [
          id,
          tenantA,
          providerId,
          hotelKey,
          JSON.stringify({ es: "Hotel de prueba", en: "Test hotel" }),
          JSON.stringify({ es: "Habitación de prueba", en: "Test room" }),
          destinationId,
        ],
      );
      return { id, hotelKey };
    };
    const productA = await makeProduct(providerAId);
    const productB = await makeProduct(providerBId);

    await db.query(
      `INSERT INTO "exchange_rates"
         (id, tenant_id, source, rate, value_date, fetched_at, is_override)
       VALUES ($1, $2, 'cotizave', '36.0000', CURRENT_DATE, now(), false)`,
      [randomUUID(), tenantA],
    );

    const nightIn = "2027-01-10";
    const nightOut = "2027-01-11";
    const makeBooking = async (
      productIds: Array<{ id: string; hotelKey: string }>,
    ): Promise<string> => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO "bookings"
           (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
         VALUES ($1, $2, $3, $4, 'CONFIRMED', '100.00', $5::jsonb,
                 now() + interval '30 minutes', now())`,
        [id, tenantA, generateBookingCode(), clientId, travelers],
      );
      for (const product of productIds) {
        await db.query(
          `INSERT INTO "booking_items"
             (id, booking_id, tenant_id, product_id, hotel_key, room_type, check_in, check_out,
              quantity, nightly_prices, subtotal_usd, product_title, policy_snapshot)
           VALUES ($1, $2, $3, $4, $5, 'doble', $6::date, $7::date, 1, $8::jsonb,
                   '100.00', $9::jsonb, $10::jsonb)`,
          [
            randomUUID(),
            id,
            tenantA,
            product.id,
            product.hotelKey,
            nightIn,
            nightOut,
            JSON.stringify([{ night: nightIn, price_usd: "100.00" }]),
            JSON.stringify({ es: "Hotel de prueba", en: "Test hotel" }),
            JSON.stringify({
              policyId: null,
              name: "Flexible hasta 48 horas",
              rules: [{ hours_before: 48, percentage: 100 }],
            }),
          ],
        );
      }
      return id;
    };
    bookingA = await makeBooking([productA]);
    bookingB = await makeBooking([productB]);
    bookingAB = await makeBooking([productA, productB]);

    const makeDocument = async (bookingId: string, number: number): Promise<string> => {
      const id = randomUUID();
      const fileUrl = `vouchers/${id}.pdf`;
      const path = join(apiConfig.documentsDir, fileUrl);
      await mkdir(join(apiConfig.documentsDir, "vouchers"), { recursive: true });
      await writeFile(path, "%PDF-1.4 documento de prueba");
      writtenFiles.push(path);
      await db.query(
        `INSERT INTO "documents"
           (id, tenant_id, booking_id, payment_id, type, number, status, issued_at, file_url, created_at)
         VALUES ($1, $2, $3, NULL, 'VOUCHER', $4, 'READY', now(), $5, now())`,
        [id, tenantA, bookingId, number, fileUrl],
      );
      return id;
    };
    docA = await makeDocument(bookingA, 1);
    docB = await makeDocument(bookingB, 2);
  });

  afterAll(async () => {
    for (const path of writtenFiles) await unlink(path).catch(() => undefined);
    await db?.query(`DELETE FROM "organization" WHERE id = $1`, [tenantA]);
    await db?.end();
    await app?.close();
  });

  it("el proveedor A lista solo las reservas con productos suyos", async () => {
    const { status, body } = await getJson<{ items: Array<{ id: string }> }>("/bookings", providerACookie);
    expect(status).toBe(200);
    expect(body.items.map((item) => item.id).sort()).toEqual([bookingA, bookingAB].sort());
  });

  it("el proveedor B lista solo las reservas con productos suyos", async () => {
    const { status, body } = await getJson<{ items: Array<{ id: string }> }>("/bookings", providerBCookie);
    expect(status).toBe(200);
    expect(body.items.map((item) => item.id).sort()).toEqual([bookingB, bookingAB].sort());
  });

  it("el proveedor A no ve el detalle de una reserva del proveedor B (404)", async () => {
    const { status, body } = await getJson<{ code: string }>(`/bookings/${bookingB}`, providerACookie);
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND" });
  });

  it("una reserva con líneas de ambos proveedores es visible para los dos", async () => {
    await expect(get(`/bookings/${bookingAB}`, providerACookie)).resolves.toMatchObject({
      status: 200,
    });
    await expect(get(`/bookings/${bookingAB}`, providerBCookie)).resolves.toMatchObject({
      status: 200,
    });
  });

  it("un proveedor sin fila en providers no ve reservas de la agencia", async () => {
    const list = await getJson<{ items: Array<{ id: string }> }>("/bookings", providerNoRowCookie);
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);
    const detail = await getJson<{ code: string }>(`/bookings/${bookingA}`, providerNoRowCookie);
    expect(detail.status).toBe(404);
    expect(detail.body).toMatchObject({ code: "NOT_FOUND" });
  });

  it("el dueño de las reservas y el owner de la agencia sí ven todas", async () => {
    const client = await getJson<{ items: Array<{ id: string }> }>("/bookings", clientCookie);
    expect(client.status).toBe(200);
    expect(client.body.items.map((item) => item.id).sort()).toEqual(
      [bookingA, bookingB, bookingAB].sort(),
    );
    const owner = await getJson<{ items: Array<{ id: string }> }>("/bookings", ownerCookie);
    expect(owner.status).toBe(200);
    expect(owner.body.items.map((item) => item.id).sort()).toEqual(
      [bookingA, bookingB, bookingAB].sort(),
    );
  });

  it("el proveedor A lista y descarga solo los documentos de su inventario", async () => {
    const own = await getJson<{ items: Array<{ id: string }> }>(
      `/bookings/${bookingA}/documents`,
      providerACookie,
    );
    expect(own.status).toBe(200);
    expect(own.body.items.map((item) => item.id)).toEqual([docA]);

    const foreignList = await getJson<{ code: string }>(
      `/bookings/${bookingB}/documents`,
      providerACookie,
    );
    expect(foreignList.status).toBe(404);
    expect(foreignList.body).toMatchObject({ code: "NOT_FOUND" });

    const ownDownload = await get(`/documents/${docA}/download`, providerACookie);
    expect(ownDownload.status).toBe(200);
    const foreignDownload = await get(`/documents/${docB}/download`, providerACookie);
    expect(foreignDownload.status).toBe(404);
    await expect(foreignDownload.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
  });

  it("el proveedor B no ve los documentos del proveedor A", async () => {
    const list = await getJson<{ code: string }>(`/bookings/${bookingA}/documents`, providerBCookie);
    expect(list.status).toBe(404);
    expect(list.body).toMatchObject({ code: "NOT_FOUND" });
    const download = await get(`/documents/${docA}/download`, providerBCookie);
    expect(download.status).toBe(404);
  });
});
