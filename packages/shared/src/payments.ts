import { z } from "zod";

/**
 * Contrato de pagos (T-F1-9, specs/payments "Datos por método de pago",
 * "Serialización de montos" y design §7).
 *
 * El cliente solo envía el método y sus datos. Montos, tasa, `tenant_id`,
 * `user_id` y cualquier otro campo calculado no se declaran: los objetos son
 * estrictos y una clave desconocida responde 422 `VALIDATION_ERROR`. En
 * particular `cardNumber`, `pan` y `cvv` nunca forman parte del contrato y su
 * valor no se guarda ni se registra.
 */

export const PAYMENT_METHODS = ["PAGO_MOVIL", "ZELLE", "BINANCE_PAY", "CARD"] as const;

export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  "PENDING",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;

export type PaymentStatusValue = (typeof PAYMENT_STATUSES)[number];

/** Modo de aprobación de la agencia (`tenant_settings.payment_mode`). */
export type PaymentModeValue = "AUTO" | "MANUAL";

/**
 * Teléfono venezolano: `+58` o `0`, seguido de un código de área fijo (`2xx`)
 * o móvil (`4xx`) y siete dígitos. Sin espacios ni guiones.
 */
export const VENEZUELAN_PHONE_PATTERN = /^(?:\+58|0)(?:2\d{2}|4\d{2})\d{7}$/;

/** Referencia de Pago Móvil: 4 a 20 caracteres alfanuméricos. */
export const PAYMENT_REFERENCE_PATTERN = /^[A-Za-z0-9]{4,20}$/;

/** Últimos cuatro dígitos de la tarjeta; nunca el número completo. */
const CARD_LAST4_PATTERN = /^\d{4}$/;

const pagoMovilSchema = z.strictObject({
  method: z.literal("PAGO_MOVIL"),
  bank: z.string().trim().min(1).max(64),
  phone: z.string().regex(VENEZUELAN_PHONE_PATTERN, {
    message: "El teléfono no cumple el formato venezolano",
  }),
  reference: z.string().regex(PAYMENT_REFERENCE_PATTERN, {
    message: "La referencia debe tener de 4 a 20 caracteres alfanuméricos",
  }),
});

const zelleSchema = z.strictObject({
  method: z.literal("ZELLE"),
  senderName: z.string().trim().min(1).max(120).optional(),
  senderEmail: z.email().optional(),
  confirmationNumber: z.string().trim().min(1).max(64),
});

const binancePaySchema = z.strictObject({
  method: z.literal("BINANCE_PAY"),
  orderId: z.string().trim().min(1).max(64),
});

const cardSchema = z.strictObject({
  method: z.literal("CARD"),
  last4: z.string().regex(CARD_LAST4_PATTERN, {
    message: "Se guardan solo los últimos cuatro dígitos",
  }),
  brand: z.string().trim().min(1).max(32),
});

/**
 * Unión discriminada por `method`. Zelle exige nombre o correo del emisor
 * además del número de confirmación; la comprobación va en la unión para no
 * romper el discriminante.
 */
export const paymentBodySchema = z
  .discriminatedUnion("method", [pagoMovilSchema, zelleSchema, binancePaySchema, cardSchema])
  .superRefine((body, ctx) => {
    if (body.method === "ZELLE" && !body.senderName && !body.senderEmail) {
      ctx.addIssue({
        code: "custom",
        path: ["senderName"],
        message: "Zelle exige el nombre o el correo del emisor",
      });
    }
  });

export type PaymentBody = z.infer<typeof paymentBodySchema>;

/**
 * Referencia que se guarda en `payments.reference` y que es única por agencia
 * y método. La tarjeta no tiene referencia externa.
 */
export function paymentReference(body: PaymentBody): string | null {
  switch (body.method) {
    case "PAGO_MOVIL":
      return body.reference;
    case "ZELLE":
      return body.confirmationNumber;
    case "BINANCE_PAY":
      return body.orderId;
    case "CARD":
      return null;
  }
}

/** Lo que el servicio entrega al proveedor de pagos (D9). */
export interface PaymentIntent {
  bookingId: string;
  tenantId: string;
  method: PaymentMethodValue;
  reference: string | null;
  amountUsd: string;
  amountVes: string;
  rate: string;
  /** `payment_mode = AUTO`: la pasarela simulada aprueba al instante. */
  autoApprove: boolean;
}

/** Resultado del alta: el pago sale de la transacción en un estado visible. */
export interface ProviderPayment {
  status: "IN_REVIEW" | "APPROVED";
  providerReference: string | null;
}

/** Lo que el servicio entrega al proveedor para reembolsar (T-F1-10). */
export interface RefundIntent {
  paymentId: string;
  amountUsd: string;
  amountVes: string;
  rate: string;
  reason: string;
}

export interface ProviderRefund {
  providerReference: string | null;
}

/**
 * Puerto de pagos (D9): cobro real, confirmación y reembolso. En F1 el único
 * adaptador es `SimulatedPaymentProvider`; una pasarela real implementa la
 * misma interfaz sin tocar el dominio.
 */
export interface PaymentProvider {
  createPayment(intent: PaymentIntent): Promise<ProviderPayment>;
  confirm(paymentId: string): Promise<ProviderPayment>;
  refund(intent: RefundIntent): Promise<ProviderRefund>;
}
