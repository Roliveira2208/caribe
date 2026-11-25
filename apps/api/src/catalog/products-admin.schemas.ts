import { hotelAttributesSchema, z } from "@caribe/shared";
import type { CatalogAttributes, LocalizedText } from "./catalog.schemas.js";

/**
 * Contrato del panel de productos (T-F1-4, specs/catalog y auth-access).
 *
 * El panel gestiona tipos de habitación, no hoteles: `hotel_key` agrupa los
 * tipos del mismo hotel y `room_type` los distingue. Los esquemas son
 * estrictos: cualquier clave desconocida, precio no decimal o atributo fuera
 * del esquema compartido responde 422 sin llegar al servicio.
 */

/** Tamaño de página por defecto y máximo del listado de panel. */
export const PRODUCTS_ADMIN_DEFAULT_LIMIT = 20;
export const PRODUCTS_ADMIN_MAX_LIMIT = 100;

export const PRODUCT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type ProductStatusValue = (typeof PRODUCT_STATUSES)[number];

/** Código estable en minúsculas del tipo de habitación. */
const ROOM_TYPE_PATTERN = /^[a-z][a-z0-9_-]*$/;

/**
 * Monto en USD como cadena decimal de 14,2: hasta 12 dígitos enteros y 1 o 2
 * decimales, estrictamente mayor que cero. Se acepta cadena (nunca `number`)
 * para no introducir punto flotante en el camino del dinero.
 */
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

export const productMoneySchema = z
  .string()
  .trim()
  .regex(MONEY_PATTERN)
  .refine((value) => Number(value) > 0, {
    message: "El precio debe ser mayor que cero",
  });

export const roomTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(ROOM_TYPE_PATTERN, {
    message: "El tipo de habitación debe ser un código en minúsculas",
  });

/** Texto i18n de entrada: `es` y `en` obligatorios en las escrituras del panel. */
export const titleSchema = z.strictObject({
  es: z.string().trim().min(1).max(200),
  en: z.string().trim().min(1).max(200),
});

export const descriptionSchema = z.strictObject({
  es: z.string().trim().min(1).max(2000),
  en: z.string().trim().min(1).max(2000),
});

/** Formato de entrada admitido por el normalizador de texto localizado. */
export type LocalizedInput = { es: string; en?: string };

/** Dominios permitidos de imagen, leídos del entorno en cada arranque. */
export function allowedImageHosts(): readonly string[] {
  return (process.env.ALLOWED_IMAGE_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

/** Atributos de hotel con el esquema compartido (estrellas, ocupación, etc.). */
export function productAttributesSchema() {
  return hotelAttributesSchema(allowedImageHosts());
}

/**
 * Alta de un tipo de habitación. `hotelKey` es opcional: sin él el servidor
 * genera un hotel nuevo; con él se añade un tipo a un hotel existente (máximo
 * 5 tipos por hotel, validado en el servicio). `providerId` lo elige el admin;
 * el proveedor solo puede usar el suyo.
 */
export const createProductSchema = z.strictObject({
  hotelKey: z.uuid().optional(),
  roomType: roomTypeSchema,
  title: titleSchema,
  description: descriptionSchema,
  destinationId: z.uuid(),
  basePriceUsd: productMoneySchema,
  attributes: productAttributesSchema(),
  cancellationPolicyId: z.uuid().nullable().optional(),
  providerId: z.uuid().optional(),
});

export type CreateProductBody = z.infer<typeof createProductSchema>;

/**
 * Edición parcial de un tipo de habitación. `hotelKey`, `providerId` y
 * `status` no se editan aquí: el hotel se fija al crear y el estado cambia
 * con las acciones publish/archive. Al menos un campo es obligatorio.
 */
export const updateProductSchema = z
  .strictObject({
    roomType: roomTypeSchema.optional(),
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    destinationId: z.uuid().optional(),
    basePriceUsd: productMoneySchema.optional(),
    attributes: productAttributesSchema().optional(),
    cancellationPolicyId: z.uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Envía al menos un campo",
  });

export type UpdateProductBody = z.infer<typeof updateProductSchema>;

/**
 * Escritura de disponibilidad del panel (T-F2-19). `night` es una fecha
 * calendario `YYYY-MM-DD` en `America/Caracas`; el servidor gestiona
 * `reserved`, por lo que cualquier clave adicional se rechaza con 422.
 */
export const availabilityNightSchema = z.strictObject({
  night: z.iso.date(),
  capacity: z.number().int().min(1),
  priceUsd: productMoneySchema,
});

export const availabilityWriteSchema = z.strictObject({
  nights: z.array(availabilityNightSchema).min(1),
});

export type AvailabilityWriteBody = z.infer<typeof availabilityWriteSchema>;

export interface PanelAvailabilityNight {
  night: string;
  capacity: number;
  reserved: number;
  priceUsd: string;
}

export interface PanelAvailabilityWrite {
  productId: string;
  nights: PanelAvailabilityNight[];
}

/** Lectura del panel: mismas noches con cupo y reservadas, sin calcular importes. */
export interface PanelAvailabilityRead {
  productId: string;
  from: string;
  to: string;
  nights: PanelAvailabilityNight[];
}

/** Filtros del listado de panel; el cursor lo valida el servicio. */
export const productsAdminQuerySchema = z.strictObject({
  status: z.enum(PRODUCT_STATUSES).optional(),
  providerId: z.uuid().optional(),
  hotelKey: z.uuid().optional(),
  destinationId: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(PRODUCTS_ADMIN_MAX_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
});

export type ProductsAdminQuery = z.infer<typeof productsAdminQuerySchema>;

/** Normaliza el texto i18n guardado: siempre quedan las dos claves. */
export function normalizeLocalized(value: LocalizedInput): LocalizedText {
  return { es: value.es, en: value.en ?? value.es };
}

/** Destino tal como lo expone el panel. */
export interface PanelDestination {
  id: string;
  name: LocalizedText;
  country: string;
  code: string;
}

/**
 * Fila del panel: incluye datos internos que el catálogo público no expone
 * (agencia, proveedor, estado y timestamps), pero nunca `capacity`/`reserved`.
 */
export interface PanelProduct {
  id: string;
  tenantId: string;
  providerId: string;
  type: "hotel";
  hotelKey: string;
  roomType: string;
  title: LocalizedText;
  description: LocalizedText;
  destination: PanelDestination;
  status: ProductStatusValue;
  basePriceUsd: string;
  cancellationPolicyId: string | null;
  attributes: CatalogAttributes;
  createdAt: string;
  updatedAt: string;
}

export interface PanelProductPage {
  items: PanelProduct[];
  /** Id del registro de proveedor del actor, para que el panel sepa qué filas puede editar. */
  viewerProviderId: string | null;
  nextCursor: string | null;
}
