import { createHash } from "node:crypto";
import { stayRangeSchema, todayInCaracas, z } from "@caribe/shared";

/**
 * Contrato de creacion de reservas (T-F1-7, specs/booking "Datos del viajero",
 * "Codigo de reserva" e "Idempotencia").
 *
 * El cuerpo es estricto: un monto, una tasa, un `tenant_id`, un `user_id` o un
 * `code` enviados por el cliente no encajan en el esquema y responden 422
 * `VALIDATION_ERROR` (spec booking, "Monto, tasa o campo calculado enviados por
 * el cliente"). El rango de fechas se valida con el mismo esquema compartido
 * del catalogo: `[checkIn, checkOut)` en America/Caracas, sin fechas pasadas y
 * con un maximo de 30 noches.
 */

/** Endpoint que se guarda en `idempotency_keys.endpoint`. */
export const BOOKINGS_CREATE_ENDPOINT = "POST /bookings";

/**
 * Viajero con campos planos. El documento va como tipo + numero; telefono y
 * correo son opcionales. La base refuerza la forma (arreglo de 1 a 9 objetos)
 * y la API valida los campos personales.
 */
export const travelerSchema = z.strictObject({
  fullName: z.string().trim().min(1).max(120),
  documentType: z.string().trim().min(1).max(20),
  documentNumber: z.string().trim().min(1).max(40),
  phone: z.string().trim().min(1).max(30).optional(),
  email: z.email().max(120).optional(),
});

export type Traveler = z.infer<typeof travelerSchema>;

/** Alta de una reserva: un solo producto por reserva (fuera de alcance del MVP
 * el carrito multi-producto). */
export const createBookingSchema = z
  .strictObject({
    productId: z.uuid(),
    checkIn: z.iso.date(),
    checkOut: z.iso.date(),
    quantity: z.int().min(1),
    travelers: z.array(travelerSchema).min(1).max(9),
  })
  .superRefine((value, ctx) => {
    const range = stayRangeSchema({ today: todayInCaracas() }).safeParse({
      checkIn: value.checkIn,
      checkOut: value.checkOut,
    });
    if (!range.success) {
      for (const issue of range.error.issues) {
        ctx.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
      }
    }
  });

export type CreateBookingBody = z.infer<typeof createBookingSchema>;

/** Estados posibles de una reserva (espejo del enum `BookingStatus`). */
export const BOOKING_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type BookingStatusValue = (typeof BOOKING_STATUSES)[number];

/** Tamaño de página por defecto y máximo de "Mis reservas". */
export const BOOKINGS_DEFAULT_LIMIT = 20;
export const BOOKINGS_MAX_LIMIT = 50;

/**
 * Query de `GET /bookings`: filtro por estado y paginación por cursor. El
 * cursor lo valida el servicio, que responde 422 `VALIDATION_ERROR` con
 * `path = "cursor"` si no corresponde.
 */
export const listBookingsQuerySchema = z.strictObject({
  status: z.enum(BOOKING_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(BOOKINGS_MAX_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
});

export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;

/** Una noche del precio congelado de la linea. */
export interface BookingNightPrice {
  night: string;
  priceUsd: string;
}

/** Linea de la reserva tal como se devuelve al cliente. */
export interface BookingItemResponse {
  productId: string;
  hotelKey: string;
  roomType: string;
  title: { es: string; en: string };
  checkIn: string;
  checkOut: string;
  quantity: number;
  nightlyPrices: BookingNightPrice[];
  subtotalUsd: string;
}

/**
 * Detalle completo de una reserva. El mismo esquema sirve para
 * `GET /bookings/:id` (T-F1-7b).
 */
export interface BookingDetailResponse {
  id: string;
  code: string;
  status: BookingStatusValue;
  expiresAt: string;
  totalUsd: string;
  items: BookingItemResponse[];
}

/** Fila del listado "Mis reservas" (sin líneas para no inflar la página). */
export interface BookingSummaryResponse {
  id: string;
  code: string;
  status: BookingStatusValue;
  expiresAt: string;
  totalUsd: string;
  createdAt: string;
}

export interface BookingPage {
  items: BookingSummaryResponse[];
  nextCursor: string | null;
}

/**
 * Hash estable del cuerpo ya validado. El cuerpo Zod conserva el orden del
 * esquema (incluidos los viajeros), asi que dos solicitudes equivalentes
 * producen el mismo hash y una clave reutilizada con otro cuerpo se detecta.
 */
export function hashBookingRequest(body: CreateBookingBody): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

/**
 * Respuesta minima guardada en `idempotency_keys.response_body`: solo el id y
 * el codigo, nunca viajeros ni datos de pago (design §2.3).
 */
export function parseStoredBookingResponse(
  value: unknown,
): { id: string; code: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = record["id"];
  const code = record["code"];
  if (typeof id !== "string" || typeof code !== "string") return null;
  return { id, code };
}
