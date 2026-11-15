import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { todayInCaracas } from "@caribe/shared";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { addDays } from "../src/catalog/catalog.schemas.js";
import { prisma } from "../src/prisma.js";

/**
 * E2E del catálogo público (T-F1-3, delta de catalog "Búsqueda y filtros" y
 * "Detalle y disponibilidad públicos").
 *
 * Monta dos agencias con productos publicados, borradores, archivados y
 * borrados lógicos por SQL directo (el dueño no pasa por RLS) y consulta la
 * API por HTTP sin sesión. Los ids y fechas son dinámicos para no depender del
 * orden de los tests ni de la fecha de la corrida; las búsquedas se acotan a
 * destinos propios para no mezclar filas de otras suites que comparten la BD.
 */
describe("catalog", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let owner: Client;

  const suffix = randomUUID().slice(0, 8);

  const orgA = randomUUID();
  const orgB = randomUUID();
  const providerA = randomUUID();
  const providerB = randomUUID();
  const destA = randomUUID();
  const destB = randomUUID();
  const destNoEn = randomUUID();
  const hotelKeyA = randomUUID();
  const hotelKeyB = randomUUID();
  const hotelKeyNoEn = randomUUID();

  const aStd = randomUUID();
  const aSuite = randomUUID();
  const aFull = randomUUID();
  const aPagination = randomUUID();
  const aDraft = randomUUID();
  const aArchived = randomUUID();
  const aDeleted = randomUUID();
  const aNoEn = randomUUID();
  const bStd = randomUUID();

  const today = todayInCaracas();
  const night1 = addDays(today, 10);
  const night2 = addDays(today, 11);
  const night3 = addDays(today, 12);
  const checkIn = night1;
  const checkOut = addDays(today, 13);

  const titleA = { es: "Hotel Sol", en: "Sun Hotel" };
  const titleB = { es: "Hotel Luna", en: "Moon Hotel" };
  const titleNoEn = { es: "Hotel Sin Inglés" };
  const imageA = "https://images.caribe.test/hotel-sol.jpg";
  const codeA = `mer-${suffix}`;
  const codeB = `pmv-${suffix}`;
  const codeNoEn = `noe-${suffix}`;

  beforeAll(async () => {
    // El catálogo usa la tasa global. En este archivo el proveedor debe fallar
    // para controlar la tasa desde la base: se apunta a un puerto muerto antes
    // de crear la aplicación (el proveedor lee DOLARAPI_URL al construirse).
    process.env.DOLARAPI_URL = "http://127.0.0.1:9/dolar";

    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    owner = new Client({ connectionString: process.env.DATABASE_URL });
    await owner.connect();

    // Estado de partida determinista: sin tasa global vigente, el catálogo
    // solo muestra USD. Las filas referenciadas por pagos o reembolsos no se
    // tocan (FK), aunque en F1 todavía no existen.
    await deleteUnreferencedGlobalRates();

    await owner.query(
      `INSERT INTO "organization" (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, now()), ($4, $5, $6, now())`,
      [
        orgA,
        `Catálogo API A ${suffix}`,
        `catalogo-api-a-${suffix}`,
        orgB,
        `Catálogo API B ${suffix}`,
        `catalogo-api-b-${suffix}`,
      ],
    );

    await owner.query(
      `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now()), ($4, $5, $6, now(), now())`,
      [
        providerA,
        orgA,
        `Proveedor API A ${suffix}`,
        providerB,
        orgB,
        `Proveedor API B ${suffix}`,
      ],
    );

    await owner.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now()),
              ($5, $6, $7::jsonb, 'VE', $8, now(), now()),
              ($9, $2, $10::jsonb, 'VE', $11, now(), now())`,
      [
        destA,
        orgA,
        JSON.stringify({ es: "Mérida", en: "Merida" }),
        codeA,
        destB,
        orgB,
        JSON.stringify({ es: "Margarita", en: "Margarita" }),
        codeB,
        destNoEn,
        JSON.stringify(titleNoEn),
        codeNoEn,
      ],
    );

    const attributes = (maxGuests: number, images: string[] = []): string =>
      JSON.stringify({ stars: 4, maxGuests, amenities: ["wifi", "pool"], images });

    const product = async (params: {
      id: string;
      tenantId: string;
      providerId: string;
      destinationId: string;
      hotelKey: string;
      roomType: string;
      status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
      basePrice: string;
      title: unknown;
      description: unknown;
      attributes: string;
      deletedAt?: Date | null;
    }): Promise<void> => {
      await owner.query(
        `INSERT INTO "products"
           (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
            destination_id, status, base_price_usd, cancellation_policy_id, source, attributes,
            deleted_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'HOTEL', $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, NULL, 'OWN',
                 $11::jsonb, $12, now(), now())`,
        [
          params.id,
          params.tenantId,
          params.providerId,
          params.hotelKey,
          params.roomType,
          JSON.stringify(params.title),
          JSON.stringify(params.description),
          params.destinationId,
          params.status,
          params.basePrice,
          params.attributes,
          params.deletedAt ?? null,
        ],
      );
    };

    await product({
      id: aStd,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: hotelKeyA,
      roomType: "standard",
      status: "PUBLISHED",
      basePrice: "100.00",
      title: titleA,
      description: { es: "Habitación standard", en: "standard room" },
      attributes: attributes(2, [imageA]),
    });
    await product({
      id: aSuite,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: hotelKeyA,
      roomType: "suite",
      status: "PUBLISHED",
      basePrice: "150.00",
      title: titleA,
      description: { es: "Suite", en: "Suite" },
      attributes: attributes(4),
    });
    await product({
      id: aFull,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: hotelKeyA,
      roomType: "family",
      status: "PUBLISHED",
      basePrice: "120.00",
      title: titleA,
      description: { es: "Familiar", en: "Family" },
      attributes: attributes(2),
    });
    await product({
      id: aPagination,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: hotelKeyA,
      roomType: "twin",
      status: "PUBLISHED",
      basePrice: "110.00",
      title: titleA,
      description: { es: "Doble", en: "Twin" },
      attributes: attributes(2),
    });
    await product({
      id: aDraft,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: hotelKeyA,
      roomType: "single",
      status: "DRAFT",
      basePrice: "50.00",
      title: titleA,
      description: { es: "Individual", en: "Single" },
      attributes: attributes(2),
    });
    await product({
      id: aArchived,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: hotelKeyA,
      roomType: "triple",
      status: "ARCHIVED",
      basePrice: "60.00",
      title: titleA,
      description: { es: "Triple", en: "Triple" },
      attributes: attributes(2),
    });
    await product({
      id: aDeleted,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destA,
      hotelKey: hotelKeyA,
      roomType: "deluxe",
      status: "PUBLISHED",
      basePrice: "70.00",
      title: titleA,
      description: { es: "Deluxe", en: "Deluxe" },
      attributes: attributes(2),
      deletedAt: new Date(),
    });
    await product({
      id: bStd,
      tenantId: orgB,
      providerId: providerB,
      destinationId: destB,
      hotelKey: hotelKeyB,
      roomType: "standard",
      status: "PUBLISHED",
      basePrice: "80.00",
      title: titleB,
      description: { es: "Habitación standard", en: "standard room" },
      attributes: attributes(2),
    });
    await product({
      id: aNoEn,
      tenantId: orgA,
      providerId: providerA,
      destinationId: destNoEn,
      hotelKey: hotelKeyNoEn,
      roomType: "standard",
      status: "PUBLISHED",
      basePrice: "90.00",
      title: titleNoEn,
      description: { es: "Habitación sin inglés" },
      attributes: attributes(2),
    });

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

    // aStd: tres noches con precios distintos y cupo para una habitación.
    await availability(aStd, orgA, night1, 5, 1, "100.00");
    await availability(aStd, orgA, night2, 5, 1, "120.00");
    await availability(aStd, orgA, night3, 5, 1, "90.00");

    // aSuite: falta la última noche del rango.
    await availability(aSuite, orgA, night1, 5, 0, "150.00");
    await availability(aSuite, orgA, night2, 5, 0, "150.00");

    // aFull: una noche sin cupo (5 de 5 reservadas).
    await availability(aFull, orgA, night1, 5, 1, "120.00");
    await availability(aFull, orgA, night2, 5, 5, "120.00");
    await availability(aFull, orgA, night3, 5, 1, "120.00");

    // Borrador, archivado y borrado: tienen cupo, pero no son públicos.
    for (const productId of [aDraft, aArchived, aDeleted]) {
      await availability(productId, orgA, night1, 5, 0, "100.00");
      await availability(productId, orgA, night2, 5, 0, "100.00");
      await availability(productId, orgA, night3, 5, 0, "100.00");
    }

    await availability(bStd, orgB, night1, 3, 1, "80.00");
    await availability(bStd, orgB, night2, 3, 1, "80.00");
    await availability(bStd, orgB, night3, 3, 1, "80.00");
  });

  /**
   * Borra las tasas globales no referenciadas por pagos o reembolsos. La BD es
   * compartida entre archivos e2e; este archivo controla la tasa global para
   * probar "sin tasa" y "equivalente en VES" de forma determinista.
   */
  async function deleteUnreferencedGlobalRates(): Promise<void> {
    await owner.query(`
      DELETE FROM "exchange_rates" er
      WHERE er."tenant_id" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "payments" p WHERE p."exchange_rate_id" = er."id"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "refunds" r WHERE r."exchange_rate_id" = er."id"
        )
    `);
  }

  afterAll(async () => {
    if (owner) {
      // Deja la tasa global como la encontró: la BD es compartida entre
      // archivos e2e y el seed espera crear la suya si no hay fila.
      await deleteUnreferencedGlobalRates();
      await owner.query(`DELETE FROM "availability" WHERE "tenant_id" = ANY($1::text[])`, [
        [orgA, orgB],
      ]);
      await owner.query(`DELETE FROM "products" WHERE "tenant_id" = ANY($1::text[])`, [
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
    await app?.close();
    await prisma.$disconnect();
  });

  interface OfferBody {
    id: string;
    hotelKey: string;
    roomType: string;
    type: string;
    title: { es: string; en: string };
    description: { es: string; en: string };
    destination: { id: string; name: { es: string; en: string }; country: string; code: string };
    attributes: { stars: number; maxGuests: number; amenities: string[]; images: string[] };
    basePriceUsd: string;
    basePriceVes: string | null;
    totalUsd: string | null;
    totalVes: string | null;
  }

  interface PageBody {
    items: OfferBody[];
    nextCursor: string | null;
  }

  interface AvailabilityBody {
    productId: string;
    from: string;
    to: string;
    nights: Array<{ night: string; remaining: number; priceUsd: string; priceVes: string | null }>;
  }

  interface ProblemBody {
    code: string;
    status: number;
  }

  function url(path: string): string {
    return `${baseUrl}/api/v1${path}`;
  }

  async function getJson<T>(path: string): Promise<{ status: number; body: T }> {
    const res = await fetch(url(path));
    return { status: res.status, body: (await res.json()) as T };
  }

  describe("Búsqueda y filtros", () => {
    it("filtra por destino, fechas y personas y devuelve el total de una habitación", async () => {
      const { status, body } = await getJson<PageBody>(
        `/products?destinationId=${destA}&checkIn=${checkIn}&checkOut=${checkOut}&guests=2`,
      );
      expect(status).toBe(200);
      expect(body.items.map((item) => item.id)).toEqual([aStd]);
      expect(body.nextCursor).toBeNull();
      expect(body.items[0]).toMatchObject({
        roomType: "standard",
        hotelKey: hotelKeyA,
        basePriceUsd: "100.00",
        totalUsd: "310.00",
      });
    });

    it("excluye el producto al que le falta una noche o no tiene cupo", async () => {
      const { status, body } = await getJson<PageBody>(
        `/products?destinationId=${destA}&checkIn=${checkIn}&checkOut=${checkOut}`,
      );
      expect(status).toBe(200);
      const ids = body.items.map((item) => item.id);
      expect(ids).toEqual([aStd]);
      expect(ids).not.toContain(aSuite);
      expect(ids).not.toContain(aFull);
      expect(ids).not.toContain(aPagination);
    });

    it("excluye los tipos con menos ocupación que las personas pedidas", async () => {
      const { status, body } = await getJson<PageBody>(
        `/products?destinationId=${destA}&guests=3`,
      );
      expect(status).toBe(200);
      expect(body.items.map((item) => item.id)).toEqual([aSuite]);
    });

    it("busca por texto sin distinguir mayúsculas", async () => {
      const { status, body } = await getJson<PageBody>(
        `/products?destinationId=${destB}&q=luna`,
      );
      expect(status).toBe(200);
      expect(body.items.map((item) => item.id)).toEqual([bStd]);

      const other = await getJson<PageBody>(`/products?destinationId=${destA}&q=luna`);
      expect(other.status).toBe(200);
      expect(other.body.items).toEqual([]);
    });

    it("devuelve lista vacía cuando ningún producto coincide", async () => {
      const { status, body } = await getJson<PageBody>(
        `/products?destinationId=${randomUUID()}`,
      );
      expect(status).toBe(200);
      expect(body).toEqual({ items: [], nextCursor: null });
    });

    it("lee productos publicados de dos agencias y oculta los no públicos", async () => {
      const { status, body } = await getJson<PageBody>(`/products?limit=50`);
      expect(status).toBe(200);
      const ids = body.items.map((item) => item.id);
      expect(ids).toEqual(expect.arrayContaining([aStd, bStd, aNoEn]));
      expect(ids).not.toContain(aDraft);
      expect(ids).not.toContain(aArchived);
      expect(ids).not.toContain(aDeleted);
    });

    it("pagina por cursor sin duplicados ni huecos", async () => {
      const first = await getJson<PageBody>(`/products?destinationId=${destA}&limit=2`);
      expect(first.status).toBe(200);
      expect(first.body.items.map((item) => item.id)).toEqual([aStd, aPagination]);
      expect(first.body.nextCursor).toBeTruthy();

      const second = await getJson<PageBody>(
        `/products?destinationId=${destA}&limit=2&cursor=${encodeURIComponent(
          first.body.nextCursor ?? "",
        )}`,
      );
      expect(second.status).toBe(200);
      expect(second.body.items.map((item) => item.id)).toEqual([aFull, aSuite]);
      expect(second.body.nextCursor).toBeNull();

      expect([
        ...first.body.items.map((item) => item.id),
        ...second.body.items.map((item) => item.id),
      ]).toEqual([aStd, aPagination, aFull, aSuite]);
    });

    it("rechaza un cursor ilegible o de otro orden con 422", async () => {
      const malformed = await getJson<ProblemBody>(`/products?cursor=%25%25%25`);
      expect(malformed.status).toBe(422);
      expect(malformed.body.code).toBe("VALIDATION_ERROR");

      const first = await getJson<PageBody>(`/products?destinationId=${destA}&limit=1`);
      expect(first.body.nextCursor).toBeTruthy();
      const wrongOrder = await getJson<ProblemBody>(
        `/products?destinationId=${destA}&checkIn=${checkIn}&checkOut=${checkOut}&cursor=${encodeURIComponent(
          first.body.nextCursor ?? "",
        )}`,
      );
      expect(wrongOrder.status).toBe(422);
      expect(wrongOrder.body.code).toBe("VALIDATION_ERROR");
    });

    it("rechaza un límite fuera de rango con 422", async () => {
      for (const limit of ["0", "51"]) {
        const { status, body } = await getJson<ProblemBody>(`/products?limit=${limit}`);
        expect(status).toBe(422);
        expect(body.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("Detalle y disponibilidad públicos", () => {
    it("devuelve el detalle de un producto publicado sin datos internos", async () => {
      const { status, body } = await getJson<Record<string, unknown>>(`/products/${aStd}`);
      expect(status).toBe(200);
      expect(body).toMatchObject({
        id: aStd,
        hotelKey: hotelKeyA,
        roomType: "standard",
        type: "hotel",
        title: titleA,
        description: { es: "Habitación standard", en: "standard room" },
        destination: {
          id: destA,
          name: { es: "Mérida", en: "Merida" },
          country: "VE",
          code: codeA,
        },
        attributes: {
          stars: 4,
          maxGuests: 2,
          amenities: ["wifi", "pool"],
          images: [imageA],
        },
        basePriceUsd: "100.00",
      });
      expect(body).not.toHaveProperty("totalUsd");
      for (const key of [
        "tenantId",
        "providerId",
        "status",
        "deletedAt",
        "capacity",
        "reserved",
      ]) {
        expect(body).not.toHaveProperty(key);
      }
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(orgA);
      expect(serialized).not.toContain(providerA);
    });

    it("cae a español cuando falta la traducción en inglés", async () => {
      const { status, body } = await getJson<Record<string, unknown>>(`/products/${aNoEn}`);
      expect(status).toBe(200);
      expect(body).toMatchObject({
        title: { es: titleNoEn.es, en: titleNoEn.es },
        description: { es: "Habitación sin inglés", en: "Habitación sin inglés" },
      });
    });

    it("responde 404 para un producto no público o inexistente", async () => {
      for (const id of [aDraft, aArchived, aDeleted, randomUUID()]) {
        const { status, body } = await getJson<ProblemBody>(`/products/${id}`);
        expect(status).toBe(404);
        expect(body.code).toBe("NOT_FOUND");
      }
    });

    it("devuelve las noches con cupo restante y sin capacity ni reserved", async () => {
      const { status, body } = await getJson<AvailabilityBody>(
        `/products/${aStd}/availability?from=${checkIn}&to=${checkOut}`,
      );
      expect(status).toBe(200);
      expect(body).toEqual({
        productId: aStd,
        from: checkIn,
        to: checkOut,
        nights: [
          { night: night1, remaining: 4, priceUsd: "100.00", priceVes: null },
          { night: night2, remaining: 4, priceUsd: "120.00", priceVes: null },
          { night: night3, remaining: 4, priceUsd: "90.00", priceVes: null },
        ],
      });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("capacity");
      expect(serialized).not.toContain("reserved");
    });

    it("sin rango devuelve 31 noches desde hoy en Caracas", async () => {
      const { status, body } = await getJson<AvailabilityBody>(
        `/products/${aStd}/availability`,
      );
      expect(status).toBe(200);
      expect(body.from).toBe(today);
      expect(body.to).toBe(addDays(today, 31));
      expect(body.nights.map((night) => night.night)).toEqual([night1, night2, night3]);
    });

    it("responde 404 para la disponibilidad de un producto no público", async () => {
      const { status, body } = await getJson<ProblemBody>(`/products/${aDraft}/availability`);
      expect(status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
    });

    it("rechaza un rango de disponibilidad invertido con 422", async () => {
      const { status, body } = await getJson<ProblemBody>(
        `/products/${aStd}/availability?from=${checkOut}&to=${checkIn}`,
      );
      expect(status).toBe(422);
      expect(body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Precio VES informativo", () => {
    it("sin tasa disponible muestra solo precios en USD", async () => {
      const page = await getJson<PageBody>(
        `/products?destinationId=${destA}&checkIn=${checkIn}&checkOut=${checkOut}`,
      );
      expect(page.status).toBe(200);
      expect(page.body.items[0]).toMatchObject({
        id: aStd,
        basePriceVes: null,
        totalVes: null,
      });

      const detail = await getJson<Record<string, unknown>>(`/products/${aStd}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({ basePriceUsd: "100.00", basePriceVes: null });

      const availability = await getJson<AvailabilityBody>(
        `/products/${aStd}/availability?from=${checkIn}&to=${checkOut}`,
      );
      expect(availability.status).toBe(200);
      expect(availability.body.nights.every((night) => night.priceVes === null)).toBe(true);
    });

    it("usa la tasa global para el precio, el total y cada noche", async () => {
      await owner.query(
        `INSERT INTO "exchange_rates"
           (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
         VALUES ($1, NULL, 'TEST', '900.0000', $2::date, now(), false, NULL, NULL)`,
        [randomUUID(), today],
      );

      const page = await getJson<PageBody>(
        `/products?destinationId=${destA}&checkIn=${checkIn}&checkOut=${checkOut}`,
      );
      expect(page.status).toBe(200);
      expect(page.body.items[0]).toMatchObject({
        id: aStd,
        basePriceUsd: "100.00",
        basePriceVes: "90000.00",
        totalUsd: "310.00",
        totalVes: "279000.00",
      });

      const detail = await getJson<Record<string, unknown>>(`/products/${aStd}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({ basePriceVes: "90000.00" });

      const availability = await getJson<AvailabilityBody>(
        `/products/${aStd}/availability?from=${checkIn}&to=${checkOut}`,
      );
      expect(availability.status).toBe(200);
      expect(availability.body.nights.map((night) => night.priceVes)).toEqual([
        "90000.00",
        "108000.00",
        "81000.00",
      ]);
    });
  });
});
