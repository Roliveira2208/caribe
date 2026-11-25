import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { todayInCaracas } from "@caribe/shared";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { addDays } from "../src/catalog/catalog.schemas.js";
import { apiConfig } from "../src/config.js";
import { prisma } from "../src/prisma.js";
import {
  authOrigin,
  createAgency,
  createUser,
  setActiveOrg,
  signIn,
  userWithTotp,
} from "./auth-helpers.js";

/**
 * E2E de los límites de rutas de negocio (T-F2-4, spec security).
 *
 * Cada familia usa una IP real distinta detrás del proxy de confianza: el
 * contador es por cliente y no un bucket global. Los umbrales se fijan a 2 en
 * esta suite para no alterar los e2e de F1, que comparten la misma API y
 * ejecutan muchas más peticiones desde la IP local.
 */
describe("rate limiting de negocio", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let db: Client;

  let tenantId: string;
  let clientId: string;
  let clientCookie: string;
  let adminCookie: string;
  let productId: string;
  let hotelKey: string;
  let rateId: string;
  let reviewPaymentId: string;
  let downloadBookingId: string;
  let documentId: string;
  let documentPath: string;

  const suffix = randomUUID().slice(0, 8);
  const providerId = randomUUID();
  const destinationId = randomUUID();
  const trustedSocket = "127.0.0.1";
  const ipBookings = "203.0.113.30";
  const ipPayments = "203.0.113.31";
  const ipReviews = "203.0.113.32";
  const ipDownloads = "203.0.113.33";

  const today = todayInCaracas();
  const travelers = JSON.stringify([
    {
      fullName: "Ana Pérez",
      documentType: "V",
      documentNumber: "12345678",
      phone: "+584141234567",
      email: "ana@example.com",
    },
  ]);
  // La tasa de ayer solo alimenta la FK del pago insertado: la de hoy la crea
  // el propio servicio al reportar, y así no choca con el índice único.
  const rateDate = addDays(today, -1);
  const night1 = addDays(today, 10);
  const night2 = addDays(today, 11);
  const checkOut = addDays(today, 12);

  const envKeys = [
    "RATE_LIMIT_WINDOW_SECONDS",
    "RATE_LIMIT_BOOKINGS_MAX",
    "RATE_LIMIT_PAYMENTS_MAX",
    "RATE_LIMIT_PAYMENT_REVIEWS_MAX",
    "RATE_LIMIT_DOWNLOADS_MAX",
  ] as const;
  let previousEnv = new Map<string, string | undefined>();

  function url(path: string): string {
    return `${baseUrl}/api/v1${path}`;
  }

  function chainOf(ip: string): string {
    return `${ip}, ${trustedSocket}`;
  }

  async function send(
    path: string,
    options: {
      method?: string;
      cookie?: string;
      ip: string;
      body?: unknown;
      key?: string;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      origin: authOrigin,
      "x-forwarded-for": chainOf(options.ip),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.key ? { "Idempotency-Key": options.key } : {}),
    };
    return fetch(url(path), {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(10_000),
    });
  }

  /** Un 429 del contrato: Problem Details con código estable y sin IP filtrada. */
  async function expectRateLimited(response: Response, ip: string): Promise<void> {
    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await response.json()) as { code?: string; detail?: string };
    expect(problem.code).toBe("RATE_LIMITED");
    expect(problem.detail).not.toContain(ip);
    expect(problem.detail).not.toContain(trustedSocket);
  }

  function bookingBody(): unknown {
    return {
      productId,
      checkIn: night1,
      checkOut,
      quantity: 1,
      travelers: [
        {
          fullName: "Ana Pérez",
          documentType: "V",
          documentNumber: "12345678",
          phone: "+584141234567",
          email: "ana@example.com",
        },
      ],
    };
  }

  beforeAll(async () => {
    previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
    for (const key of envKeys) process.env[key] = "2";

    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl())
      .replace(/\/$/, "")
      .replace("localhost", "127.0.0.1")
      .replace("[::1]", "127.0.0.1");

    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    const clientEmail = `rate-biz-client-${suffix}@example.com`;
    clientId = await createUser(clientEmail);
    clientCookie = await signIn(baseUrl, clientEmail);
    const admin = await userWithTotp(baseUrl, `rate-biz-admin-${suffix}@example.com`);
    tenantId = (await createAgency(admin.userId, `Agencia límites ${suffix}`, `limites-${suffix}`)).id;
    await setActiveOrg(baseUrl, admin.cookie, tenantId);
    adminCookie = admin.cookie;
    // MANUAL evita que el alta apruebe y emita documentos: el estado del pago
    // y de la reserva debe quedarse intacto cuando el límite responde 429.
    await db.query(
      `INSERT INTO "tenant_settings" (tenant_id, payment_mode, updated_at)
       VALUES ($1, 'MANUAL', now())`,
      [tenantId],
    );

    await db.query(
      `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [providerId, tenantId, `Proveedor ${suffix}`],
    );
    await db.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now())`,
      [destinationId, tenantId, JSON.stringify({ es: "Mérida", en: "Merida" }), `rl-${suffix}`],
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
        JSON.stringify({ es: "Hotel Sol", en: "Sun Hotel" }),
        JSON.stringify({ es: "Habitación doble", en: "Double room" }),
        destinationId,
      ],
    );
    for (const night of [night1, night2]) {
      await db.query(
        `INSERT INTO "availability"
           (id, tenant_id, product_id, night, capacity, reserved, price_usd, created_at, updated_at)
         VALUES ($1, $2, $3, $4::date, 5, 0, '100.00', now(), now())`,
        [randomUUID(), tenantId, productId, night],
      );
    }

    rateId = randomUUID();
    await db.query(
      `INSERT INTO "exchange_rates"
         (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
       VALUES ($1, $2, 'MANUAL', '36.0000', $3::date, now(), true, $4, $5)`,
      [rateId, tenantId, rateDate, `Prueba de límites ${suffix}`, admin.userId],
    );

    // Pago en revisión insertado directamente: el alta se prueba aparte y aquí
    // solo interesa que la revisión rechazada no cambie su estado.
    reviewPaymentId = randomUUID();
    const reviewBookingId = randomUUID();
    await db.query(
      `INSERT INTO "bookings"
         (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', '100.00', $5::jsonb,
               now() + interval '30 minutes', now())`,
      [reviewBookingId, tenantId, generateBookingCode(), clientId, travelers],
    );
    await db.query(
      `INSERT INTO "payments"
         (id, tenant_id, booking_id, method, amount_usd, amount_ves, exchange_rate_id,
          rate, value_date, reported_by, status, created_at)
       VALUES ($1, $2, $3, 'BINANCE_PAY', '100.00', '3600.00', $4,
               '36.0000', $5::date, $6, 'IN_REVIEW', now())`,
      [reviewPaymentId, tenantId, reviewBookingId, rateId, rateDate, clientId],
    );

    // Documento listo con un PDF real en el directorio temporal de la API.
    downloadBookingId = randomUUID();
    await db.query(
      `INSERT INTO "bookings"
         (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 'CONFIRMED', '100.00', $5::jsonb,
               now() + interval '30 minutes', now())`,
      [downloadBookingId, tenantId, generateBookingCode(), clientId, travelers],
    );
    documentId = randomUUID();
    // file_url es relativo con barras hacia adelante: Windows no debe filtrar
    // una ruta generada por el propio servidor.
    const relativePath = `vouchers/${documentId}.pdf`;
    documentPath = join(apiConfig.documentsDir, "vouchers", `${documentId}.pdf`);
    await mkdir(join(apiConfig.documentsDir, "vouchers"), { recursive: true });
    await writeFile(documentPath, "%PDF-1.4\n% documento de prueba\n");
    await db.query(
      `INSERT INTO "documents"
         (id, tenant_id, booking_id, type, number, file_url, language, status, issued_at, created_at)
       VALUES ($1, $2, $3, 'VOUCHER', 1, $4, 'es', 'READY', now(), now())`,
      [documentId, tenantId, downloadBookingId, relativePath],
    );
  });

  afterAll(async () => {
    await unlink(documentPath).catch(() => undefined);
    await db?.query(`DELETE FROM "idempotency_keys" WHERE user_id = $1`, [clientId]);
    await db?.query(`DELETE FROM "organization" WHERE id = $1`, [tenantId]);
    await db?.end();
    await app?.close();
    await prisma.$disconnect();
    for (const key of envKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("Límite en creación de reservas", async () => {
    const before = await db.query<{ id: string }>(
      `SELECT id FROM "bookings" WHERE user_id = $1`,
      [clientId],
    );
    const auditBefore = await prisma.auditLog.count({ where: { action: "booking.create" } });

    for (let i = 0; i < 2; i += 1) {
      const ok = await send("/bookings", {
        method: "POST",
        cookie: clientCookie,
        ip: ipBookings,
        key: `booking-${suffix}-${i}`,
        body: bookingBody(),
      });
      expect(ok.status, await ok.text()).toBe(201);
    }

    const limited = await send("/bookings", {
      method: "POST",
      cookie: clientCookie,
      ip: ipBookings,
      key: `booking-${suffix}-limit`,
      body: bookingBody(),
    });
    await expectRateLimited(limited, ipBookings);

    const after = await db.query<{ id: string }>(
      `SELECT id FROM "bookings" WHERE user_id = $1`,
      [clientId],
    );
    expect(after.rows).toHaveLength(before.rows.length + 2);
    expect(await prisma.auditLog.count({ where: { action: "booking.create" } })).toBe(auditBefore + 2);
    const availability = await db.query<{ reserved: number }>(
      `SELECT reserved FROM "availability" WHERE product_id = $1 ORDER BY night`,
      [productId],
    );
    expect(availability.rows.every((row) => row.reserved === 2)).toBe(true);

    // Otra IP real tiene su propio contador: su primer alta no es 429.
    const other = await send("/bookings", {
      method: "POST",
      cookie: clientCookie,
      ip: "203.0.113.39",
      key: `booking-${suffix}-other`,
      body: bookingBody(),
    });
    expect(other.status, await other.text()).toBe(201);
  });

  it("Límite en alta y revisión de pagos", async () => {
    const booking = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM "bookings" WHERE user_id = $1 AND status = 'PENDING_PAYMENT' LIMIT 1`,
      [clientId],
    );
    const bookingId = booking.rows[0]?.id;
    expect(bookingId).toBeTruthy();
    if (!bookingId) return;
    const paymentsBefore = await prisma.payment.count({ where: { bookingId } });

    for (let i = 0; i < 2; i += 1) {
      const ok = await send(`/bookings/${bookingId}/payments`, {
        method: "POST",
        cookie: clientCookie,
        ip: ipPayments,
        key: `payment-${suffix}-${i}`,
        body: { method: "CARD", last4: "4242", brand: "Visa" },
      });
      expect(ok.status, await ok.text()).toBe(201);
    }

    const limitedCreate = await send(`/bookings/${bookingId}/payments`, {
      method: "POST",
      cookie: clientCookie,
      ip: ipPayments,
      key: `payment-${suffix}-limit`,
      body: { method: "CARD", last4: "4242", brand: "Visa" },
    });
    await expectRateLimited(limitedCreate, ipPayments);
    expect(await prisma.payment.count({ where: { bookingId } })).toBe(paymentsBefore + 2);
    const bookingStatus = await db.query<{ status: string }>(
      `SELECT status FROM "bookings" WHERE id = $1`,
      [bookingId],
    );
    expect(bookingStatus.rows[0]?.status).toBe("PENDING_PAYMENT");

    // Dos revisiones fallidas agotan el contador de revisión; la siguiente,
    // aunque es sobre un pago real, se rechaza sin tocar su estado.
    for (let i = 0; i < 2; i += 1) {
      const miss = await send(`/admin/payments/${randomUUID()}/approve`, {
        method: "PATCH",
        cookie: adminCookie,
        ip: ipReviews,
      });
      expect(miss.status).toBe(404);
    }
    const limitedReview = await send(`/admin/payments/${reviewPaymentId}/approve`, {
      method: "PATCH",
      cookie: adminCookie,
      ip: ipReviews,
    });
    await expectRateLimited(limitedReview, ipReviews);

    const review = await prisma.payment.findUniqueOrThrow({
      where: { id: reviewPaymentId },
      select: { status: true, reviewedBy: true, reviewedAt: true },
    });
    expect(review.status).toBe("IN_REVIEW");
    expect(review.reviewedBy).toBeNull();
    expect(review.reviewedAt).toBeNull();
  });

  it("Límite de descargas", async () => {
    for (let i = 0; i < 2; i += 1) {
      const ok = await send(`/documents/${documentId}/download`, {
        ip: ipDownloads,
        cookie: clientCookie,
      });
      const bytes = Buffer.from(await ok.arrayBuffer());
      expect(ok.status).toBe(200);
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    }

    const limited = await send(`/documents/${documentId}/download`, {
      ip: ipDownloads,
      cookie: clientCookie,
    });
    const body = await limited.text();
    expect(limited.status).toBe(429);
    expect(body).toContain("RATE_LIMITED");
    expect(body).not.toContain("%PDF-");
    expect(body).not.toContain(documentPath);
    expect(limited.headers.get("content-type")).not.toContain("application/pdf");

    // La misma IP con la ventana ya consumida no entrega bytes; otra IP sigue
    // pudiendo descargar el mismo documento.
    const other = await send(`/documents/${documentId}/download`, {
      ip: "203.0.113.49",
      cookie: clientCookie,
    });
    expect(other.status, await other.text()).toBe(200);
  });
});
