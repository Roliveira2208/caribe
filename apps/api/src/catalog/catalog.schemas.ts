import { stayRangeSchema, todayInCaracas, z } from "@caribe/shared";

/**
 * Contrato de lectura pública del catálogo (T-F1-3, spec catalog "Búsqueda y
 * filtros" y "Detalle y disponibilidad públicos").
 *
 * La búsqueda filtra por destino, fechas, personas, tipo y texto; el orden es
 * siempre precio ascendente e identificador ascendente y la paginación es por
 * cursor opaco. Los esquemas son estrictos: una clave desconocida, un límite
 * fuera de rango o un rango de fechas inválido responden 422.
 */

/** Tamaño de página por defecto y máximo (spec catalog). */
export const CATALOG_DEFAULT_LIMIT = 20;
export const CATALOG_MAX_LIMIT = 50;

/** Noches devueltas por defecto en la disponibilidad pública. */
export const AVAILABILITY_DEFAULT_NIGHTS = 31;

/** Suma días a una fecha calendario `YYYY-MM-DD` sin depender de la zona. */
export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Query de `GET /products`. `checkIn` y `checkOut` van juntos y se validan con
 * el mismo rango de estancia de la reserva: `checkOut > checkIn`, sin fechas
 * pasadas y con un máximo de 30 noches en `America/Caracas`.
 */
export const catalogQuerySchema = z
  .strictObject({
    destinationId: z.string().min(1).optional(),
    checkIn: z.iso.date().optional(),
    checkOut: z.iso.date().optional(),
    guests: z.coerce.number().int().min(1).max(20).optional(),
    type: z.enum(["hotel"]).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(CATALOG_MAX_LIMIT).optional(),
    cursor: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const hasCheckIn = value.checkIn !== undefined;
    const hasCheckOut = value.checkOut !== undefined;
    if (hasCheckIn !== hasCheckOut) {
      ctx.addIssue({
        code: "custom",
        path: [hasCheckIn ? "checkOut" : "checkIn"],
        message: "checkIn y checkOut deben enviarse juntos",
      });
      return;
    }
    if (value.checkIn !== undefined && value.checkOut !== undefined) {
      const range = stayRangeSchema().safeParse({
        checkIn: value.checkIn,
        checkOut: value.checkOut,
      });
      if (!range.success) {
        for (const issue of range.error.issues) {
          // Las fechas ya pasaron por z.iso.date(): aquí solo fallan las
          // reglas de negocio, cuyos mensajes ya están en español.
          ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
        }
      }
    }
  });

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

/**
 * Query de `GET /products/:id/availability`. Sin `from`/`to` se devuelven las
 * 31 noches desde hoy en Caracas, suficiente para la estancia máxima de 30
 * noches. Cada extremo ausente toma su valor por defecto: `from` es hoy y
 * `to` es `from` más 31 días; después de aplicar los defaults, `to` debe ser
 * posterior a `from`.
 */
export const availabilityQuerySchema = z
  .strictObject({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .superRefine((value, ctx) => {
    const from = value.from ?? todayInCaracas();
    const to = value.to ?? addDays(from, AVAILABILITY_DEFAULT_NIGHTS);
    if (to <= from) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "to debe ser posterior a from",
      });
    }
  });

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/** Texto visible con las dos claves del JSONB; `en` cae a `es` si falta. */
export interface LocalizedText {
  es: string;
  en: string;
}

export interface CatalogDestination {
  id: string;
  name: LocalizedText;
  country: string;
  code: string;
}

/** Atributos del hotel tal como salen al público (sin claves internas). */
export interface CatalogAttributes {
  stars: number;
  maxGuests: number;
  amenities: string[];
  images: string[];
}

/** Ficha pública de un tipo de habitación. */
export interface CatalogProduct {
  id: string;
  hotelKey: string;
  roomType: string;
  type: "hotel";
  title: LocalizedText;
  description: LocalizedText;
  destination: CatalogDestination;
  attributes: CatalogAttributes;
  basePriceUsd: string;
}

/**
 * Oferta de la búsqueda: la ficha más el total de la estancia para una
 * habitación cuando se enviaron fechas (`null` sin fechas).
 */
export interface CatalogOffer extends CatalogProduct {
  totalUsd: string | null;
}

export interface CatalogPage {
  items: CatalogOffer[];
  nextCursor: string | null;
}

export interface AvailabilityNight {
  night: string;
  remaining: number;
  priceUsd: string;
}

export interface CatalogAvailability {
  productId: string;
  from: string;
  to: string;
  nights: AvailabilityNight[];
}
