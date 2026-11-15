import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { todayInCaracas } from "@caribe/shared";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { BOOKING_CODE_PATTERN } from "../src/bookings/booking-code.js";
import {
  BOOKINGS_CREATE_ENDPOINT,
  createBookingSchema,
  hashBookingRequest,
  type CreateBookingBody,
  type Traveler,
} from "../src/bookings/bookings.schemas.js";
import { addDays } from "../src/catalog/catalog.schemas.js";
import { prisma } from "../src/prisma.js";
import { authOrigin, createUser, signIn } from "./auth-helpers.js";

/**
 * E2E de creacion de reservas (T-F1-7, delta de booking "Retencion de cupo sin
 * sobreventa", "Vencimiento de la retencion" —solo retencion—, "Idempotencia",
 * "Codigo de reserva", "Datos del viajero" y "Auditoria de reservas").
 *
 * Las agencias, productos y noches se montan por SQL directo (el cliente de
 * pruebas conecta como superusuario y no pasa por RLS) y las reservas se crean
 * por HTTP con sesiones reales. Cada caso parte de un estado limpio: antes de
 * cada prueba se borran las reservas y claves de idempotencia de las agencias y
 * usuarios de la suite y se restaura `availability.reserved`. Las filas de
 * `audit_logs` no se pueden borrar (trigger de inmutabilidad), asi que las
 * comprobaciones de auditoria se acotan por `entity_id`.
 */
