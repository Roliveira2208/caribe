import { Injectable } from "@nestjs/common";
import {
  formatAmount,
  formatValueDate,
  todayInCaracas,
  type DecimalValue,
} from "@caribe/shared";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { Prisma } from "../generated/prisma/client.js";
import { ExchangeRateService } from "../rates/exchange-rate.service.js";
import { TenantService } from "../tenant/tenant.service.js";
import { vesAmount } from "./catalog.pricing.js";
import {
  AVAILABILITY_DEFAULT_NIGHTS,
  CATALOG_DEFAULT_LIMIT,
  addDays,
  type AvailabilityQuery,
  type CatalogAvailability,
  type CatalogDestination,
  type CatalogOffer,
  type CatalogPage,
  type CatalogProduct,
  type CatalogQuery,
} from "./catalog.schemas.js";
import { catalogOrderKey, decodeCatalogCursor, encodeCatalogCursor } from "./catalog.cursor.js";
import { toAttributes, toLocalized } from "./catalog.mappers.js";

/** Fila de la ficha pública; la oferta añade el total de la estancia. */
interface ProductRow {
  id: string;
  hotel_key: string;
  room_type: string;
  title: unknown;
  description: unknown;
  attributes: unknown;
  base_price_usd: DecimalValue;
  destination_id: string;
  destination_name: unknown;
  destination_country: string;
  destination_code: string;
}

interface OfferRow extends ProductRow {
  order_price: DecimalValue;
  stay_total: DecimalValue | null;
}

interface NightRow {
  night: string;
  remaining: number;
  price_usd: DecimalValue;
}

/** Estancia ya validada por el esquema de la query. */
interface StayRange {
  checkIn: string;
  checkOut: string;
}

