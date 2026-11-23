import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
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
 * NUEVO-01 (specs/booking y specs/auth-access): la lectura de reservas con
 * agencia activa exige `booking:read`. Un `member` sin ese permiso recibe 403
 * y no obtiene reservas ni resumen; el `agent` y el cliente sin agencia siguen
 * leyendo las suyas.
 */
describe("lectura de reservas con booking:read", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let db: Client;
  let tenantA: string;
  let memberCookie: string;
  let agentCookie: string;
  let ownerCookie: string;
  let clientCookie: string;
  let bookingId: string;

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

    const owner = await userWithTotp(baseUrl, `readguard-owner-${suffix}@example.com`);
    tenantA = (await createAgency(owner.userId, `Agencia read ${suffix}`, `read-${suffix}`)).id;
    await setActiveOrg(baseUrl, owner.cookie, tenantA);
    ownerCookie = owner.cookie;

    const memberEmail = `readguard-member-${suffix}@example.com`;
    const memberId = await createUser(memberEmail);
    await addMember(tenantA, memberId, "member");
    memberCookie = await signIn(baseUrl, memberEmail);
    await setActiveOrg(baseUrl, memberCookie, tenantA);

    const agentEmail = `readguard-agent-${suffix}@example.com`;
    const agentId = await createUser(agentEmail);
    await addMember(tenantA, agentId, "agent");
    agentCookie = await signIn(baseUrl, agentEmail);
    await setActiveOrg(baseUrl, agentCookie, tenantA);

    const clientEmail = `readguard-client-${suffix}@example.com`;
    const clientId = await createUser(clientEmail);
    clientCookie = await signIn(baseUrl, clientEmail);

    const destinationId = randomUUID();
    const providerId = randomUUID();
    const productId = randomUUID();
    const hotelKey = randomUUID();
    await db.query(
      `INSERT INTO "providers" (id, tenant_id, user_id, name, created_at, updated_at)
       VALUES ($1, $2, NULL, $3, now(), now())`,
      [providerId, tenantA, `Proveedor read ${suffix}`],
    );
    await db.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now())`,
      [
        destinationId,
        tenantA,
        JSON.stringify({ es: "Mérida", en: "Merida" }),
        `read-${suffix}`,
      ],
    );
    await db.query(
      `INSERT INTO "products"
         (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
          destination_id, status, base_price_usd, cancellation_policy_id, source, attributes,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'HOTEL', $4, 'doble', $5::jsonb, $6::jsonb, $7,
               'PUBLISHED', '100.00', NULL, 'OWN', '{}'::jsonb, now(), now())`,
      [
        productId,
        tenantA,
        providerId,
        hotelKey,
        JSON.stringify({ es: "Hotel de prueba", en: "Test hotel" }),
        JSON.stringify({ es: "Habitación de prueba", en: "Test room" }),
        destinationId,
      ],
    );
    await db.query(
      `INSERT INTO "exchange_rates"
         (id, tenant_id, source, rate, value_date, fetched_at, is_override)
       VALUES ($1, $2, 'cotizave', '36.0000', CURRENT_DATE, now(), false)`,
      [randomUUID(), tenantA],
    );

    bookingId = randomUUID();
    await db.query(
      `INSERT INTO "bookings"
         (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 'CONFIRMED', '100.00', $5::jsonb,
               now() + interval '30 minutes', now())`,
      [
        bookingId,
        tenantA,
        generateBookingCode(),
        clientId,
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
        bookingId,
        tenantA,
        productId,
        hotelKey,
        "2027-01-10",
        "2027-01-11",
        JSON.stringify([{ night: "2027-01-10", price_usd: "100.00" }]),
        JSON.stringify({ es: "Hotel de prueba", en: "Test hotel" }),
        JSON.stringify({
          policyId: null,
          name: "Flexible hasta 48 horas",
          rules: [{ hours_before: 48, percentage: 100 }],
        }),
      ],
    );
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM "organization" WHERE id = $1`, [tenantA]);
    await db?.end();
    await app?.close();
  });

  it("un member sin booking:read no ve el listado ni un resumen", async () => {
    const response = await get("/bookings", memberCookie);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ code: "FORBIDDEN" });
    expect(JSON.stringify(body)).not.toContain("items");
    expect(JSON.stringify(body)).not.toContain("nextCursor");
  });

  it("un member sin booking:read no ve el detalle", async () => {
    const response = await get(`/bookings/${bookingId}`, memberCookie);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un agent con booking:read sigue viendo las reservas de su agencia", async () => {
    const list = await get("/bookings", agentCookie);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((item) => item.id)).toContain(bookingId);
    const detail = await get(`/bookings/${bookingId}`, agentCookie);
    expect(detail.status).toBe(200);
  });

  it("el dueño de la agencia y el cliente conservan su lectura", async () => {
    const owner = await get("/bookings", ownerCookie);
    expect(owner.status).toBe(200);
    const ownerBody = (await owner.json()) as { items: Array<{ id: string }> };
    expect(ownerBody.items.map((item) => item.id)).toContain(bookingId);

    const client = await get("/bookings", clientCookie);
    expect(client.status).toBe(200);
    const clientBody = (await client.json()) as { items: Array<{ id: string }> };
    expect(clientBody.items.map((item) => item.id)).toEqual([bookingId]);
  });
});
