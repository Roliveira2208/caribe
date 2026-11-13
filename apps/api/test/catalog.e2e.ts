import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * E2E del catálogo y la disponibilidad (T-F1-1b).
 *
 * Monta dos agencias con proveedores, destinos, políticas, productos y
 * disponibilidad por SQL directo (el dueño no pasa por RLS) y luego consulta
 * como `caribe_app`, el rol real de la aplicación (NOBYPASSRLS, no dueño).
 * Así se prueban las políticas de los contextos `public` y `tenant`, los
 * CHECK, el único por noche, los triggers de coherencia y la función pública
 * que oculta `capacity` y `reserved`.
 */
describe("catálogo y disponibilidad (RLS y reglas de base)", () => {
  const suffix = randomUUID().slice(0, 8);
  let owner: Client;
  let app: Client;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const providerA = randomUUID();
  const providerB = randomUUID();
  const destinationA = randomUUID();
  const destinationDraftOnly = randomUUID();
  const destinationB = randomUUID();
  const policyA = randomUUID();
  const policyB = randomUUID();
  const publishedA = randomUUID();
  const draftA = randomUUID();
  const archivedA = randomUUID();
  const deletedA = randomUUID();
  const publishedB = randomUUID();
  const hotelKeyA = randomUUID();
  const hotelKeyB = randomUUID();

  const attrs = JSON.stringify({
    stars: 4,
    maxGuests: 2,
    amenities: ["wifi"],
    images: ["https://images.caribe.test/hotel.jpg"],
  });

  beforeAll(async () => {
    owner = new Client({ connectionString: process.env.DATABASE_URL });
    await owner.connect();

    await owner.query(
      `INSERT INTO "organization" (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, now()), ($4, $5, $6, now())`,
      [orgA, `Catálogo A ${suffix}`, `catalogo-a-${suffix}`, orgB, `Catálogo B ${suffix}`, `catalogo-b-${suffix}`],
    );

    await owner.query(
      `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now()), ($4, $5, $6, now(), now())`,
      [providerA, orgA, `Proveedor A ${suffix}`, providerB, orgB, `Proveedor B ${suffix}`],
    );

    await owner.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now()),
              ($5, $2, $6::jsonb, 'VE', $7, now(), now()),
              ($8, $9, $10::jsonb, 'VE', $11, now(), now())`,
      [
        destinationA,
        orgA,
        JSON.stringify({ es: "Mérida", en: "Merida" }),
        `mer-${suffix}`,
        destinationDraftOnly,
        JSON.stringify({ es: "Canaima", en: "Canaima" }),
        `can-${suffix}`,
        destinationB,
        orgB,
        JSON.stringify({ es: "Margarita", en: "Margarita" }),
        `pmv-${suffix}`,
      ],
    );

    const rules = JSON.stringify([
      { hours_before: 72, percentage: 100 },
      { hours_before: 24, percentage: 50 },
    ]);
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
      status: string,
      hotelKey: string,
      roomType: string,
      deletedAt: Date | null,
    ): Promise<void> => {
      await owner.query(
        `INSERT INTO "products"
           (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
            destination_id, status, base_price_usd, cancellation_policy_id, source, attributes,
            deleted_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'HOTEL', $4, $5, $6::jsonb, $7::jsonb, $8, $9, 100.00, $10, 'OWN',
                 $11::jsonb, $12, now(), now())`,
        [
          id,
          tenantId,
          providerId,
          hotelKey,
          roomType,
          JSON.stringify({ es: `Hotel ${suffix}`, en: `Hotel ${suffix}` }),
          JSON.stringify({ es: `Habitación ${roomType}`, en: `${roomType} room` }),
          destinationId,
          status,
          tenantId === orgA ? policyA : policyB,
          attrs,
          deletedAt,
        ],
      );
    };

    await product(publishedA, orgA, providerA, destinationA, "PUBLISHED", hotelKeyA, "standard", null);
    await product(draftA, orgA, providerA, destinationDraftOnly, "DRAFT", hotelKeyA, "suite", null);
    await product(archivedA, orgA, providerA, destinationA, "ARCHIVED", hotelKeyA, "family", null);
    await product(deletedA, orgA, providerA, destinationA, "PUBLISHED", hotelKeyA, "deluxe", new Date());
    await product(publishedB, orgB, providerB, destinationB, "PUBLISHED", hotelKeyB, "standard", null);

    const availability = async (
      productId: string,
      tenantId: string,
      night: string,
      capacity: number,
      reserved: number,
      price: string,
    ): Promise<void> => {
      await owner.query(
        `INSERT INTO "availability"
           (id, tenant_id, product_id, night, capacity, reserved, price_usd, created_at, updated_at)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7, now(), now())`,
        [randomUUID(), tenantId, productId, night, capacity, reserved, price],
      );
    };

    await availability(publishedA, orgA, "2026-12-01", 5, 2, "100.00");
    await availability(publishedA, orgA, "2026-12-02", 5, 0, "120.00");
    await availability(draftA, orgA, "2026-12-01", 5, 0, "90.00");
    await availability(publishedB, orgB, "2026-12-01", 3, 1, "150.00");

    app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    await app.query("SET ROLE caribe_app");
  });

  afterAll(async () => {
    await app?.end();
    if (owner) {
      // Limpieza en orden de dependencia: las FK de producto a proveedor y
      // destino son RESTRICT, así que no basta con borrar la agencia.
      await owner.query(`DELETE FROM "availability" WHERE "tenant_id" = ANY($1::text[])`, [
        [orgA, orgB],
      ]);
      await owner.query(`DELETE FROM "products" WHERE "tenant_id" = ANY($1::text[])`, [
        [orgA, orgB],
      ]);
      await owner.query(`DELETE FROM "cancellation_policies" WHERE "tenant_id" = ANY($1::text[])`, [
        [orgA, orgB],
      ]);
      await owner.query(`DELETE FROM "providers" WHERE "tenant_id" = ANY($1::text[])`, [
        [orgA, orgB],
      ]);
      await owner.query(`DELETE FROM "destinations" WHERE "tenant_id" = ANY($1::text[])`, [
        [orgA, orgB],
      ]);
      await owner.query(`DELETE FROM "organization" WHERE "id" = ANY($1::text[])`, [
        [orgA, orgB],
      ]);
      await owner.end();
    }
  });

  async function asApp<T>(
    guc: { tenantId?: string; public?: boolean } | undefined,
    fn: (c: Client) => Promise<T>,
  ): Promise<T> {
    await app.query("BEGIN");
    try {
      if (guc?.tenantId) {
        await app.query("SELECT set_config('app.tenant_id', $1, true)", [guc.tenantId]);
      }
      if (guc?.public) {
        await app.query("SELECT set_config('app.public', 'on', true)");
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

  describe("contexto public", () => {
    it("solo ve productos publicados y sin borrado lógico de todas las agencias", async () => {
      const visible = await asApp({ public: true }, (c) => ids(c, "products"));
      expect(visible).toEqual(expect.arrayContaining([publishedA, publishedB]));
      expect(visible).not.toContain(draftA);
      expect(visible).not.toContain(archivedA);
      expect(visible).not.toContain(deletedA);
    });

    it("no ve proveedores ni políticas de cancelación", async () => {
      const providers = await asApp({ public: true }, (c) => ids(c, "providers"));
      const policies = await asApp({ public: true }, (c) => ids(c, "cancellation_policies"));
      expect(providers).toEqual([]);
      expect(policies).toEqual([]);
    });

    it("solo ve los destinos referenciados por productos publicados", async () => {
      const visible = await asApp({ public: true }, (c) => ids(c, "destinations"));
      expect(visible).toEqual(expect.arrayContaining([destinationA, destinationB]));
      expect(visible).not.toContain(destinationDraftOnly);
    });

    it("no puede escribir catálogo", async () => {
      await expect(
        asApp({ public: true }, (c) =>
          c.query(
            `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
             VALUES ($1, $2, '{}'::jsonb, 'VE', $3, now(), now())`,
            [randomUUID(), orgA, `evil-${suffix}`],
          ),
        ),
      ).rejects.toThrow();
    });

    it("la función pública devuelve solo night, remaining y price_usd", async () => {
      const rows = await asApp({ public: true }, async (c) => {
        const result = await c.query<{
          night: string;
          remaining: number;
          price_usd: string;
        }>(
          `SELECT night::text AS night, remaining, price_usd::text AS price_usd
             FROM public_availability($1, $2::date, $3::date)
            ORDER BY night`,
          [publishedA, "2026-12-01", "2026-12-03"],
        );
        return result.rows;
      });
      expect(rows).toEqual([
        { night: "2026-12-01", remaining: 3, price_usd: "100.00" },
        { night: "2026-12-02", remaining: 5, price_usd: "120.00" },
      ]);
    });

    it("la función pública no devuelve noches de productos no publicados", async () => {
      const rows = await asApp({ public: true }, async (c) => {
        const result = await c.query(
          `SELECT * FROM public_availability($1, $2::date, $3::date)`,
          [draftA, "2026-12-01", "2026-12-02"],
        );
        return result.rows;
      });
      expect(rows).toEqual([]);
    });
  });

  describe("contexto tenant", () => {
    it("la agencia A ve todo su catálogo y nada del de B", async () => {
      const products = await asApp({ tenantId: orgA }, (c) => ids(c, "products"));
      expect(products.sort()).toEqual([publishedA, draftA, archivedA, deletedA].sort());
      expect(products).not.toContain(publishedB);

      const providers = await asApp({ tenantId: orgA }, (c) => ids(c, "providers"));
      expect(providers).toEqual([providerA]);

      const destinations = await asApp({ tenantId: orgA }, (c) => ids(c, "destinations"));
      expect(destinations.sort()).toEqual([destinationA, destinationDraftOnly].sort());

      const policies = await asApp({ tenantId: orgA }, (c) => ids(c, "cancellation_policies"));
      expect(policies).toEqual([policyA]);
    });

    it("no puede insertar filas de otra agencia", async () => {
      await expect(
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
             VALUES ($1, $2, 'Forjado', now(), now())`,
            [randomUUID(), orgB],
          ),
        ),
      ).rejects.toThrow();
    });

    it("puede crear su propio catálogo", async () => {
      await asApp({ tenantId: orgA }, async (c) => {
        const provider = randomUUID();
        const destination = randomUUID();
        const product = randomUUID();
        await c.query(
          `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
           VALUES ($1, $2, 'Proveedor propio', now(), now())`,
          [provider, orgA],
        );
        await c.query(
          `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
           VALUES ($1, $2, '{}'::jsonb, 'VE', $3, now(), now())`,
          [destination, orgA, `own-${suffix}`],
        );
        await c.query(
          `INSERT INTO "products"
             (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
              destination_id, status, base_price_usd, cancellation_policy_id, source, attributes,
              created_at, updated_at)
           VALUES ($1, $2, $3, 'HOTEL', $4, 'standard', '{}'::jsonb, '{}'::jsonb, $5, 'DRAFT',
                   80.00, $6, 'OWN', $7::jsonb, now(), now())`,
          [product, orgA, provider, randomUUID(), destination, policyA, attrs],
        );
        await c.query(
          `INSERT INTO "availability"
             (id, tenant_id, product_id, night, capacity, reserved, price_usd, created_at, updated_at)
           VALUES ($1, $2, $3, '2026-12-10'::date, 2, 0, 80.00, now(), now())`,
          [randomUUID(), orgA, product],
        );
        expect(await ids(c, "products")).toContain(product);
      });
    });

    it("no puede referenciar proveedor o producto de otra agencia", async () => {
      await expect(
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "products"
               (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
                destination_id, status, base_price_usd, source, attributes, created_at, updated_at)
             VALUES ($1, $2, $3, 'HOTEL', $4, 'standard', '{}'::jsonb, '{}'::jsonb, $5, 'DRAFT',
                     80.00, 'OWN', $6::jsonb, now(), now())`,
            [randomUUID(), orgA, providerB, randomUUID(), destinationA, attrs],
          ),
        ),
      ).rejects.toThrow();

      await expect(
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "availability"
               (id, tenant_id, product_id, night, capacity, reserved, price_usd, created_at, updated_at)
             VALUES ($1, $2, $3, '2026-12-20'::date, 2, 0, 80.00, now(), now())`,
            [randomUUID(), orgA, publishedB],
          ),
        ),
      ).rejects.toThrow();
    });
  });

  describe("reglas de base", () => {
    it("rechaza precio no positivo, capacidad no positiva y reserved fuera de rango", async () => {
      const insert = (capacity: number, reserved: number, price: string): Promise<unknown> =>
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "availability"
               (id, tenant_id, product_id, night, capacity, reserved, price_usd, created_at, updated_at)
             VALUES ($1, $2, $3, '2026-12-11'::date, $4, $5, $6, now(), now())`,
            [randomUUID(), orgA, publishedA, capacity, reserved, price],
          ),
        );
      await expect(insert(5, 0, "0.00")).rejects.toThrow();
      await expect(insert(0, 0, "10.00")).rejects.toThrow();
      await expect(insert(2, 3, "10.00")).rejects.toThrow();
      await expect(insert(2, -1, "10.00")).rejects.toThrow();
    });

    it("rechaza dos filas para el mismo producto y noche", async () => {
      await expect(
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "availability"
               (id, tenant_id, product_id, night, capacity, reserved, price_usd, created_at, updated_at)
             VALUES ($1, $2, $3, '2026-12-01'::date, 1, 0, 10.00, now(), now())`,
            [randomUUID(), orgA, publishedA],
          ),
        ),
      ).rejects.toThrow();
    });

    it("rechaza room_type con formato inválido", async () => {
      await expect(
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "products"
               (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
                destination_id, status, base_price_usd, source, attributes, created_at, updated_at)
             VALUES ($1, $2, $3, 'HOTEL', $4, 'Standard Room', '{}'::jsonb, '{}'::jsonb, $5, 'DRAFT',
                     80.00, 'OWN', $6::jsonb, now(), now())`,
            [randomUUID(), orgA, providerA, randomUUID(), destinationA, attrs],
          ),
        ),
      ).rejects.toThrow();
    });

    it("valida las reglas de cancelación con el trigger", async () => {
      const insert = (rules: string): Promise<unknown> =>
        asApp({ tenantId: orgA }, (c) =>
          c.query(
            `INSERT INTO "cancellation_policies" (id, tenant_id, name, rules, created_at, updated_at)
             VALUES ($1, $2, 'Política', $3::jsonb, now(), now())`,
            [randomUUID(), orgA, rules],
          ),
        );
      await expect(
        insert(
          JSON.stringify([
            { hours_before: 72, percentage: 100 },
            { hours_before: 24, percentage: 50 },
          ]),
        ),
      ).resolves.toBeDefined();
      await expect(insert(JSON.stringify([]))).rejects.toThrow();
      await expect(
        insert(
          JSON.stringify([
            { hours_before: 24, percentage: 50 },
            { hours_before: 24, percentage: 25 },
          ]),
        ),
      ).rejects.toThrow();
      await expect(insert(JSON.stringify([{ hours_before: 24, percentage: 101 }]))).rejects.toThrow();
      await expect(insert(JSON.stringify([{ hours_before: -1, percentage: 10 }]))).rejects.toThrow();
    });
  });
});