/**
 * Lectura pública del catálogo (T-F1-3, delta de catalog "Búsqueda y filtros",
 * "Detalle y disponibilidad públicos" y "Lectura pública entre agencias").
 *
 * Todas las consultas corren en el contexto RLS `public` de `TenantService`,
 * de modo que el rol real de la aplicación solo ve productos `PUBLISHED` sin
 * borrado lógico y nunca puede escribir. El filtro de estado y borrado se
 * repite en el SQL: en las pruebas la API conecta como superusuario (exento de
 * RLS) y la lectura no debe depender del rol de la conexión.
 *
 * La respuesta se limita a campos de catálogo: no expone `tenant_id`,
 * `provider_id`, estado, borrado lógico ni `capacity`/`reserved`; la
 * disponibilidad solo devuelve `remaining` mediante `public_availability`.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly tenantService: TenantService,
    private readonly exchangeRates: ExchangeRateService,
  ) {}

  /** Búsqueda con filtros, orden precio/identificador y cursor opaco. */
  async search(query: CatalogQuery): Promise<CatalogPage> {
    const limit = query.limit ?? CATALOG_DEFAULT_LIMIT;
    const range: StayRange | undefined =
      query.checkIn !== undefined && query.checkOut !== undefined
        ? { checkIn: query.checkIn, checkOut: query.checkOut }
        : undefined;
    const order = catalogOrderKey(range);
    const cursor = query.cursor ? decodeCatalogCursor(query.cursor, order) : null;

    const [rows, rate] = await Promise.all([
      this.tenantService.withPublic((tx) => this.searchRows(tx, query, range, limit, cursor)),
      this.globalRateOrNull(),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => toOffer(row, rate)),
      nextCursor:
        hasMore && last
          ? encodeCatalogCursor({
              order,
              price: formatAmount(last.order_price),
              id: last.id,
            })
          : null,
    };
  }

  /** Ficha pública de un producto `PUBLISHED` sin borrado lógico. */
  async detail(id: string): Promise<CatalogProduct> {
    const rate = await this.globalRateOrNull();
    const rows = await this.tenantService.withPublic((tx) =>
      tx.$queryRaw<ProductRow[]>(Prisma.sql`
        SELECT p."id" AS id,
               p."hotel_key" AS hotel_key,
               p."room_type" AS room_type,
               p."title" AS title,
               p."description" AS description,
               p."attributes" AS attributes,
               p."base_price_usd" AS base_price_usd,
               p."destination_id" AS destination_id,
               d."name" AS destination_name,
               d."country" AS destination_country,
               d."code" AS destination_code
          FROM "products" p
          JOIN "destinations" d ON d."id" = p."destination_id"
         WHERE p."id" = ${id}
           AND p."status" = 'PUBLISHED'
           AND p."deleted_at" IS NULL
         LIMIT 1
      `),
    );

    const product = rows[0];
    if (!product) throw productNotFound();
    return toProduct(product, rate);
  }

  /**
   * Noches de un producto público. Sin rango se devuelven 31 noches desde hoy
   * en Caracas, suficiente para la estancia máxima de 30 noches. La función
   * SQL solo proyecta `night`, `remaining` y `price_usd`.
   */
  async availability(id: string, query: AvailabilityQuery): Promise<CatalogAvailability> {
    const from = query.from ?? todayInCaracas();
    const to = query.to ?? addDays(from, AVAILABILITY_DEFAULT_NIGHTS);
    const rate = await this.globalRateOrNull();

    return this.tenantService.withPublic(async (tx) => {
      const exists = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT p."id" AS id
          FROM "products" p
         WHERE p."id" = ${id}
           AND p."status" = 'PUBLISHED'
           AND p."deleted_at" IS NULL
         LIMIT 1
      `);
      if (exists.length === 0) throw productNotFound();

      const nights = await tx.$queryRaw<NightRow[]>(Prisma.sql`
        SELECT a.night::text AS night,
               a.remaining AS remaining,
               a.price_usd AS price_usd
          FROM public_availability(${id}, ${from}::date, ${to}::date) AS a
         ORDER BY a.night
      `);

      return {
        productId: id,
        from,
        to,
        nights: nights.map((row) => ({
          night: formatValueDate(row.night),
          remaining: Number(row.remaining),
          priceUsd: formatAmount(row.price_usd),
          priceVes: vesAmount(row.price_usd, rate),
        })),
      };
    });
  }

  /**
   * Tasa global vigente para el VES informativo. Sin tasa global el catálogo
   * sigue sirviendo USD (spec catalog, "Sin tasa disponible"); un fallo
   * distinto de la ausencia de tasa no se oculta.
   */
  private async globalRateOrNull(): Promise<string | null> {
    try {
      return (await this.exchangeRates.globalRate()).rate;
    } catch (error) {
      if (error instanceof ApiProblemException && error.code === "RATE_UNAVAILABLE") {
        return null;
      }
      throw error;
    }
  }

  /** Consulta keyset: pide una fila de más para saber si hay página siguiente. */
  private searchRows(
    tx: Prisma.TransactionClient,
    query: CatalogQuery,
    range: StayRange | undefined,
    limit: number,
    cursor: ReturnType<typeof decodeCatalogCursor> | null,
  ): Promise<OfferRow[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`p."status" = 'PUBLISHED'`,
      Prisma.sql`p."deleted_at" IS NULL`,
    ];

    if (query.type) {
      conditions.push(Prisma.sql`p."type"::text = ${query.type.toUpperCase()}`);
    }
    if (query.destinationId) {
      conditions.push(Prisma.sql`p."destination_id" = ${query.destinationId}`);
    }
    if (query.q) {
      // Coincidencia simple, sin distinguir mayúsculas, sobre el título i18n.
      // Los comodines del usuario se escapan para que sean literales.
      const pattern = `%${escapeLike(query.q)}%`;
      conditions.push(Prisma.sql`(
        p."title"->>'es' ILIKE ${pattern} ESCAPE '!'
        OR p."title"->>'en' ILIKE ${pattern} ESCAPE '!'
      )`);
    }
    if (query.guests !== undefined) {
      conditions.push(Prisma.sql`(
        CASE
          WHEN p."attributes"->>'maxGuests' ~ '^[0-9]+$'
          THEN (p."attributes"->>'maxGuests')::int
          ELSE 0
        END
      ) >= ${query.guests}`);
    }
    if (range) {
      // Todas las noches de [checkIn, checkOut) deben tener fila y cupo para
      // una habitación; si falta una noche o no hay cupo, el producto no sale.
      conditions.push(Prisma.sql`NOT EXISTS (
        SELECT 1
          FROM generate_series(
                 ${range.checkIn}::date,
                 ${range.checkOut}::date - interval '1 day',
                 interval '1 day'
               ) AS g(night)
         WHERE NOT EXISTS (
           SELECT 1
             FROM "availability" a
            WHERE a."product_id" = p."id"
              AND a."night" = g.night::date
              AND a."reserved" + 1 <= a."capacity"
         )
      )`);
    }

    const orderPrice = range
      ? Prisma.sql`COALESCE((
          SELECT SUM(a."price_usd")
            FROM "availability" a
           WHERE a."product_id" = p."id"
             AND a."night" >= ${range.checkIn}::date
             AND a."night" < ${range.checkOut}::date
        ), 0)`
      : Prisma.sql`p."base_price_usd"`;
    const stayTotal = range ? orderPrice : Prisma.sql`NULL::numeric`;

    // El rango se aplica sobre el precio visible (order_price) en la consulta
    // exterior, antes del cursor, para que la paginación no se salte filas.
    const outerConditions: Prisma.Sql[] = [];
    if (query.minPriceUsd !== undefined) {
      outerConditions.push(Prisma.sql`s.order_price >= ${query.minPriceUsd}::numeric`);
    }
    if (query.maxPriceUsd !== undefined) {
      outerConditions.push(Prisma.sql`s.order_price <= ${query.maxPriceUsd}::numeric`);
    }
    if (cursor) {
      outerConditions.push(Prisma.sql`(
        s.order_price > ${cursor.price}::numeric
        OR (s.order_price = ${cursor.price}::numeric AND s.id > ${cursor.id})
      )`);
    }
    const outerWhere = outerConditions.length
      ? Prisma.sql`WHERE ${Prisma.join(outerConditions, " AND ")}`
      : Prisma.empty;

    return tx.$queryRaw<OfferRow[]>(Prisma.sql`
      SELECT s.id,
             s.hotel_key,
             s.room_type,
             s.title,
             s.description,
             s.attributes,
             s.base_price_usd,
             s.destination_id,
             s.destination_name,
             s.destination_country,
             s.destination_code,
             s.order_price,
             s.stay_total
        FROM (
          SELECT p."id" AS id,
                 p."hotel_key" AS hotel_key,
                 p."room_type" AS room_type,
                 p."title" AS title,
                 p."description" AS description,
                 p."attributes" AS attributes,
                 p."base_price_usd" AS base_price_usd,
                 p."destination_id" AS destination_id,
                 d."name" AS destination_name,
                 d."country" AS destination_country,
                 d."code" AS destination_code,
                 ${orderPrice} AS order_price,
                 ${stayTotal} AS stay_total
            FROM "products" p
            JOIN "destinations" d ON d."id" = p."destination_id"
           WHERE ${Prisma.join(conditions, " AND ")}
        ) s
        ${outerWhere}
       ORDER BY s.order_price ASC, s.id ASC
       LIMIT ${limit + 1}
    `);
  }
}

function productNotFound(): ApiProblemException {
  return new ApiProblemException("NOT_FOUND", "El recurso no existe.");
}

/** Escapa los comodines de LIKE/ILIKE para una coincidencia literal. */
function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (match) => `!${match}`);
}

function toProduct(row: ProductRow, rate: string | null): CatalogProduct {
  return {
    id: row.id,
    hotelKey: row.hotel_key,
    roomType: row.room_type,
    type: "hotel",
    title: toLocalized(row.title),
    description: toLocalized(row.description),
    destination: toDestination(row),
    attributes: toAttributes(row.attributes),
    basePriceUsd: formatAmount(row.base_price_usd),
    basePriceVes: vesAmount(row.base_price_usd, rate),
  };
}

function toOffer(row: OfferRow, rate: string | null): CatalogOffer {
  return {
    ...toProduct(row, rate),
    totalUsd: row.stay_total === null ? null : formatAmount(row.stay_total),
    totalVes: row.stay_total === null ? null : vesAmount(row.stay_total, rate),
  };
}

function toDestination(row: ProductRow): CatalogDestination {
  return {
    id: row.destination_id,
    name: toLocalized(row.destination_name),
    country: row.destination_country,
    code: row.destination_code,
  };
}
