/**
 * Contrato puro del paso de pago (T-F1-13d). La web valida la forma del cuerpo
 * con el mismo esquema Zod compartido por la API y nunca calcula montos ni
 * tasas: el servidor congela ambos al crear el pago.
 */

import {
  PAYMENT_STATUSES,
  paymentBodySchema,
  type PaymentBody,
  type PaymentMethodValue,
  type PaymentStatusValue,
} from "@caribe/shared";

export type PaymentErrorKind =
  | "generic"
  | "expired"
  | "duplicate"
  | "validation"
  | "forbidden"
  | "cancelled"
  | "alreadyPaid"
  | "malformed";

export const PAYMENT_METHOD_OPTIONS: readonly PaymentMethodValue[] = [
  "PAGO_MOVIL",
  "ZELLE",
  "BINANCE_PAY",
  "CARD",
];

export interface PaymentFormFields {
  bank: string;
  phone: string;
  reference: string;
  senderName: string;
  senderEmail: string;
  confirmationNumber: string;
  orderId: string;
  last4: string;
  brand: string;
}

export const EMPTY_PAYMENT_FIELDS: PaymentFormFields = {
  bank: "",
  phone: "",
  reference: "",
  senderName: "",
  senderEmail: "",
  confirmationNumber: "",
  orderId: "",
  last4: "",
  brand: "",
};

/** Pago serializado que esta pantalla sabe mostrar (montos como cadenas). */
export interface ReportedPaymentView {
  id: string;
  status: PaymentStatusValue;
  amountUsd: string;
  amountVes: string;
  rate: string;
}

const DECIMAL_TEXT = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
const RATE_TEXT = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Construye el cuerpo exacto del método elegido. Un campo de otro método o una
 * clave desconocida no se envía: `safeParse` rechaza el cuerpo antes de la red.
 */
export function buildPaymentBody(
  method: PaymentMethodValue,
  fields: PaymentFormFields,
): PaymentBody | null {
  const candidate: Record<string, string> = { method };
  switch (method) {
    case "PAGO_MOVIL":
      candidate.bank = fields.bank.trim();
      candidate.phone = fields.phone.trim();
      candidate.reference = fields.reference.trim();
      break;
    case "ZELLE":
      if (fields.senderName.trim()) candidate.senderName = fields.senderName.trim();
      if (fields.senderEmail.trim()) candidate.senderEmail = fields.senderEmail.trim();
      candidate.confirmationNumber = fields.confirmationNumber.trim();
      break;
    case "BINANCE_PAY":
      candidate.orderId = fields.orderId.trim();
      break;
    case "CARD":
      candidate.last4 = fields.last4.trim();
      candidate.brand = fields.brand.trim();
      break;
  }
  const parsed = paymentBodySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Acepta solo la respuesta de pago que esta pantalla sabe mostrar. */
export function parseReportedPayment(value: unknown): ReportedPaymentView | null {
  const root = asRecord(value);
  if (!root) return null;
  const { id, status, amountUsd, amountVes, rate } = root;
  if (typeof id !== "string" || id === "") return null;
  if (typeof status !== "string" || !(PAYMENT_STATUSES as readonly string[]).includes(status)) {
    return null;
  }
  if (
    typeof amountUsd !== "string" ||
    !DECIMAL_TEXT.test(amountUsd) ||
    typeof amountVes !== "string" ||
    !DECIMAL_TEXT.test(amountVes) ||
    typeof rate !== "string" ||
    !RATE_TEXT.test(rate)
  ) {
    return null;
  }
  return {
    id,
    status: status as PaymentStatusValue,
    amountUsd,
    amountVes,
    rate,
  };
}

export function paymentApiUrl(bookingId: string): string {
  return `/api/v1/bookings/${encodeURIComponent(bookingId)}/payments`;
}

/** Traduce un Problem Details del alta de pago a un mensaje de la UI. */
export function paymentErrorKind(status: number, body: unknown): PaymentErrorKind {
  const problem = asRecord(body);
  const code = typeof problem?.code === "string" ? problem.code : "";
  if (status === 410 || code === "HOLD_EXPIRED") return "expired";
  if (code === "DUPLICATE_PAYMENT_REFERENCE") return "duplicate";
  if (code === "IDEMPOTENCY_KEY_REUSED" || code === "IDEMPOTENCY_KEY_IN_PROGRESS") {
    return "duplicate";
  }
  if (status === 422 || code === "VALIDATION_ERROR") return "validation";
  if (status === 401 || status === 403) return "forbidden";
  if (code === "BOOKING_CANCELLED") return "cancelled";
  if (code === "BOOKING_ALREADY_PAID") return "alreadyPaid";
  return "generic";
}

/** Milisegundos de retención que quedan; nunca negativos. */
export function remainingHoldMs(expiresAt: string, now: number): number {
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, deadline - now);
}

/** Texto MM:SS de la cuenta regresiva (o 00:00 al vencer). */
export function formatHoldRemaining(milliseconds: number): string {
  const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
