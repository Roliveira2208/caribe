import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { todayInCaracas } from "@caribe/shared";
import { Client } from "pg";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { BookingExpirationService } from "../src/jobs/booking-expiration.service.js";
import { JobsScheduler } from "../src/jobs/jobs.scheduler.js";
import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
} from "../src/notifications/notification-provider.js";
import { NotificationService } from "../src/notifications/notification.service.js";
import type { NotificationContent } from "../src/notifications/notification-templates.js";
import { ExchangeRateService } from "../src/rates/exchange-rate.service.js";
import {
  authOrigin,
  createAgency,
  createUser,
  setActiveOrg,
  signIn,
  userWithTotp,
} from "./auth-helpers.js";

/**
 * Integración del único aviso de F1 (T-F1-12, spec notifications). La fila
 * PENDING se reserva dentro de la transacción que confirma la reserva y el
 * correo se encola después del commit. En pruebas BullMQ está apagado y el
 * proveedor es un doble: nunca se abre una conexión SMTP.
 */
describe("notificaciones de confirmación", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let db: Client;
  let scheduler: JobsScheduler;
  let provider: NotificationProvider;
  let notifications: NotificationService;
  let expiration: BookingExpirationService;
  let rates: ExchangeRateService;

  let manualTenant: string;
  let autoTenant: string;
  let adminCookie: string;
  let clientEsCookie: string;
  let clientEnCookie: string;
  let clientFrCookie: string;
  let clientBadCookie: string;
  let clientEsId: string;
  let clientEnId: string;
  let clientFrId: string;
  let clientBadId: string;
  let adminId: string;
  let productManual: string;
  let productAuto: string;
  let hotelKey: string;

  const suffix = randomUUID().slice(0, 8);
  const title = { es: "Hotel Sol", en: "Sun Hotel" };
  const night1 = "2026-12-10";
  const night2 = "2026-12-12";
  const emailEs = `notif-es-${suffix}@example.com`;
  const emailEn = `notif-en-${suffix}@example.com`;
  const emailFr = `notif-fr-${suffix}@example.com`;
  const emailBad = `notif-bad-${suffix}@example.com`;

  const url = (path: string) => `${baseUrl}/api/v1${path}`;
  const dedupeKey = (bookingId: string) => `booking.confirmed:${bookingId}`;
  const noSleep = async () => undefined;

  let sent: Array<{ template: NotificationContent; recipient: string }>;
  let enqueued: Array<{ notificationId: string; tenantId: string }>;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    scheduler = app.get(JobsScheduler);
    provider = app.get(NOTIFICATION_PROVIDER);
    notifications = app.get(NotificationService);
    expiration = app.get(BookingExpirationService);
    rates = app.get(ExchangeRateService);

    const admin = await userWithTotp(baseUrl, `notif-admin-${suffix}@example.com`);
    adminId = admin.userId;
    adminCookie = admin.cookie;
    manualTenant = (await createAgency(adminId, `Manual ${suffix}`, `notif-manual-${suffix}`)).id;
    await setActiveOrg(baseUrl, adminCookie, manualTenant);
    const autoOwner = await createUser(`notif-owner-${suffix}@example.com`);
    autoTenant = (await createAgency(autoOwner, `Auto ${suffix}`, `notif-auto-${suffix}`)).id;

    clientEsId = await createUser(emailEs);
    clientEnId = await createUser(emailEn);
    clientFrId = await createUser(emailFr);
    clientBadId = await createUser(emailBad);
    await db.query(`UPDATE "user" SET locale = 'en' WHERE id = $1`, [clientEnId]);
    await db.query(`UPDATE "user" SET locale = 'fr' WHERE id = $1`, [clientFrId]);
    await db.query(`UPDATE "user" SET locale = NULL WHERE id = $1`, [clientBadId]);
    clientEsCookie = await signIn(baseUrl, emailEs);
    clientEnCookie = await signIn(baseUrl, emailEn);
    clientFrCookie = await signIn(baseUrl, emailFr);
    clientBadCookie = await signIn(baseUrl, emailBad);
    // Un correo inválido tras iniciar sesión: el aviso se registra como fallido
    // sin bloquear la reserva.
    await db.query(`UPDATE "user" SET email = $1 WHERE id = $2`, [
      `correo-invalido-${suffix}`,
      clientBadId,
    ]);

    const today = todayInCaracas();
    productManual = await seedTenant(manualTenant, adminId, "MANUAL", today, "man");
    productAuto = await seedTenant(autoTenant, autoOwner, "AUTO", today, "auto");
    hotelKey = randomUUID();
  });

  async function seedTenant(
    tenantId: string,
    ownerId: string,
    mode: "MANUAL" | "AUTO",
    today: string,
    label: string,
  ): Promise<string> {
    await db.query(
      `INSERT INTO "tenant_settings" (tenant_id, hold_minutes, payment_mode, updated_at)
       VALUES ($1, 30, $2, now())`,
      [tenantId, mode],
    );
    await db.query(
      `INSERT INTO "exchange_rates"
         (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
       VALUES ($1, $2, 'MANUAL', 36.0000, $3::date, now(), true, 'Prueba de notificaciones', $4)`,
      [randomUUID(), tenantId, today, ownerId],
    );
    const providerId = randomUUID();
    const destinationId = randomUUID();
    await db.query(
      `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [providerId, tenantId, `Proveedor ${label} ${suffix}`],
    );
    await db.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now())`,
      [
        destinationId,
        tenantId,
        JSON.stringify({ es: "Mérida", en: "Merida" }),
        `notif-${label}-${suffix}`,
      ],
    );
    const productId = randomUUID();
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
        randomUUID(),
        JSON.stringify(title),
        JSON.stringify({ es: "Descripción", en: "Description" }),
        destinationId,
      ],
    );
    return productId;
  }

  beforeEach(() => {
    sent = [];
    enqueued = [];
    // La tasa del día ya está sembrada: evitar la llamada real a Cotizave
    // mantiene estas pruebas deterministas y dentro del timeout del suite.
    vi.spyOn(rates, "ensureTodayRate").mockResolvedValue(undefined);
    vi.spyOn(provider, "send").mockImplementation(async (template, recipient) => {
      sent.push({ template, recipient });
    });
    vi.spyOn(scheduler, "enqueueNotification").mockImplementation(async (payload) => {
      enqueued.push(payload);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM "organization" WHERE id IN ($1, $2)`, [
      manualTenant,
      autoTenant,
    ]);
    await db?.end();
    await app?.close();
  });

  async function makeBooking(
    tenantId: string,
    userId: string,
    productId: string,
    expiresAt = "now() + interval '30 minutes'",
  ): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO "bookings"
         (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', '200.00', $5::jsonb, ${expiresAt}, now())`,
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
    await db.query(
      `INSERT INTO "booking_items"
         (id, booking_id, tenant_id, product_id, hotel_key, room_type, check_in, check_out,
          quantity, nightly_prices, subtotal_usd, product_title, policy_snapshot)
       VALUES ($1, $2, $3, $4, $5, 'doble', $6::date, $7::date, 1, $8::jsonb,
               '200.00', $9::jsonb, $10::jsonb)`,
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
        JSON.stringify({ policyId: null, name: "Flexible", rules: [] }),
      ],
    );
    return id;
  }

  async function postPayment(cookie: string, bookingId: string, reference: string) {
    return fetch(url(`/bookings/${bookingId}/payments`), {
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
  }

  async function approve(paymentId: string) {
    return fetch(url(`/admin/payments/${paymentId}/approve`), {
      method: "PATCH",
      headers: { cookie: adminCookie, origin: authOrigin },
    });
  }

  async function logFor(bookingId: string) {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      dedupe_key: string;
      template: string;
      recipient: string;
      locale: string;
      status: string;
      attempts: number;
      last_error: string | null;
    }>(`SELECT * FROM "notification_logs" WHERE dedupe_key = $1`, [dedupeKey(bookingId)]);
    return result.rows[0];
  }

  it("la aprobación manual reserva el aviso dentro de la transacción y lo encola tras el commit", async () => {
    const bookingId = await makeBooking(manualTenant, clientEsId, productManual);
    const payment = await postPayment(clientEsCookie, bookingId, `manual${suffix}`);
    const paymentId = ((await payment.json()) as { id: string }).id;
    const seenAtEnqueue: number[] = [];
    vi.spyOn(scheduler, "enqueueNotification").mockImplementation(async (payload) => {
      enqueued.push(payload);
      const rows = await db.query(`SELECT 1 FROM "notification_logs" WHERE dedupe_key = $1`, [
        dedupeKey(bookingId),
      ]);
      seenAtEnqueue.push(rows.rowCount ?? 0);
    });

    expect((await approve(paymentId)).status).toBe(200);
    expect(seenAtEnqueue).toEqual([1]);
    expect(await logFor(bookingId)).toMatchObject({
      template: "BOOKING_CONFIRMED",
      recipient: emailEs,
      locale: "es",
      status: "PENDING",
      attempts: 0,
    });
    expect(enqueued).toEqual([{ notificationId: (await logFor(bookingId))?.id, tenantId: manualTenant }]);
    expect(sent).toEqual([]);
  });

  it("la aprobación automática reserva el aviso una sola vez", async () => {
    const bookingId = await makeBooking(autoTenant, clientEnId, productAuto);
    const payment = await postPayment(clientEnCookie, bookingId, `auto${suffix}`);
    expect(payment.status).toBe(201);

    const log = await logFor(bookingId);
    expect(log).toMatchObject({ recipient: emailEn, locale: "en", status: "PENDING" });
    expect(enqueued).toHaveLength(1);

    const retry = await postPayment(clientEnCookie, bookingId, `auto${suffix}`);
    expect(retry.status).toBe(409);
    expect(enqueued).toHaveLength(1);
  });

  it("el aviso usa el idioma del usuario y cae a español sin plantilla o locale", async () => {
    const enBooking = await makeBooking(autoTenant, clientEnId, productAuto);
    await postPayment(clientEnCookie, enBooking, `localeen${suffix}`);
    const enLog = await logFor(enBooking);
    expect((await notifications.sendWithRetries(enLog!.id, autoTenant, { sleep: noSleep })).status).toBe(
      "SENT",
    );
    expect(sent[0]?.template.subject).toContain("confirmed");
    expect(sent[0]?.template.body).toContain("Your booking");

    const frBooking = await makeBooking(manualTenant, clientFrId, productManual);
    const frPayment = await postPayment(clientFrCookie, frBooking, `localefr${suffix}`);
    await approve(((await frPayment.json()) as { id: string }).id);
    const frLog = await logFor(frBooking);
    expect(frLog?.locale).toBe("es");
    await notifications.sendWithRetries(frLog!.id, manualTenant, { sleep: noSleep });
    expect(sent[1]?.template.subject).toContain("confirmada");
  });

  it("reintentar el mismo evento no envía un segundo correo", async () => {
    const bookingId = await makeBooking(manualTenant, clientEsId, productManual);
    const payment = await postPayment(clientEsCookie, bookingId, `dedupe${suffix}`);
    const paymentId = ((await payment.json()) as { id: string }).id;
    await approve(paymentId);
    const log = await logFor(bookingId);

    const first = await notifications.sendWithRetries(log!.id, manualTenant, { sleep: noSleep });
    const second = await notifications.sendWithRetries(log!.id, manualTenant, { sleep: noSleep });
    expect(first).toMatchObject({ status: "SENT", sent: true });
    expect(second).toMatchObject({ status: "SENT", sent: false });
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(await logFor(bookingId)).toMatchObject({ status: "SENT", attempts: 1 });

    const retryApproval = await approve(paymentId);
    expect(retryApproval.status).toBe(409);
    expect(await db.query(`SELECT 1 FROM "notification_logs" WHERE dedupe_key = $1`, [
      dedupeKey(bookingId),
    ])).toHaveProperty("rowCount", 1);
  });

  it("un fallo de SMTP agota los reintentos, queda FAILED y no cambia la reserva", async () => {
    const bookingId = await makeBooking(manualTenant, clientEsId, productManual);
    const payment = await postPayment(clientEsCookie, bookingId, `smtp${suffix}`);
    const paymentId = ((await payment.json()) as { id: string }).id;
    await approve(paymentId);
    vi.spyOn(provider, "send").mockRejectedValue(new Error("SMTP caído"));
    const log = await logFor(bookingId);

    const result = await notifications.sendWithRetries(log!.id, manualTenant, { sleep: noSleep });
    expect(result).toMatchObject({ status: "FAILED", attempts: 3 });
    expect(provider.send).toHaveBeenCalledTimes(3);
    expect(await logFor(bookingId)).toMatchObject({ status: "FAILED", attempts: 3 });
    expect((await logFor(bookingId))?.last_error).toContain("SMTP caído");

    const stored = await db.query<{ status: string }>(
      `SELECT status FROM bookings WHERE id = $1`,
      [bookingId],
    );
    const paid = await db.query<{ status: string }>(`SELECT status FROM payments WHERE id = $1`, [
      paymentId,
    ]);
    expect(stored.rows[0]?.status).toBe("CONFIRMED");
    expect(paid.rows[0]?.status).toBe("APPROVED");
  });

  it("solo hay un destinatario y el cuerpo no filtra datos personales ni de pago", async () => {
    const bookingId = await makeBooking(manualTenant, clientEsId, productManual);
    const payment = await postPayment(clientEsCookie, bookingId, `privacy${suffix}`);
    await approve(((await payment.json()) as { id: string }).id);
    const log = await logFor(bookingId);
    await notifications.sendWithRetries(log!.id, manualTenant, { sleep: noSleep });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.recipient).toBe(emailEs);
    const rendered = `${sent[0]?.template.subject}\n${sent[0]?.template.body}`;
    expect(rendered).not.toContain("12345678");
    expect(rendered).not.toContain("4111111111111111");
    expect(rendered).not.toContain("cvv");
    expect(rendered).toContain(`/reservas/`);
  });

  it("sin correo válido el aviso falla sin bloquear la reserva", async () => {
    const bookingId = await makeBooking(manualTenant, clientBadId, productManual);
    const payment = await postPayment(clientBadCookie, bookingId, `badmail${suffix}`);
    await approve(((await payment.json()) as { id: string }).id);
    const log = await logFor(bookingId);
    expect(log?.recipient).toBe(`correo-invalido-${suffix}`);

    const result = await notifications.sendWithRetries(log!.id, manualTenant, { sleep: noSleep });
    expect(result.status).toBe("FAILED");
    expect(provider.send).not.toHaveBeenCalled();
    const stored = await db.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [
      bookingId,
    ]);
    expect(stored.rows[0]?.status).toBe("CONFIRMED");
  });

  it("no se envían avisos de rechazo, cancelación ni expiración en F1", async () => {
    const rejected = await makeBooking(manualTenant, clientEsId, productManual);
    const toReject = await postPayment(clientEsCookie, rejected, `reject${suffix}`);
    const rejectId = ((await toReject.json()) as { id: string }).id;
    expect(
      (
        await fetch(url(`/admin/payments/${rejectId}/reject`), {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie: adminCookie, origin: authOrigin },
          body: JSON.stringify({ reason: "Prueba" }),
        })
      ).status,
    ).toBe(200);

    const cancelled = await makeBooking(manualTenant, clientEsId, productManual);
    expect(
      (
        await fetch(url(`/bookings/${cancelled}/cancel`), {
          method: "POST",
          headers: { cookie: clientEsCookie, origin: authOrigin },
        })
      ).status,
    ).toBe(200);

    const expired = await makeBooking(
      manualTenant,
      clientEsId,
      productManual,
      "now() - interval '1 minute'",
    );
    await expiration.expireDueBookings();

    for (const bookingId of [rejected, cancelled, expired]) {
      expect(await logFor(bookingId)).toBeUndefined();
    }
    expect(enqueued).toEqual([]);
    expect(provider.send).not.toHaveBeenCalled();
  });
});
