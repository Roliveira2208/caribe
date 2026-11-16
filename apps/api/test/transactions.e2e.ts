import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * E2E de reservas, pagos, reembolsos, documentos, tasas e idempotencia
 * (T-F1-1c, design §2.3–2.7 y §3.1).
 *
 * Monta dos agencias con sus usuarios, catálogo, tasas, reservas, pagos,
 * reembolsos y documentos por SQL directo (el dueño no pasa por RLS) y luego
 * consulta como `caribe_app`, el rol real de la aplicación (NOBYPASSRLS, no
 * dueño). Así se prueban las políticas de los contextos `tenant`, `owner`,
 * `public` y `rates_global`, los CHECK, los únicos parciales, los triggers de
 * congelamiento, inmutabilidad y tope de reembolso, y la última defensa de
 * cupo: el CHECK de `availability` bajo concurrencia.
 */
describe("reservas, pagos y documentos (RLS y reglas de base)", () => {
  const suffix = randomUUID().slice(0, 8);
  let owner: Client;
  let app: Client;
  const extraClients: Client[] = [];

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const providerA = randomUUID();
  const providerB = randomUUID();
  const destinationA = randomUUID();
  const destinationB = randomUUID();
  const policyA = randomUUID();
  const policyB = randomUUID();
  const productA = randomUUID();
  const productB = randomUUID();
  const hotelKeyA = randomUUID();
  const hotelKeyB = randomUUID();
  const rateGlobal = randomUUID();
  const rateA = randomUUID();
  const rateB = randomUUID();
  const bookingA = randomUUID();
  const bookingA2 = randomUUID();
  const bookingB = randomUUID();
  const itemA = randomUUID();
  const itemA2 = randomUUID();
  const itemB = randomUUID();
  const paymentA = randomUUID();
  const paymentB = randomUUID();
  const refundB = randomUUID();
  const voucherA = randomUUID();
  const receiptB = randomUUID();
  const idemA = randomUUID();
  const idemB = randomUUID();
  const notificationA = randomUUID();
  const availabilityLock = randomUUID();

  const valueDate = rateDate();
  const referenceA = `REF-${suffix}`;
  const codeA = bookingCode();
  const codeA2 = bookingCode();
  const codeB = bookingCode();
  const idempotencyKeyA = `idem-a-${suffix}`;

  const traveler = JSON.stringify([
    { fullName: "Ana Pérez", documentType: "CI", documentNumber: "V-12345678" },
  ]);
  const nightlyPrices = JSON.stringify([
    { night: "2030-03-01", price_usd: "100.00" },
    { night: "2030-03-02", price_usd: "100.00" },
  ]);
  const title = JSON.stringify({ es: "Habitación estándar", en: "Standard room" });
  const policySnapshot = JSON.stringify([
    { hours_before: 72, percentage: 100 },
    { hours_before: 24, percentage: 50 },
  ]);
  const rules = JSON.stringify([
    { hours_before: 72, percentage: 100 },
    { hours_before: 24, percentage: 50 },
  ]);

  function rateDate(): string {
    const days = Number.parseInt(suffix.slice(0, 6), 16) % 10000;
    return new Date(Date.UTC(2100, 0, 1) + days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  function bookingCode(): string {
    return `CRB-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  }

  beforeAll(async () => {
    owner = new Client({ connectionString: process.env.DATABASE_URL });
    await owner.connect();

    await owner.query(
      `INSERT INTO "organization" (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, now()), ($4, $5, $6, now())`,
      [
        orgA,
        `Reservas A ${suffix}`,
        `reservas-a-${suffix}`,
        orgB,
        `Reservas B ${suffix}`,
        `reservas-b-${suffix}`,
      ],
    );

    await owner.query(
      `INSERT INTO "user" (id, name, email, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now()), ($4, $5, $6, now(), now())`,
      [
        userA,
        `Cliente A ${suffix}`,
        `cliente-a-${suffix}@example.com`,
        userB,
        `Cliente B ${suffix}`,
        `cliente-b-${suffix}@example.com`,
      ],
    );

    await owner.query(
      `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now()), ($4, $5, $6, now(), now())`,
      [providerA, orgA, `Proveedor A ${suffix}`, providerB, orgB, `Proveedor B ${suffix}`],
    );

    await owner.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now()),
              ($5, $6, $7::jsonb, 'VE', $8, now(), now())`,
      [
        destinationA,
        orgA,
        JSON.stringify({ es: "Mérida", en: "Merida" }),
        `mer-${suffix}`,
        destinationB,
        orgB,
        JSON.stringify({ es: "Margarita", en: "Margarita" }),
        `pmv-${suffix}`,
      ],
    );

    await owner.query(
      `INSERT INTO "cancellation_policies" (id, tenant_id, name, rules, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now(), now()), ($5, $6, $7, $4::jsonb, now(), now())`,
      [policyA, orgA, `Flexible A ${suffix}`, rules, policyB, orgB, `Flexible B ${suffix}`],
    );

    const product = async (
      id: string,
      tenantId: string,
      providerId: string,
      destinationId: string,
      hotelKey: string,
      policyId: string,
    ): Promise<void> => {
      await owner.query(
        `INSERT INTO "products"
           (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
            destination_id, status, base_price_usd, cancellation_policy_id, source, attributes,
            created_at, updated_at)
         VALUES ($1, $2, $3, 'HOTEL', $4, 'standard', $5::jsonb, '{}'::jsonb, $6, 'PUBLISHED',
                 100.00, $7, 'OWN', $8::jsonb, now(), now())`,
        [
          id,
          tenantId,
          providerId,
          hotelKey,
          title,
          destinationId,
          policyId,
          JSON.stringify({
            stars: 4,
            maxGuests: 2,
            amenities: ["wifi"],
            images: ["https://images.caribe.test/hotel.jpg"],
          }),
        ],
      );
    };

    await product(productA, orgA, providerA, destinationA, hotelKeyA, policyA);
    await product(productB, orgB, providerB, destinationB, hotelKeyB, policyB);

    await owner.query(
      `INSERT INTO "exchange_rates"
         (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
       VALUES ($1, NULL, 'COTIZAVE', 900.0000, $2::date, now(), false, NULL, NULL),
              ($3, $4, 'MANUAL', 950.0000, $2::date, now(), true, 'Ajuste de prueba', $5),
              ($6, $7, 'MANUAL', 970.0000, $2::date, now(), true, 'Ajuste de prueba', $8)`,
      [rateGlobal, valueDate, rateA, orgA, userA, rateB, orgB, userB],
    );

    const booking = async (
      id: string,
      tenantId: string,
      code: string,
      userId: string,
      total: string,
    ): Promise<void> => {
      await owner.query(
        `INSERT INTO "bookings"
           (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
         VALUES ($1, $2, $3, $4, 'CONFIRMED', $5, $6::jsonb,
                 now() + interval '30 minutes', now())`,
        [id, tenantId, code, userId, total, traveler],
      );
    };

    await booking(bookingA, orgA, codeA, userA, "200.00");
    await booking(bookingA2, orgA, codeA2, userA, "100.00");
    await booking(bookingB, orgB, codeB, userB, "150.00");

    const item = async (
      id: string,
      bookingId: string,
      tenantId: string,
      productId: string,
      hotelKey: string,
      checkIn: string,
      checkOut: string,
      subtotal: string,
    ): Promise<void> => {
      await owner.query(
        `INSERT INTO "booking_items"
           (id, booking_id, tenant_id, product_id, hotel_key, room_type, check_in, check_out,
            quantity, nightly_prices, subtotal_usd, product_title, policy_snapshot)
         VALUES ($1, $2, $3, $4, $5, 'standard', $6::date, $7::date,
                 1, $8::jsonb, $9, $10::jsonb, $11::jsonb)`,
        [
          id,
          bookingId,
          tenantId,
          productId,
          hotelKey,
          checkIn,
          checkOut,
          nightlyPrices,
          subtotal,
          title,
          policySnapshot,
        ],
      );
    };

    await item(itemA, bookingA, orgA, productA, hotelKeyA, "2030-03-01", "2030-03-03", "200.00");
    await item(itemA2, bookingA2, orgA, productA, hotelKeyA, "2030-03-05", "2030-03-07", "100.00");
    await item(itemB, bookingB, orgB, productB, hotelKeyB, "2030-03-01", "2030-03-03", "150.00");

    await owner.query(
      `INSERT INTO "payments"
         (id, tenant_id, booking_id, method, amount_usd, amount_ves, exchange_rate_id, rate,
          value_date, reference, status, reported_by, paid_at, created_at)
       VALUES ($1, $2, $3, 'PAGO_MOVIL', 200.00, 190000.00, $4, 950.0000, $5::date, $6,
               'APPROVED', $7, now(), now()),
              ($8, $9, $10, 'ZELLE', 150.00, 145500.00, $11, 970.0000, $5::date, $12,
               'APPROVED', $13, now(), now())`,
      [
        paymentA,
        orgA,
        bookingA,
        rateA,
        valueDate,
        referenceA,
        userA,
        paymentB,
        orgB,
        bookingB,
        rateB,
        `ZEL-${suffix}`,
        userB,
      ],
    );

    await owner.query(
      `INSERT INTO "refunds"
         (id, tenant_id, payment_id, booking_id, amount_usd, amount_ves, exchange_rate_id,
          rate, value_date, reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, 75.00, 72750.00, $5, 970.0000, $6::date,
               'Cancelación parcial', $7, now())`,
      [refundB, orgB, paymentB, bookingB, rateB, valueDate, userB],
    );

    const document = async (
      id: string,
      tenantId: string,
      bookingId: string,
      paymentId: string | null,
      type: string,
      number: number,
    ): Promise<void> => {
      await owner.query(
        `INSERT INTO "documents"
           (id, tenant_id, booking_id, payment_id, type, number, file_url, language, status,
            issued_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'es', 'READY', now(), now())`,
        [
          id,
          tenantId,
          bookingId,
          paymentId,
          type,
          number,
          `documents/${randomUUID()}.pdf`,
        ],
      );
    };

    await document(voucherA, orgA, bookingA, null, "VOUCHER", 1);
    await document(receiptB, orgB, bookingB, paymentB, "RECEIPT", 1);

    await owner.query(
      `INSERT INTO "idempotency_keys"
         (id, user_id, endpoint, key, request_hash, response_status, response_body,
          expires_at, created_at)
       VALUES ($1, $2, '/bookings', $3, 'hash-a', 201, $4::jsonb,
               now() + interval '24 hours', now()),
              ($5, $6, '/bookings', $7, 'hash-b', 201, $4::jsonb,
               now() + interval '24 hours', now())`,
      [
        idemA,
        userA,
        idempotencyKeyA,
        JSON.stringify({ id: bookingA, code: codeA }),
        idemB,
        userB,
        `idem-b-${suffix}`,
      ],
    );

    await owner.query(
      `INSERT INTO "notification_logs"
         (id, tenant_id, dedupe_key, template, recipient, locale, status, attempts,
          created_at, sent_at)
       VALUES ($1, $2, $3, 'booking-confirmed', $4, 'es', 'SENT', 1, now(), now())`,
      [notificationA, orgA, `booking-confirmed:${bookingA}`, `cliente-a-${suffix}@example.com`],
    );

    await owner.query(
      `INSERT INTO "availability"
         (id, tenant_id, product_id, night, capacity, reserved, price_usd, created_at, updated_at)
       VALUES ($1, $2, $3, '2030-04-01'::date, 1, 0, 100.00, now(), now())`,
      [availabilityLock, orgA, productA],
    );

    app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    await app.query("SET ROLE caribe_app");
  });

  afterAll(async () => {
    for (const client of extraClients) {
      await client.end().catch(() => undefined);
    }
    await app?.end();
    if (owner) {
      const tenants = [orgA, orgB];
      const users = [userA, userB];
      // Limpieza en orden de dependencia: documentos -> reembolsos -> pagos ->
      // líneas -> reservas; después catálogo, tasas y usuarios. El trigger
      // `refunds_append_only` bloquea DELETE para cualquier rol (también el
      // dueño), así que solo para la limpieza del test se desactiva y se
      // vuelve a activar al terminar.
      await owner.query(`ALTER TABLE "refunds" DISABLE TRIGGER "refunds_append_only"`);
      try {
        await owner.query(`DELETE FROM "documents" WHERE "tenant_id" = ANY($1::text[])`, [tenants]);
        await owner.query(`DELETE FROM "refunds" WHERE "tenant_id" = ANY($1::text[])`, [tenants]);
      } finally {
        await owner.query(`ALTER TABLE "refunds" ENABLE TRIGGER "refunds_append_only"`);
      }
      await owner.query(`DELETE FROM "payments" WHERE "tenant_id" = ANY($1::text[])`, [tenants]);
      await owner.query(`DELETE FROM "booking_items" WHERE "tenant_id" = ANY($1::text[])`, [tenants]);
      await owner.query(`DELETE FROM "bookings" WHERE "tenant_id" = ANY($1::text[])`, [tenants]);
      await owner.query(`DELETE FROM "notification_logs" WHERE "tenant_id" = ANY($1::text[])`, [
        tenants,
      ]);
      await owner.query(`DELETE FROM "idempotency_keys" WHERE "user_id" = ANY($1::text[])`, [users]);
      await owner.query(
        `DELETE FROM "exchange_rates" WHERE "tenant_id" = ANY($1::text[]) OR "value_date" = $2::date`,
        [tenants, valueDate],
      );
      await owner.query(`DELETE FROM "availability" WHERE "tenant_id" = ANY($1::text[])`, [tenants]);
      await owner.query(`DELETE FROM "products" WHERE "tenant_id" = ANY($1::text[])`, [tenants]);
      await owner.query(`DELETE FROM "cancellation_policies" WHERE "tenant_id" = ANY($1::text[])`, [
        tenants,
      ]);
      await owner.query(`DELETE FROM "providers" WHERE "tenant_id" = ANY($1::text[])`, [tenants]);
      await owner.query(`DELETE FROM "destinations" WHERE "tenant_id" = ANY($1::text[])`, [tenants]);
      await owner.query(`DELETE FROM "organization" WHERE "id" = ANY($1::text[])`, [tenants]);
      await owner.query(`DELETE FROM "user" WHERE "id" = ANY($1::text[])`, [users]);
      await owner.end();
    }
  });

  interface Guc {
    tenantId?: string;
    userId?: string;
    public?: boolean;
    platform?: boolean;
    ratesGlobal?: boolean;
  }

  async function asApp<T>(guc: Guc | undefined, fn: (c: Client) => Promise<T>): Promise<T> {
    await app.query("BEGIN");
    try {
      if (guc?.tenantId) {
        await app.query("SELECT set_config('app.tenant_id', $1, true)", [guc.tenantId]);
      }
      if (guc?.userId) {
        await app.query("SELECT set_config('app.user_id', $1, true)", [guc.userId]);
      }
      if (guc?.public) {
        await app.query("SELECT set_config('app.public', 'on', true)");
      }
      if (guc?.platform) {
        await app.query("SELECT set_config('app.platform', 'on', true)");
      }
      if (guc?.ratesGlobal) {
        await app.query("SELECT set_config('app.rates_global', 'on', true)");
      }
      return await fn(app);
    } finally {
      await app.query("ROLLBACK");
    }
  }

  async function ids(c: Client, table: string): Promise<string[]> {
    const { rows } = await c.query<{ id: string }>(`SELECT id FROM "${table}" ORDER BY id`);
    return rows.map((row) => row.id);
  }

  async function count(c: Client, table: string): Promise<number> {
    const { rows } = await c.query<{ count: number }>(`SELECT count(*)::int AS count FROM "${table}"`);
    return rows[0]?.count ?? 0;
  }

  // Las corridas anteriores o los archivos de test en paralelo pueden dejar
  // tasas ajenas a esta suite; se comparan solo las filas creadas aquí.
  const suiteRateIds: string[] = [rateGlobal, rateA, rateB];
  function suiteRates(visible: string[]): string[] {
    return visible.filter((id) => suiteRateIds.includes(id)).sort();
  }

  describe("contextos RLS", () => {
    it("sin contexto no se lee ninguna tabla de negocio", async () => {
      for (const table of [
        "bookings",
        "booking_items",
        "idempotency_keys",
        "exchange_rates",
        "payments",
        "refunds",
        "documents",
        "document_counters",
        "notification_logs",
      ]) {
        expect(await asApp(undefined, (c) => count(c, table))).toBe(0);
      }
    });

    it("sin contexto no se escribe una reserva", async () => {
      await expect(
        asApp(undefined, (c) =>
          c.query(
            `INSERT INTO "bookings"
               (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
             VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', 100.00, $5::jsonb,
                     now() + interval '30 minutes', now())`,
            [randomUUID(), orgA, bookingCode(), userA, traveler],
          ),
        ),
      ).rejects.toThrow();
    });

    it("el dueño A solo ve sus reservas, pagos, líneas y documentos", async () => {
      const guc = { userId: userA };
      expect((await asApp(guc, (c) => ids(c, "bookings"))).sort()).toEqual(
        [bookingA, bookingA2].sort(),
      );
      expect((await asApp(guc, (c) => ids(c, "booking_items"))).sort()).toEqual(
        [itemA, itemA2].sort(),
      );
      expect(await asApp(guc, (c) => ids(c, "payments"))).toEqual([paymentA]);
      expect(await asApp(guc, (c) => ids(c, "documents"))).toEqual([voucherA]);
      expect(await asApp(guc, (c) => ids(c, "refunds"))).toEqual([]);
      expect(await asApp(guc, (c) => ids(c, "notification_logs"))).toEqual([]);
    });

    it("el dueño B solo ve sus reservas, pagos, líneas, reembolsos y documentos", async () => {
      const guc = { userId: userB };
      expect(await asApp(guc, (c) => ids(c, "bookings"))).toEqual([bookingB]);
      expect(await asApp(guc, (c) => ids(c, "booking_items"))).toEqual([itemB]);
      expect(await asApp(guc, (c) => ids(c, "payments"))).toEqual([paymentB]);
      expect(await asApp(guc, (c) => ids(c, "refunds"))).toEqual([refundB]);
      expect(await asApp(guc, (c) => ids(c, "documents"))).toEqual([receiptB]);
    });

    it("la agencia A ve sus reservas y no las de B", async () => {
      const guc = { tenantId: orgA };
      expect((await asApp(guc, (c) => ids(c, "bookings"))).sort()).toEqual(
        [bookingA, bookingA2].sort(),
      );
      expect((await asApp(guc, (c) => ids(c, "booking_items"))).sort()).toEqual(
        [itemA, itemA2].sort(),
      );
      expect(await asApp(guc, (c) => ids(c, "payments"))).toEqual([paymentA]);
      expect(await asApp(guc, (c) => ids(c, "documents"))).toEqual([voucherA]);
      expect(await asApp(guc, (c) => ids(c, "refunds"))).toEqual([]);
      expect(await asApp(guc, (c) => ids(c, "notification_logs"))).toEqual([notificationA]);
    });

    it("la agencia B ve sus reservas y no las de A", async () => {
      const guc = { tenantId: orgB };
      expect(await asApp(guc, (c) => ids(c, "bookings"))).toEqual([bookingB]);
      expect(await asApp(guc, (c) => ids(c, "booking_items"))).toEqual([itemB]);
      expect(await asApp(guc, (c) => ids(c, "payments"))).toEqual([paymentB]);
      expect(await asApp(guc, (c) => ids(c, "documents"))).toEqual([receiptB]);
      expect(await asApp(guc, (c) => ids(c, "refunds"))).toEqual([refundB]);
      expect(await asApp(guc, (c) => ids(c, "notification_logs"))).toEqual([]);
    });

    it("el contexto público no ve reservas y solo lee tasas globales", async () => {
      const guc = { public: true };
      for (const table of [
        "bookings",
        "booking_items",
        "payments",
        "refunds",
        "documents",
        "idempotency_keys",
        "notification_logs",
      ]) {
        expect(await asApp(guc, (c) => ids(c, table))).toEqual([]);
      }
      expect(suiteRates(await asApp(guc, (c) => ids(c, "exchange_rates")))).toEqual([rateGlobal]);
    });

    it("la agencia lee las tasas globales y su override, nunca el de otra", async () => {
      expect(suiteRates(await asApp({ tenantId: orgA }, (c) => ids(c, "exchange_rates")))).toEqual(
        [rateGlobal, rateA].sort(),
      );
      expect(suiteRates(await asApp({ tenantId: orgB }, (c) => ids(c, "exchange_rates")))).toEqual(
        [rateGlobal, rateB].sort(),
      );
    });

    it("el dueño no puede insertar una reserva ni una línea de otra persona", async () => {
      await expect(
        asApp({ userId: userA }, (c) =>
          c.query(
            `INSERT INTO "bookings"
               (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
             VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', 100.00, $5::jsonb,
                     now() + interval '30 minutes', now())`,
            [randomUUID(), orgB, bookingCode(), userB, traveler],
          ),
        ),
      ).rejects.toThrow();

      await expect(
        asApp({ userId: userA }, (c) =>
          c.query(
            `INSERT INTO "booking_items"
               (id, booking_id, tenant_id, product_id, hotel_key, room_type, check_in, check_out,
                quantity, nightly_prices, subtotal_usd, product_title, policy_snapshot)
             VALUES ($1, $2, $3, $4, $5, 'standard', '2030-03-01', '2030-03-03',
                     1, $6::jsonb, 100.00, $7::jsonb, $8::jsonb)`,
            [randomUUID(), bookingB, orgB, productB, hotelKeyB, nightlyPrices, title, policySnapshot],
          ),
        ),
      ).rejects.toThrow();
    });

    it("las claves de idempotencia no cruzan usuarios", async () => {
      expect(await asApp({ userId: userA }, (c) => ids(c, "idempotency_keys"))).toEqual([idemA]);
      expect(await asApp({ userId: userB }, (c) => ids(c, "idempotency_keys"))).toEqual([idemB]);
      await expect(
        asApp({ userId: userA }, (c) =>
          c.query(
            `INSERT INTO "idempotency_keys"
               (id, user_id, endpoint, key, request_hash, response_status, response_body,
                expires_at, created_at)
             VALUES ($1, $2, '/bookings', $3, 'hash', 201, '{}'::jsonb,
                     now() + interval '24 hours', now())`,
            [randomUUID(), userB, `idem-c-${suffix}`],
          ),
        ),
      ).rejects.toThrow();
    });

    it("rates_global solo escribe filas globales y no lee otras tablas", async () => {
      const guc = { ratesGlobal: true };
      expect(await asApp(guc, (c) => ids(c, "bookings"))).toEqual([]);
      expect(await asApp(guc, (c) => ids(c, "payments"))).toEqual([]);
      expect(await asApp(guc, (c) => ids(c, "products"))).toEqual([]);
      expect(suiteRates(await asApp(guc, (c) => ids(c, "exchange_rates")))).toEqual([rateGlobal]);

      await expect(
        asApp(guc, (c) =>
          c.query(
            `INSERT INTO "exchange_rates"
               (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
             VALUES ($1, $2, 'MANUAL', 980.0000, $3::date, now(), true, 'Intento', $4)`,
            [randomUUID(), orgA, valueDate, userA],
          ),
        ),
      ).rejects.toThrow();

      const updated = await asApp(guc, (c) =>
        c.query(`UPDATE "exchange_rates" SET "rate" = 1.0000 WHERE "id" = $1`, [rateA]),
      );
      expect(updated.rowCount).toBe(0);

      await expect(
        asApp(guc, (c) =>
          c.query(
            `INSERT INTO "exchange_rates"
               (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
             VALUES ($1, NULL, 'COTIZAVE', 910.0000, $2::date, now(), false, NULL, NULL)`,
            [randomUUID(), nextRateDate(valueDate)],
          ),
        ),
      ).resolves.toBeDefined();
    });

    it("el contexto público no puede escribir reservas", async () => {
      await expect(
        asApp({ public: true }, (c) =>
          c.query(
            `INSERT INTO "bookings"
               (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
             VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', 100.00, $5::jsonb,
                     now() + interval '30 minutes', now())`,
            [randomUUID(), orgA, bookingCode(), userA, traveler],
          ),
        ),
      ).rejects.toThrow();
    });

    it("el contexto de plataforma lee todo y solo escribe filas globales de tasas", async () => {
      const guc = { platform: true };
      expect(await asApp(guc, (c) => ids(c, "exchange_rates"))).toEqual(
        expect.arrayContaining([rateGlobal, rateA, rateB]),
      );

      // El contexto de plataforma (Super Admin sin agencia) puede escribir el
      // override global de la tasa, pero nunca filas de una agencia ni
      // catálogo. Las filas insertadas se deshacen con el ROLLBACK de asApp.
      const platformRate = randomUUID();
      const platformDate = nextRateDate(nextRateDate(valueDate));
      await asApp(guc, async (c) => {
        await c.query(
          `INSERT INTO "exchange_rates"
             (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
           VALUES ($1, NULL, 'COTIZAVE', 910.0000, $2::date, now(), false, NULL, NULL)`,
          [platformRate, platformDate],
        );

        const updated = await c.query(
          `UPDATE "exchange_rates" SET "rate" = 915.0000 WHERE "id" = $1`,
          [platformRate],
        );
        expect(updated.rowCount).toBe(1);

        const agencyRow = await c.query(
          `UPDATE "exchange_rates" SET "rate" = 1.0000 WHERE "id" = $1`,
          [rateA],
        );
        expect(agencyRow.rowCount).toBe(0);
      });

      await expect(
        asApp(guc, (c) =>
          c.query(
            `INSERT INTO "exchange_rates"
               (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
             VALUES ($1, $2, 'MANUAL', 980.0000, $3::date, now(), true, 'Intento', $4)`,
            [randomUUID(), orgA, nextRateDate(platformDate), userA],
          ),
        ),
      ).rejects.toThrow();

      await expect(
        asApp(guc, (c) =>
          c.query(
            `INSERT INTO "destinations"
               (id, tenant_id, name, country, code, created_at, updated_at)
             VALUES ($1, $2, '{"es":"Plataforma","en":"Platform"}'::jsonb, 'VE', $3, now(), now())`,
            [randomUUID(), orgA, `plat-${suffix}`],
          ),
        ),
      ).rejects.toThrow();
    });
  });

  describe("reglas de base", () => {
    it("valida el código de reserva y los viajeros", async () => {
      const insert = (code: string, travelers: string): Promise<unknown> =>
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "bookings"
               (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
             VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', 100.00, $5::jsonb,
                     now() + interval '30 minutes', now())`,
            [randomUUID(), orgA, code, userA, travelers],
          ),
        );

      await expect(insert("ABC-123", traveler)).rejects.toThrow();
      await expect(insert(bookingCode(), "[]")).rejects.toThrow();
      await expect(
        insert(bookingCode(), JSON.stringify(Array.from({ length: 10 }, () => JSON.parse(traveler)[0]))),
      ).rejects.toThrow();
      await expect(insert(bookingCode(), traveler)).resolves.toBeDefined();
    });

    it("rechaza cantidad no positiva, fechas invertidas y estancias de más de 30 noches", async () => {
      const insert = (quantity: number, checkIn: string, checkOut: string): Promise<unknown> =>
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "booking_items"
               (id, booking_id, tenant_id, product_id, hotel_key, room_type, check_in, check_out,
                quantity, nightly_prices, subtotal_usd, product_title, policy_snapshot)
             VALUES ($1, $2, $3, $4, $5, 'standard', $6::date, $7::date,
                     $8, $9::jsonb, 100.00, $10::jsonb, $11::jsonb)`,
            [
              randomUUID(),
              bookingA,
              orgA,
              productA,
              hotelKeyA,
              checkIn,
              checkOut,
              quantity,
              nightlyPrices,
              title,
              policySnapshot,
            ],
          ),
        );

      await expect(insert(0, "2030-03-01", "2030-03-03")).rejects.toThrow();
      await expect(insert(1, "2030-03-03", "2030-03-03")).rejects.toThrow();
      await expect(insert(1, "2030-03-03", "2030-03-01")).rejects.toThrow();
      await expect(insert(1, "2030-03-01", "2030-04-02")).rejects.toThrow();
      await expect(insert(1, "2030-03-01", "2030-03-03")).resolves.toBeDefined();
    });

    it("congela los precios y datos de la línea al reservar", async () => {
      const update = (column: string, value: string): Promise<unknown> =>
        asApp({ tenantId: orgA }, (c) =>
          c.query(`UPDATE "booking_items" SET "${column}" = $1 WHERE "id" = $2`, [value, itemA]),
        );

      await expect(update("subtotal_usd", "1.00")).rejects.toThrow();
      await expect(update("nightly_prices", "[]")).rejects.toThrow();
      await expect(update("product_title", "{}")).rejects.toThrow();
      await expect(update("policy_snapshot", "[]")).rejects.toThrow();
      await expect(update("hotel_key", randomUUID())).rejects.toThrow();
      await expect(update("room_type", "suite")).rejects.toThrow();
      await expect(update("quantity", "2")).rejects.toThrow();
      await expect(update("check_out", "2030-03-04")).rejects.toThrow();
    });

    it("congela la identidad de la reserva y permite cambiar el estado", async () => {
      const update = (column: string, value: string): Promise<unknown> =>
        asApp({ tenantId: orgA }, (c) =>
          c.query(`UPDATE "bookings" SET "${column}" = $1 WHERE "id" = $2`, [value, bookingA]),
        );

      await expect(update("code", bookingCode())).rejects.toThrow();
      await expect(update("user_id", userB)).rejects.toThrow();
      await expect(update("travelers", "[]")).rejects.toThrow();
      await expect(update("total_usd", "1.00")).rejects.toThrow();
      await expect(update("status", "CANCELLED")).resolves.toBeDefined();
    });

    it("congela el par de tasa y montos del pago y permite cambiar el estado", async () => {
      const update = (column: string, value: string): Promise<unknown> =>
        asApp({ tenantId: orgA }, (c) =>
          c.query(`UPDATE "payments" SET "${column}" = $1 WHERE "id" = $2`, [value, paymentA]),
        );

      await expect(update("amount_usd", "1.00")).rejects.toThrow();
      await expect(update("amount_ves", "1.00")).rejects.toThrow();
      await expect(update("rate", "1.0000")).rejects.toThrow();
      await expect(update("value_date", "2030-01-01")).rejects.toThrow();
      await expect(update("exchange_rate_id", randomUUID())).rejects.toThrow();
      await expect(update("status", "REFUNDED")).resolves.toBeDefined();
    });

    it("exige que pago, tasa y línea pertenezcan a la agencia y al dueño de la reserva", async () => {
      const insert = (tenantId: string, rateId: string, reportedBy: string): Promise<unknown> =>
        asApp({ tenantId }, (c) =>
          c.query(
            `INSERT INTO "payments"
               (id, tenant_id, booking_id, method, amount_usd, amount_ves, exchange_rate_id, rate,
                value_date, reference, status, reported_by, created_at)
             VALUES ($1, $2, $3, 'PAGO_MOVIL', 200.00, 190000.00, $4, 950.0000, $5::date, $6,
                     'PENDING', $7, now())`,
            [randomUUID(), tenantId, bookingA, rateId, valueDate, `COH-${suffix}`, reportedBy],
          ),
        );

      await expect(insert(orgA, rateB, userA)).rejects.toThrow();
      await expect(insert(orgA, rateA, userB)).rejects.toThrow();
      await expect(insert(orgA, rateA, userA)).resolves.toBeDefined();

      await expect(
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "booking_items"
               (id, booking_id, tenant_id, product_id, hotel_key, room_type, check_in, check_out,
                quantity, nightly_prices, subtotal_usd, product_title, policy_snapshot)
             VALUES ($1, $2, $3, $4, $5, 'standard', '2030-03-01', '2030-03-03',
                     1, $6::jsonb, 100.00, $7::jsonb, $8::jsonb)`,
            [randomUUID(), bookingB, orgA, productA, hotelKeyA, nightlyPrices, title, policySnapshot],
          ),
        ),
      ).rejects.toThrow();
    });

    it("rechaza referencias de pago duplicadas por agencia y método", async () => {
      const insert = (tenantId: string, bookingId: string, reportedBy: string, rateId: string): Promise<unknown> =>
        asApp({ tenantId }, (c) =>
          c.query(
            `INSERT INTO "payments"
               (id, tenant_id, booking_id, method, amount_usd, amount_ves, exchange_rate_id, rate,
                value_date, reference, status, reported_by, created_at)
             VALUES ($1, $2, $3, 'PAGO_MOVIL', 150.00, 145500.00, $4, 970.0000, $5::date, $6,
                     'PENDING', $7, now())`,
            [randomUUID(), tenantId, bookingId, rateId, valueDate, referenceA, reportedBy],
          ),
        );

      await expect(insert(orgA, bookingA, userA, rateA)).rejects.toThrow();
      await expect(insert(orgB, bookingB, userB, rateB)).resolves.toBeDefined();
    });

    it("hace append-only los reembolsos y limita la suma al monto del pago", async () => {
      const insert = (amount: string): Promise<unknown> =>
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "refunds"
               (id, tenant_id, payment_id, booking_id, amount_usd, amount_ves, exchange_rate_id,
                rate, value_date, reason, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 950.0000, $8::date, 'Cancelación', $9, now())`,
            [
              randomUUID(),
              orgA,
              paymentA,
              bookingA,
              amount,
              amount === "100.00" ? "95000.00" : "237500.00",
              rateA,
              valueDate,
              userA,
            ],
          ),
        );

      await expect(insert("250.00")).rejects.toThrow();
      await expect(insert("100.00")).resolves.toBeDefined();

      await expect(
        asApp({ tenantId: orgA }, async (c) => {
          const id = randomUUID();
          await c.query(
            `INSERT INTO "refunds"
               (id, tenant_id, payment_id, booking_id, amount_usd, amount_ves, exchange_rate_id,
                rate, value_date, reason, created_by, created_at)
             VALUES ($1, $2, $3, $4, 50.00, 47500.00, $5, 950.0000, $6::date,
                     'Cancelación', $7, now())`,
            [id, orgA, paymentA, bookingA, rateA, valueDate, userA],
          );
          await c.query(`UPDATE "refunds" SET "reason" = 'Cambio' WHERE "id" = $1`, [id]);
        }),
      ).rejects.toThrow();

      await expect(
        asApp({ tenantId: orgA }, async (c) => {
          const id = randomUUID();
          await c.query(
            `INSERT INTO "refunds"
               (id, tenant_id, payment_id, booking_id, amount_usd, amount_ves, exchange_rate_id,
                rate, value_date, reason, created_by, created_at)
             VALUES ($1, $2, $3, $4, 50.00, 47500.00, $5, 950.0000, $6::date,
                     'Cancelación', $7, now())`,
            [id, orgA, paymentA, bookingA, rateA, valueDate, userA],
          );
          await c.query(`DELETE FROM "refunds" WHERE "id" = $1`, [id]);
        }),
      ).rejects.toThrow();
    });

    it("no permite un segundo reembolso sobre el mismo pago", async () => {
      await expect(
        asApp({ tenantId: orgB }, (c) =>
          c.query(
            `INSERT INTO "refunds"
               (id, tenant_id, payment_id, booking_id, amount_usd, amount_ves, exchange_rate_id,
                rate, value_date, reason, created_by, created_at)
             VALUES ($1, $2, $3, $4, 10.00, 9700.00, $5, 970.0000, $6::date,
                     'Otro', $7, now())`,
            [randomUUID(), orgB, paymentB, bookingB, rateB, valueDate, userB],
          ),
        ),
      ).rejects.toThrow();
    });

    it("impone un único voucher por reserva, un comprobante por pago y número por agencia y tipo", async () => {
      const document = (bookingId: string, paymentId: string | null, type: string, number: number): Promise<unknown> =>
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "documents"
               (id, tenant_id, booking_id, payment_id, type, number, language, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'es', 'PENDING', now())`,
            [randomUUID(), orgA, bookingId, paymentId, type, number],
          ),
        );

      await expect(document(bookingA, null, "VOUCHER", 2)).rejects.toThrow();
      await expect(document(bookingA2, null, "VOUCHER", 1)).rejects.toThrow();
      await expect(document(bookingA2, null, "VOUCHER", 2)).resolves.toBeDefined();
      await expect(document(bookingA, null, "RECEIPT", 5)).rejects.toThrow();

      await expect(
        asApp({ tenantId: orgB }, (c) =>
          c.query(
            `INSERT INTO "documents"
               (id, tenant_id, booking_id, payment_id, type, number, language, status, created_at)
             VALUES ($1, $2, $3, $4, 'RECEIPT', 2, 'es', 'PENDING', now())`,
            [randomUUID(), orgB, bookingB, paymentB],
          ),
        ),
      ).rejects.toThrow();
    });

    it("congela la identidad del documento y permite cambiar su estado", async () => {
      const update = (column: string, value: string): Promise<unknown> =>
        asApp({ tenantId: orgA }, (c) =>
          c.query(`UPDATE "documents" SET "${column}" = $1 WHERE "id" = $2`, [value, voucherA]),
        );

      await expect(update("number", "9")).rejects.toThrow();
      await expect(update("type", "RECEIPT")).rejects.toThrow();
      await expect(update("language", "en")).rejects.toThrow();
      await expect(update("status", "FAILED")).resolves.toBeDefined();
    });

    it("deduplica avisos y valida sus intentos", async () => {
      await expect(
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "notification_logs"
               (id, tenant_id, dedupe_key, template, recipient, locale, status, attempts, created_at)
             VALUES ($1, $2, $3, 'booking-confirmed', 'x@example.com', 'es', 'PENDING', 0, now())`,
            [randomUUID(), orgA, `booking-confirmed:${bookingA}`],
          ),
        ),
      ).rejects.toThrow();

      await expect(
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "notification_logs"
               (id, tenant_id, dedupe_key, template, recipient, locale, status, attempts, created_at)
             VALUES ($1, $2, $3, 'booking-confirmed', 'x@example.com', 'es', 'PENDING', -1, now())`,
            [randomUUID(), orgA, `booking-confirmed:${randomUUID()}`],
          ),
        ),
      ).rejects.toThrow();
    });

    it("valida la longitud de la clave de idempotencia y su unicidad por usuario y endpoint", async () => {
      const insert = (userId: string, key: string): Promise<unknown> =>
        asApp({ userId }, (c) =>
          c.query(
            `INSERT INTO "idempotency_keys"
               (id, user_id, endpoint, key, request_hash, response_status, response_body,
                expires_at, created_at)
             VALUES ($1, $2, '/bookings', $3, 'hash', 201, '{}'::jsonb,
                     now() + interval '24 hours', now())`,
            [randomUUID(), userId, key],
          ),
        );

      await expect(insert(userA, "short")).rejects.toThrow();
      await expect(insert(userA, idempotencyKeyA)).rejects.toThrow();
      await expect(insert(userB, idempotencyKeyA)).resolves.toBeDefined();
    });

    it("valida la tasa, el motivo del override y el único global por fecha", async () => {
      const insert = (id: string, tenantId: string | null, rate: string, isOverride: boolean, reason: string | null): Promise<unknown> =>
        asApp(tenantId ? { tenantId } : { ratesGlobal: true }, (c) =>
          c.query(
            `INSERT INTO "exchange_rates"
               (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
             VALUES ($1, $2, 'MANUAL', $3, $4::date, now(), $5, $6, NULL)`,
            [id, tenantId, rate, valueDate, isOverride, reason],
          ),
        );

      await expect(insert(randomUUID(), orgA, "0.0000", true, "Motivo")).rejects.toThrow();
      await expect(insert(randomUUID(), orgA, "900.0000", true, null)).rejects.toThrow();
      await expect(
        insert(randomUUID(), null, "900.0000", false, null),
      ).rejects.toThrow();
    });

    it("dos transacciones no sobrevenden el último cupo", async () => {
      const c1 = new Client({ connectionString: process.env.DATABASE_URL });
      const c2 = new Client({ connectionString: process.env.DATABASE_URL });
      extraClients.push(c1, c2);
      await c1.connect();
      await c2.connect();
      await c1.query("SET ROLE caribe_app");
      await c2.query("SET ROLE caribe_app");

      await c1.query("BEGIN");
      await c1.query("SELECT set_config('app.tenant_id', $1, true)", [orgA]);
      await c1.query(`SELECT id FROM "availability" WHERE id = $1 FOR UPDATE`, [availabilityLock]);
      await c1.query(`UPDATE "availability" SET "reserved" = "reserved" + 1 WHERE id = $1`, [
        availabilityLock,
      ]);

      await c2.query("BEGIN");
      await c2.query("SELECT set_config('app.tenant_id', $1, true)", [orgA]);
      const blocked = c2.query(`SELECT id FROM "availability" WHERE id = $1 FOR UPDATE`, [
        availabilityLock,
      ]);

      await c1.query("COMMIT");
      await blocked;
      await expect(
        c2.query(`UPDATE "availability" SET "reserved" = "reserved" + 1 WHERE id = $1`, [
          availabilityLock,
        ]),
      ).rejects.toThrow();
      await c2.query("ROLLBACK");
    });
  });
});

function nextRateDate(valueDate: string): string {
  const date = new Date(`${valueDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