describe("bookings (creacion de reservas)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let owner: Client;

  let clientA = "";
  let clientB = "";
  let cookieA = "";
  let cookieB = "";

  const suffix = randomUUID().slice(0, 8);

  const orgA = randomUUID();
  const orgHold = randomUUID();
  const orgFail = randomUUID();

  const providerA = randomUUID();
  const providerHold = randomUUID();
  const providerFail = randomUUID();

  const destA = randomUUID();
  const destHold = randomUUID();
  const destFail = randomUUID();

  const hotelKeyStd = randomUUID();
  const policyFlex = randomUUID();

  const pStd = randomUUID();
  const pMissing = randomUUID();
  const pFull = randomUUID();
  const pLast = randomUUID();
  const pDraft = randomUUID();
  const pArchived = randomUUID();
  const pDeleted = randomUUID();
  const pPolicy = randomUUID();
  const pHold = randomUUID();
  const pFail = randomUUID();

  const today = todayInCaracas();
  const night1 = addDays(today, 10);
  const night2 = addDays(today, 11);
  const night3 = addDays(today, 12);
  const night4 = addDays(today, 13);

  /** Valores iniciales de `reserved` para restaurarlos antes de cada prueba. */
  const availabilityBaseline: Array<{ productId: string; night: string; reserved: number }> =
    [];

  const titleA = { es: "Hotel Sol", en: "Sun Hotel" };
  const descriptionA = { es: "Habitación standard", en: "Standard room" };
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

    clientA = await createUser(`bookings-a-${suffix}@example.com`);
    clientB = await createUser(`bookings-b-${suffix}@example.com`);
    cookieA = await signIn(baseUrl, `bookings-a-${suffix}@example.com`);
    cookieB = await signIn(baseUrl, `bookings-b-${suffix}@example.com`);

    await owner.query(
      `INSERT INTO "organization" (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, now()), ($4, $5, $6, now()), ($7, $8, $9, now())`,
      [
        orgA,
        `Reservas A ${suffix}`,
        `reservas-a-${suffix}`,
        orgHold,
        `Reservas retención ${suffix}`,
        `reservas-hold-${suffix}`,
        orgFail,
        `Reservas auditoría ${suffix}`,
        `reservas-fail-${suffix}`,
      ],
    );

    await owner.query(
      `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now()),
              ($4, $5, $6, now(), now()),
              ($7, $8, $9, now(), now())`,
      [
        providerA,
        orgA,
        `Proveedor A ${suffix}`,
        providerHold,
        orgHold,
        `Proveedor retención ${suffix}`,
        providerFail,
        orgFail,
        `Proveedor auditoría ${suffix}`,
      ],
    );

    await owner.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now()),
              ($5, $6, $7::jsonb, 'VE', $8, now(), now()),
              ($9, $10, $11::jsonb, 'VE', $12, now(), now())`,
      [
        destA,
        orgA,
        JSON.stringify({ es: "Mérida", en: "Merida" }),
        `mer-${suffix}`,
        destHold,
        orgHold,
        JSON.stringify({ es: "Margarita", en: "Margarita" }),
        `pmv-${suffix}`,
        destFail,
        orgFail,
        JSON.stringify({ es: "Canaima", en: "Canaima" }),
        `cna-${suffix}`,
      ],
    );

    await owner.query(
      `INSERT INTO "cancellation_policies" (id, tenant_id, name, rules, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now(), now())`,
      [policyFlex, orgA, "Flexible", JSON.stringify(flexibleRules)],
    );

    await owner.query(
      `INSERT INTO "tenant_settings" (tenant_id, hold_minutes, updated_at)
       VALUES ($1, 15, now())`,
      [orgHold],
    );

    await product({
      id: pStd,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: hotelKeyStd,
      roomType: "standard",
      status: "PUBLISHED",
      basePrice: "100.00",
      cancellationPolicyId: null,
    });
    await product({
      id: pMissing,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: randomUUID(),
      roomType: "twin",
      status: "PUBLISHED",
      basePrice: "100.00",
      cancellationPolicyId: null,
    });
    await product({
      id: pFull,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: randomUUID(),
      roomType: "family",
      status: "PUBLISHED",
      basePrice: "120.00",
      cancellationPolicyId: null,
    });
    await product({
      id: pLast,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: randomUUID(),
      roomType: "single",
      status: "PUBLISHED",
      basePrice: "100.00",
      cancellationPolicyId: null,
    });
    await product({
      id: pDraft,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: randomUUID(),
      roomType: "suite",
      status: "DRAFT",
      basePrice: "150.00",
      cancellationPolicyId: null,
    });
    await product({
      id: pArchived,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: randomUUID(),
      roomType: "triple",
      status: "ARCHIVED",
      basePrice: "150.00",
      cancellationPolicyId: null,
    });
    await product({
      id: pDeleted,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: randomUUID(),
      roomType: "deluxe",
      status: "PUBLISHED",
      basePrice: "150.00",
      cancellationPolicyId: null,
      deletedAt: new Date(),
    });
    await product({
      id: pPolicy,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: randomUUID(),
      roomType: "policy",
      status: "PUBLISHED",
      basePrice: "110.00",
      cancellationPolicyId: policyFlex,
    });
    await product({
      id: pHold,
      tenantId: orgHold,
      providerId: providerHold,
      destinationId: destHold,
      hotelKey: randomUUID(),
      roomType: "standard",
      status: "PUBLISHED",
      basePrice: "100.00",
      cancellationPolicyId: null,
    });
    await product({
      id: pFail,
      tenantId: orgFail,
      providerId: providerFail,
      destinationId: destFail,
      hotelKey: randomUUID(),
      roomType: "standard",
      status: "PUBLISHED",
      basePrice: "100.00",
      cancellationPolicyId: null,
    });

    // pStd: tres noches con precios distintos y solo dos cupos libres.
    await availability(pStd, orgA, night1, 5, 3, "100.00");
    await availability(pStd, orgA, night2, 5, 3, "120.00");
    await availability(pStd, orgA, night3, 5, 3, "90.00");

    // pMissing: falta la última noche del rango de tres.
    await availability(pMissing, orgA, night1, 5, 0, "100.00");
    await availability(pMissing, orgA, night2, 5, 0, "100.00");

    // pFull: la segunda noche solo tiene un cupo libre.
    await availability(pFull, orgA, night1, 5, 1, "120.00");
    await availability(pFull, orgA, night2, 5, 4, "120.00");
    await availability(pFull, orgA, night3, 5, 1, "120.00");

    // pLast: un único cupo por noche para la carrera de concurrencia.
    await availability(pLast, orgA, night1, 1, 0, "100.00");
    await availability(pLast, orgA, night2, 1, 0, "100.00");

    // No públicos: tienen cupo, pero no se pueden reservar.
    for (const productId of [pDraft, pArchived, pDeleted]) {
      await availability(productId, orgA, night1, 5, 0, "100.00");
      await availability(productId, orgA, night2, 5, 0, "100.00");
      await availability(productId, orgA, night3, 5, 0, "100.00");
    }

    await availability(pPolicy, orgA, night1, 5, 0, "110.00");
    await availability(pPolicy, orgA, night2, 5, 0, "110.00");

    await availability(pHold, orgHold, night1, 5, 0, "100.00");
    await availability(pHold, orgHold, night2, 5, 0, "100.00");

    await availability(pFail, orgFail, night1, 5, 0, "100.00");
    await availability(pFail, orgFail, night2, 5, 0, "100.00");

    await createAuditFailureTrigger();
  });

  beforeEach(async () => {
    // El trigger de fallo de auditoría no se dispara para orgA/orgHold, pero se
    // recrea por si una corrida anterior se interrumpió.
    await owner.query(`DELETE FROM "bookings" WHERE "tenant_id" = ANY($1::text[])`, [
      [orgA, orgHold, orgFail],
    ]);
    await owner.query(`DELETE FROM "idempotency_keys" WHERE "user_id" = ANY($1::text[])`, [
      [clientA, clientB].filter((id) => id.length > 0),
    ]);
    for (const row of availabilityBaseline) {
      await owner.query(
        `UPDATE "availability" SET "reserved" = $1
          WHERE "product_id" = $2 AND "night" = $3::date`,
        [row.reserved, row.productId, row.night],
      );
    }
  });

  afterAll(async () => {
    if (owner) {
      await dropAuditFailureTrigger();
      const userIds = [clientA, clientB].filter((id) => id.length > 0);
      const tenantIds = [orgA, orgHold, orgFail];
      await owner.query(`DELETE FROM "bookings" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      if (userIds.length > 0) {
        await owner.query(`DELETE FROM "idempotency_keys" WHERE "user_id" = ANY($1::text[])`, [
          userIds,
        ]);
      }
      await owner.query(`DELETE FROM "availability" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "products" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(
        `DELETE FROM "cancellation_policies" WHERE "tenant_id" = ANY($1::text[])`,
        [tenantIds],
      );
      await owner.query(`DELETE FROM "tenant_settings" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "destinations" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "providers" WHERE "tenant_id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.query(`DELETE FROM "organization" WHERE "id" = ANY($1::text[])`, [
        tenantIds,
      ]);
      await owner.end();
    }
    await app?.close();
    await prisma.$disconnect();
  });

  interface BookingItemBody {
    productId: string;
    hotelKey: string;
    roomType: string;
    title: { es: string; en: string };
    checkIn: string;
    checkOut: string;
    quantity: number;
    nightlyPrices: Array<{ night: string; priceUsd: string }>;
    subtotalUsd: string;
  }

  interface BookingBody {
    id: string;
    code: string;
    status: string;
    expiresAt: string;
    totalUsd: string;
    items: BookingItemBody[];
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
    status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    basePrice: string;
    cancellationPolicyId: string | null;
    deletedAt?: Date | null;
  }): Promise<void> {
    await owner.query(
      `INSERT INTO "products"
         (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
          destination_id, status, base_price_usd, cancellation_policy_id, source, attributes,
          deleted_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'HOTEL', $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, 'OWN',
               $12::jsonb, $13, now(), now())`,
      [
        params.id,
        params.tenantId,
        params.providerId,
        params.hotelKey,
        params.roomType,
        JSON.stringify(titleA),
        JSON.stringify(descriptionA),
        params.destinationId,
        params.status,
        params.basePrice,
        params.cancellationPolicyId,
        attributes,
        params.deletedAt ?? null,
      ],
    );
  }

  async function availability(
    productId: string,
    tenantId: string,
    night: string,
    capacity: number,
    reserved: number,
    price: string,
  ): Promise<void> {
    await owner.query(
      `INSERT INTO "availability"
         (id, tenant_id, product_id, night, capacity, reserved, price_usd, created_at, updated_at)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, now(), now())`,
      [randomUUID(), tenantId, productId, night, capacity, reserved, price],
    );
    availabilityBaseline.push({ productId, night, reserved });
  }

  async function createAuditFailureTrigger(): Promise<void> {
    await dropAuditFailureTrigger();
    await owner.query(
      `CREATE FUNCTION "audit_logs_fail_test_fn"() RETURNS trigger AS $$
       BEGIN
         RAISE EXCEPTION 'fallo de auditoria simulado';
       END;
       $$ LANGUAGE plpgsql`,
    );
    await owner.query(
      `CREATE TRIGGER "audit_logs_fail_test"
         BEFORE INSERT ON "audit_logs"
         FOR EACH ROW
         WHEN (NEW."tenant_id" = '${orgFail}')
         EXECUTE FUNCTION "audit_logs_fail_test_fn"()`,
    );
  }

  async function dropAuditFailureTrigger(): Promise<void> {
    await owner.query(`DROP TRIGGER IF EXISTS "audit_logs_fail_test" ON "audit_logs"`);
    await owner.query(`DROP FUNCTION IF EXISTS "audit_logs_fail_test_fn"()`);
  }

  function url(path: string): string {
    return `${baseUrl}/api/v1${path}`;
  }

  function keyFor(): string {
    return randomUUID();
  }

  function traveler(overrides: Partial<Traveler> = {}): Traveler {
    return {
      fullName: "Ana Pérez",
      documentType: "V",
      documentNumber: "12345678",
      phone: "+584141234567",
      email: "ana@example.com",
      ...overrides,
    };
  }

  function bookingBody(overrides: Partial<CreateBookingBody> = {}): CreateBookingBody {
    return {
      productId: pStd,
      checkIn: night1,
      checkOut: night4,
      quantity: 1,
      travelers: [traveler()],
      ...overrides,
    };
  }

  async function postBooking(
    cookie: string | null,
    key: string | null,
    body: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      origin: authOrigin,
    };
    if (cookie) headers["cookie"] = cookie;
    if (key) headers["Idempotency-Key"] = key;
    return fetch(url("/bookings"), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
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

  async function reservedOf(productId: string): Promise<number[]> {
    const rows = await prisma.availability.findMany({
      where: { productId },
      orderBy: { night: "asc" },
      select: { reserved: true },
    });
    return rows.map((row) => row.reserved);
  }

  async function countBookings(tenantId: string): Promise<number> {
    return prisma.booking.count({ where: { tenantId } });
  }

  describe("Retención de cupo sin sobreventa", () => {
    it("retiene cupo en todas las noches y devuelve el detalle calculado en el servidor", async () => {
      const body = bookingBody({ quantity: 2 });
      const res = await postBooking(cookieA, keyFor(), body);
      expect(res.status).toBe(201);

      const created = await jsonOf<BookingBody>(res);
      expect(created).toMatchObject({
        status: "PENDING_PAYMENT",
        totalUsd: "620.00",
      });
      expect(created.code).toMatch(BOOKING_CODE_PATTERN);
      expect(created.expiresAt).toMatch(/Z$/);
      expect(created.items).toHaveLength(1);
      expect(created.items[0]).toMatchObject({
        productId: pStd,
        hotelKey: hotelKeyStd,
        roomType: "standard",
        title: titleA,
        checkIn: night1,
        checkOut: night4,
        quantity: 2,
        subtotalUsd: "620.00",
      });
      expect(created.items[0]?.nightlyPrices).toEqual([
        { night: night1, priceUsd: "100.00" },
        { night: night2, priceUsd: "120.00" },
        { night: night3, priceUsd: "90.00" },
      ]);

      const stored = await prisma.booking.findUnique({
        where: { id: created.id },
        include: { items: true },
      });
      expect(stored).toMatchObject({
        tenantId: orgA,
        userId: clientA,
        status: "PENDING_PAYMENT",
      });
      expect(stored?.totalUsd.toString()).toBe("620");
      expect(stored?.travelers).toEqual(body.travelers);
      expect(stored?.items[0]?.nightlyPrices).toEqual([
        { night: night1, price_usd: "100.00" },
        { night: night2, price_usd: "120.00" },
        { night: night3, price_usd: "90.00" },
      ]);
      expect(stored?.items[0]?.productTitle).toEqual(titleA);
      // La noche de salida no se ocupa: solo las tres noches del rango.
      await expect(reservedOf(pStd)).resolves.toEqual([5, 5, 5]);
    });

    it("rechaza la reserva si falta una noche y no toca ningún cupo", async () => {
      const before = await reservedOf(pMissing);
      const res = await postBooking(cookieA, keyFor(), bookingBody({ productId: pMissing }));
      await expectProblem(res, 409, "AVAILABILITY_UNAVAILABLE");

      await expect(reservedOf(pMissing)).resolves.toEqual(before);
      await expect(countBookings(orgA)).resolves.toBe(0);
    });

    it("rechaza la reserva sin cupo suficiente en una noche y no toca las demás", async () => {
      const before = await reservedOf(pFull);
      const res = await postBooking(
        cookieA,
        keyFor(),
        bookingBody({ productId: pFull, quantity: 2 }),
      );
      await expectProblem(res, 409, "AVAILABILITY_EXHAUSTED");

      await expect(reservedOf(pFull)).resolves.toEqual(before);
      await expect(countBookings(orgA)).resolves.toBe(0);
    });

    it("crea exactamente una reserva cuando dos clientes compiten por el último cupo", async () => {
      const body = bookingBody({ productId: pLast, checkIn: night1, checkOut: night3 });

      const [first, second] = await Promise.all([
        postBooking(cookieA, keyFor(), body),
        postBooking(cookieB, keyFor(), body),
      ]);

      expect([first.status, second.status].sort((a, b) => a - b)).toEqual([201, 409]);
      const failed = first.status === 409 ? first : second;
      await expectProblem(failed, 409, "AVAILABILITY_EXHAUSTED");

      await expect(reservedOf(pLast)).resolves.toEqual([1, 1]);
      await expect(countBookings(orgA)).resolves.toBe(1);
    });

    it("responde 401 a un visitante anónimo", async () => {
      const res = await postBooking(null, keyFor(), bookingBody());
      await expectProblem(res, 401, "UNAUTHENTICATED");
      await expect(countBookings(orgA)).resolves.toBe(0);
    });

    it("rechaza montos, tasas y campos calculados enviados por el cliente", async () => {
      const res = await postBooking(cookieA, keyFor(), {
        ...bookingBody(),
        tenant_id: orgA,
        user_id: clientA,
        code: "CRB-AAAAAAAA",
        total_usd: "1.00",
        price_usd: "1.00",
        exchange_rate: "1.0000",
      });
      const problem = await expectProblem(res, 422, "VALIDATION_ERROR");
      expect(problem.errors?.map((issue) => issue.path)).toEqual(
        expect.arrayContaining([
          "tenant_id",
          "user_id",
          "code",
          "total_usd",
          "price_usd",
          "exchange_rate",
        ]),
      );
      await expect(countBookings(orgA)).resolves.toBe(0);
    });

    it("rechaza un producto DRAFT, ARCHIVED, borrado lógico o inexistente con 409", async () => {
      for (const productId of [pDraft, pArchived, pDeleted, randomUUID()]) {
        const res = await postBooking(cookieA, keyFor(), bookingBody({ productId }));
        await expectProblem(res, 409, "PRODUCT_INACTIVE");
      }
      await expect(countBookings(orgA)).resolves.toBe(0);
    });

    it("rechaza quantity no positiva, fechas iguales, pasadas o de más de 30 noches", async () => {
      const cases: Array<[string, CreateBookingBody]> = [
        ["quantity 0", bookingBody({ quantity: 0 })],
        ["mismo día", bookingBody({ checkIn: night1, checkOut: night1 })],
        [
          "fecha pasada",
          bookingBody({ checkIn: addDays(today, -1), checkOut: addDays(today, 1) }),
        ],
        ["31 noches", bookingBody({ checkIn: night1, checkOut: addDays(night1, 31) })],
      ];

      for (const [label, body] of cases) {
        const res = await postBooking(cookieA, keyFor(), body);
        expect(res.status, label).toBe(422);
        const problem = await jsonOf<ProblemBody>(res);
        expect(problem.code, label).toBe("VALIDATION_ERROR");
      }
      await expect(countBookings(orgA)).resolves.toBe(0);
    });
  });

  describe("Retención de la reserva", () => {
    it("usa hold_minutes de la agencia cuando está configurado", async () => {
      const res = await postBooking(
        cookieA,
        keyFor(),
        bookingBody({ productId: pHold, checkIn: night1, checkOut: night3 }),
      );
      expect(res.status).toBe(201);
      const created = await jsonOf<BookingBody>(res);

      const stored = await prisma.booking.findUnique({ where: { id: created.id } });
      expect(stored).not.toBeNull();
      const heldMs = (stored?.expiresAt.getTime() ?? 0) - (stored?.createdAt.getTime() ?? 0);
      expect(heldMs).toBe(15 * 60_000);
    });

    it("usa 30 minutos cuando la agencia no configuró retención", async () => {
      const res = await postBooking(cookieA, keyFor(), bookingBody());
      expect(res.status).toBe(201);
      const created = await jsonOf<BookingBody>(res);

      const stored = await prisma.booking.findUnique({ where: { id: created.id } });
      expect(stored).not.toBeNull();
      const heldMs = (stored?.expiresAt.getTime() ?? 0) - (stored?.createdAt.getTime() ?? 0);
      expect(heldMs).toBe(30 * 60_000);
    });
  });

  describe("Idempotencia", () => {
    it("reintenta el mismo POST sin crear una segunda reserva", async () => {
      const key = keyFor();
      const body = bookingBody();

      const first = await postBooking(cookieA, key, body);
      expect(first.status).toBe(201);
      const firstBody = await jsonOf<BookingBody>(first);

      const second = await postBooking(cookieA, key, body);
      expect(second.status).toBe(201);
      await expect(jsonOf<BookingBody>(second)).resolves.toEqual(firstBody);

      await expect(countBookings(orgA)).resolves.toBe(1);
      await expect(
        prisma.auditLog.count({
          where: { action: "booking.create", entityId: firstBody.id },
        }),
      ).resolves.toBe(1);
    });

    it("exige el encabezado Idempotency-Key", async () => {
      const res = await postBooking(cookieA, null, bookingBody());
      await expectProblem(res, 400, "IDEMPOTENCY_KEY_REQUIRED");
      await expect(countBookings(orgA)).resolves.toBe(0);
    });

    it("rechaza la misma clave con otro cuerpo", async () => {
      const key = keyFor();
      const first = await postBooking(cookieA, key, bookingBody({ quantity: 1 }));
      expect(first.status).toBe(201);

      const second = await postBooking(cookieA, key, bookingBody({ quantity: 2 }));
      await expectProblem(second, 409, "IDEMPOTENCY_KEY_REUSED");
      await expect(countBookings(orgA)).resolves.toBe(1);
    });

    it("rechaza una clave que sigue en vuelo", async () => {
      const key = keyFor();
      const body = bookingBody();
      const hash = hashBookingRequest(createBookingSchema.parse(body));

      // now() + interval evita la conversion de zona horaria de `timestamp
      // without time zone`: un Date de node-postgres llega como hora local y
      // PostgreSQL ignora el desfase, dejando la clave vencida sin querer.
      await owner.query(
        `INSERT INTO "idempotency_keys"
           (id, user_id, endpoint, key, request_hash, response_status, response_body,
            expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, NULL, NULL, now() + interval '1 hour', now())`,
        [randomUUID(), clientA, BOOKINGS_CREATE_ENDPOINT, key, hash],
      );

      const res = await postBooking(cookieA, key, body);
      await expectProblem(res, 409, "IDEMPOTENCY_KEY_IN_PROGRESS");
      await expect(countBookings(orgA)).resolves.toBe(0);
    });

    it("procesa como nueva una clave expirada hace más de 24 horas", async () => {
      const key = keyFor();
      const body = bookingBody();
      const hash = hashBookingRequest(createBookingSchema.parse(body));

      await owner.query(
        `INSERT INTO "idempotency_keys"
           (id, user_id, endpoint, key, request_hash, response_status, response_body,
            expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 201, $6::jsonb, now() - interval '1 minute', now())`,
        [
          randomUUID(),
          clientA,
          BOOKINGS_CREATE_ENDPOINT,
          key,
          hash,
          JSON.stringify({ id: randomUUID(), code: "CRB-AAAAAAAA" }),
        ],
      );

      const res = await postBooking(cookieA, key, body);
      expect(res.status).toBe(201);
      const created = await jsonOf<BookingBody>(res);

      const storedKey = await prisma.idempotencyKey.findUnique({
        where: {
          userId_endpoint_key: { userId: clientA, endpoint: BOOKINGS_CREATE_ENDPOINT, key },
        },
      });
      expect(storedKey?.responseBody).toEqual({ id: created.id, code: created.code });
      expect(storedKey?.expiresAt.getTime() ?? 0).toBeGreaterThan(Date.now());
      await expect(countBookings(orgA)).resolves.toBe(1);
    });

    it("guarda solo id y código como respuesta idempotente", async () => {
      const key = keyFor();
      const res = await postBooking(cookieA, key, bookingBody());
      expect(res.status).toBe(201);
      const created = await jsonOf<BookingBody>(res);

      const stored = await prisma.idempotencyKey.findUnique({
        where: {
          userId_endpoint_key: { userId: clientA, endpoint: BOOKINGS_CREATE_ENDPOINT, key },
        },
      });
      expect(stored?.responseBody).toEqual({ id: created.id, code: created.code });
      const record = stored?.responseBody as Record<string, unknown>;
      expect(Object.keys(record).sort()).toEqual(["code", "id"]);
      const serialized = JSON.stringify(stored?.responseBody);
      expect(serialized).not.toContain("Ana Pérez");
      expect(serialized).not.toContain("12345678");
    });

    it("no duplica la auditoría al reintentar", async () => {
      const key = keyFor();
      const body = bookingBody();

      const first = await postBooking(cookieA, key, body);
      const created = await jsonOf<BookingBody>(first);
      const before = await prisma.auditLog.count({
        where: { action: "booking.create", entityId: created.id },
      });
      expect(before).toBe(1);

      const second = await postBooking(cookieA, key, body);
      expect(second.status).toBe(201);
      await expect(
        prisma.auditLog.count({
          where: { action: "booking.create", entityId: created.id },
        }),
      ).resolves.toBe(1);
    });
  });

  describe("Código de reserva", () => {
    it("genera códigos únicos con el formato CRB-XXXXXXXX", async () => {
      const first = await postBooking(cookieA, keyFor(), bookingBody());
      expect(first.status).toBe(201);
      const firstBody = await jsonOf<BookingBody>(first);

      const second = await postBooking(cookieA, keyFor(), bookingBody());
      expect(second.status).toBe(201);
      const secondBody = await jsonOf<BookingBody>(second);

      expect(firstBody.code).toMatch(/^CRB-[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(secondBody.code).toMatch(/^CRB-[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(firstBody.code).not.toBe(secondBody.code);
      await expect(prisma.booking.count({ where: { code: firstBody.code } })).resolves.toBe(1);
      await expect(prisma.booking.count({ where: { code: secondBody.code } })).resolves.toBe(1);
    });

    it("rechaza un código enviado por el cliente", async () => {
      const res = await postBooking(cookieA, keyFor(), {
        ...bookingBody(),
        code: "CRB-AAAAAAAA",
      });
      const problem = await expectProblem(res, 422, "VALIDATION_ERROR");
      expect(problem.errors?.map((issue) => issue.path)).toContain("code");
      await expect(countBookings(orgA)).resolves.toBe(0);
    });
  });

  describe("Datos del viajero", () => {
    it("rechaza una reserva sin viajeros o con la lista vacía", async () => {
      const withoutTravelers = {
        productId: pStd,
        checkIn: night1,
        checkOut: night4,
        quantity: 1,
      };
      const missing = await postBooking(cookieA, keyFor(), withoutTravelers);
      const missingProblem = await expectProblem(missing, 422, "VALIDATION_ERROR");
      expect(missingProblem.errors?.map((issue) => issue.path)).toContain("travelers");

      const empty = await postBooking(
        cookieA,
        keyFor(),
        bookingBody({ travelers: [] }),
      );
      const emptyProblem = await expectProblem(empty, 422, "VALIDATION_ERROR");
      expect(emptyProblem.errors?.map((issue) => issue.path)).toContain("travelers");

      await expect(countBookings(orgA)).resolves.toBe(0);
    });

    it("rechaza más de 9 viajeros", async () => {
      const travelers = Array.from({ length: 10 }, (_, index) =>
        traveler({ documentNumber: `DOC-${index}` }),
      );
      const res = await postBooking(cookieA, keyFor(), bookingBody({ travelers }));
      await expectProblem(res, 422, "VALIDATION_ERROR");
      await expect(countBookings(orgA)).resolves.toBe(0);
    });

    it("exige tipo y número de documento en cada viajero", async () => {
      const missingNumber = {
        ...traveler(),
        documentNumber: undefined,
      };
      const res = await postBooking(
        cookieA,
        keyFor(),
        bookingBody({ travelers: [missingNumber as unknown as Traveler] }),
      );
      const problem = await expectProblem(res, 422, "VALIDATION_ERROR");
      expect(problem.errors?.map((issue) => issue.path)).toContain(
        "travelers.0.documentNumber",
      );

      const missingType = { ...traveler(), documentType: undefined };
      const second = await postBooking(
        cookieA,
        keyFor(),
        bookingBody({ travelers: [missingType as unknown as Traveler] }),
      );
      const secondProblem = await expectProblem(second, 422, "VALIDATION_ERROR");
      expect(secondProblem.errors?.map((issue) => issue.path)).toContain(
        "travelers.0.documentType",
      );

      await expect(countBookings(orgA)).resolves.toBe(0);
    });
  });

  describe("Auditoría de reservas", () => {
    it("crear una reserva deja una fila con la agencia, el actor y el código", async () => {
      const res = await postBooking(cookieA, keyFor(), bookingBody());
      expect(res.status).toBe(201);
      const created = await jsonOf<BookingBody>(res);

      const rows = await prisma.auditLog.findMany({
        where: { action: "booking.create", entityId: created.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tenantId: orgA,
        actorId: clientA,
        entity: "booking",
        entityId: created.id,
        before: null,
      });
      expect(rows[0]?.after).toMatchObject({
        code: created.code,
        status: "PENDING_PAYMENT",
        totalUsd: "310.00",
        tenantId: orgA,
      });
    });

    it("no guarda nombres, documentos, teléfonos ni correos de los viajeros", async () => {
      const fullName = `Viajero ${suffix}`;
      const documentNumber = `DOC-${suffix}`;
      const phone = "+584149999999";
      const email = `traveler-${suffix}@example.com`;

      const res = await postBooking(
        cookieA,
        keyFor(),
        bookingBody({
          travelers: [{ fullName, documentType: "V", documentNumber, phone, email }],
        }),
      );
      expect(res.status).toBe(201);
      const created = await jsonOf<BookingBody>(res);

      const rows = await prisma.auditLog.findMany({
        where: { action: "booking.create", entityId: created.id },
      });
      expect(rows).toHaveLength(1);
      const serialized = JSON.stringify([rows[0]?.before, rows[0]?.after]);
      expect(serialized).not.toContain(fullName);
      expect(serialized).not.toContain(documentNumber);
      expect(serialized).not.toContain(phone);
      expect(serialized).not.toContain(email);
    });

    it("no confirma la reserva si falla la escritura de auditoría", async () => {
      const before = await reservedOf(pFail);
      const key = keyFor();

      const res = await postBooking(
        cookieA,
        key,
        bookingBody({ productId: pFail, checkIn: night1, checkOut: night3 }),
      );
      await expectProblem(res, 500, "INTERNAL_ERROR");

      await expect(countBookings(orgFail)).resolves.toBe(0);
      await expect(reservedOf(pFail)).resolves.toEqual(before);
      await expect(
        prisma.idempotencyKey.count({ where: { userId: clientA, key } }),
      ).resolves.toBe(0);
    });
  });

  describe("Política congelada", () => {
    it("guarda el snapshot de la política al crear la reserva", async () => {
      const res = await postBooking(
        cookieA,
        keyFor(),
        bookingBody({ productId: pPolicy, checkIn: night1, checkOut: night3 }),
      );
      expect(res.status).toBe(201);
      const created = await jsonOf<BookingBody>(res);

      const item = await prisma.bookingItem.findFirst({ where: { bookingId: created.id } });
      expect(item?.policySnapshot).toEqual({
        policyId: policyFlex,
        name: "Flexible",
        rules: flexibleRules,
      });
    });
  });
});
