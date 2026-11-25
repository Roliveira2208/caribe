import { createHash } from "node:crypto";
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  z,
  type PaymentBody,
  type PaymentMethodValue,
  type PaymentStatusValue,
} from "@caribe/shared";

/**
 * Contrato de pagos (T-F1-9, specs/payments "Creación de pago", "Datos por
 * método de pago" y "Serialización de montos"; design §7).
 *
 * El cuerpo de alta es la unión discriminada compartida `paymentBodySchema`:
 * solo método y sus datos. Montos, tasa, `tenant_id`, `user_id`, estados y
 * fechas derivadas no se declaran y una clave desconocida responde 422
 * `VALIDATION_ERROR` (el servidor no ignora campos calculados). El listado y
 * la revisión usan esquemas estrictos propios.
 */

/** Tamaño de página por defecto y máximo del listado de pagos. */
export const PAYMENTS_DEFAULT_LIMIT = 20;
export const PAYMENTS_MAX_LIMIT = 50;

/** Endpoint que se guarda en `idempotency_keys.endpoint`. */
export const PAYMENT_CREATE_ENDPOINT = "POST /bookings/:id/payments";

/** Filtros del listado de pagos del panel; el cursor lo valida el servicio. */
export const listPaymentsQuerySchema = z.strictObject({
  status: z.enum(PAYMENT_STATUSES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  bookingId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(PAYMENTS_MAX_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
});

export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

/** Rechazo de un pago: el motivo es obligatorio (spec payments, "Rechazo sin motivo"). */
export const rejectPaymentSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});

export type RejectPaymentBody = z.infer<typeof rejectPaymentSchema>;

/**
 * Pago serializado. Los montos van como cadenas con 2 decimales y la tasa con
 * 4 (spec payments, "Serialización de montos"); las fechas, en ISO 8601 UTC.
 * Nunca se exponen datos de tarjeta más allá de `last4`/marca, y el contrato
 * no tiene columnas para el número completo ni el CVV.
 */
export interface PaymentResponse {
  id: string;
  bookingId: string;
  method: PaymentMethodValue;
  status: PaymentStatusValue;
  amountUsd: string;
  amountVes: string;
  rate: string;
  /** Id de la tasa congelada: el panel lo muestra, nunca lo calcula. */
  exchangeRateId: string;
  valueDate: string;
  reference: string | null;
  reportedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

/** Página del listado de pagos del panel. */
export interface PaymentPage {
  items: PaymentResponse[];
  nextCursor: string | null;
}

/** Pagos de una reserva propia (sin paginación: son pocos por reserva). */
export interface BookingPaymentsResponse {
  items: PaymentResponse[];
}

/**
 * Reembolso serializado que devuelve la cancelación (T-F1-10, specs/payments
 * "Reembolso"). Montos con 2 decimales, tasa con 4 y fecha valor calendario.
 */
export interface RefundResponse {
  id: string;
  amountUsd: string;
  amountVes: string;
  rate: string;
  valueDate: string;
  paymentStatus: PaymentStatusValue;
}

/**
 * Estimación leída por el detalle de la reserva (T-F1-14a): la calcula la API
 * con la política y la tasa congeladas. La web solo la muestra; nunca envía ni
 * recalcula montos. No es un reembolso emitido y no crea filas ni auditoría.
 */
export interface RefundEstimateResponse {
  amountUsd: string;
  amountVes: string;
  rate: string;
  valueDate: string;
  percentage: number;
}

export interface BookingRefundEstimate {
  paymentStatus: PaymentStatusValue | null;
  refundEstimate: RefundEstimateResponse | null;
}

/**
 * Hash estable del alta de pago: reserva + cuerpo ya validado. Dos solicitudes
 * equivalentes producen el mismo hash; la misma clave con otra reserva u otro
 * cuerpo se detecta como reutilización.
 */
export function hashPaymentRequest(bookingId: string, body: PaymentBody): string {
  return createHash("sha256")
    .update(JSON.stringify({ bookingId, body }))
    .digest("hex");
}

/**
 * Respuesta mínima guardada en `idempotency_keys.response_body`: solo id y
 * estado, nunca montos, referencias ni datos de método (design §2.3).
 */
export function parseStoredPaymentResponse(
  value: unknown,
): { id: string; status: PaymentStatusValue } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  // La respuesta guardada es exactamente { id, status }: cualquier otra clave
  // sería un dato de más (montos, referencias, método) y no se acepta.
  if (Object.keys(record).length !== 2) return null;
  const id = record["id"];
  const status = record["status"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof status !== "string") return null;
  if (!(PAYMENT_STATUSES as readonly string[]).includes(status)) return null;
  return { id, status: status as PaymentStatusValue };
}
