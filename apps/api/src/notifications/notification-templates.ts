/**
 * Textos del único aviso de F1 (T-F1-12, spec notifications "Idioma del aviso").
 * Las plantillas son datos con una versión por idioma, no cadenas fijas en el
 * servicio: el respaldo a `es` se aplica si falta el `locale`, si no es `es`/`en`
 * o si no existe la plantilla en el idioma pedido.
 */
export type NotificationLocale = "es" | "en";

export interface BookingConfirmationData {
  code: string;
  productTitle: string;
  checkIn: string;
  checkOut: string;
  totalUsd: string;
  totalVes: string;
  voucherUrl: string;
}

export interface NotificationContent {
  subject: string;
  body: string;
}

export type ConfirmationTemplate = (data: BookingConfirmationData) => NotificationContent;

export const confirmationTemplates: Record<NotificationLocale, ConfirmationTemplate> = {
  es: (data) => ({
    subject: `Reserva confirmada ${data.code}`,
    body:
      `Tu reserva ${data.code} está confirmada. ${data.productTitle}, ` +
      `del ${data.checkIn} al ${data.checkOut}. ` +
      `Total: USD ${data.totalUsd} (Bs ${data.totalVes}). ` +
      `Voucher: ${data.voucherUrl}`,
  }),
  en: (data) => ({
    subject: `Booking confirmed ${data.code}`,
    body:
      `Your booking ${data.code} is confirmed. ${data.productTitle}, ` +
      `from ${data.checkIn} to ${data.checkOut}. ` +
      `Total: USD ${data.totalUsd} (Bs ${data.totalVes}). ` +
      `Voucher: ${data.voucherUrl}`,
  }),
};

/** Normaliza cualquier valor del usuario al par que admite la base de datos. */
export function notificationLocale(locale: string | null | undefined): NotificationLocale {
  return locale === "en" ? "en" : "es";
}

/**
 * El catálogo se inyecta para poder probar el respaldo sin quitar archivos.
 * Nunca se le pasan viajeros, tarjetas ni tokens: solo la instantánea mínima.
 */
export function bookingConfirmationContent(
  locale: string | null | undefined,
  data: BookingConfirmationData,
  templates: Readonly<Partial<Record<NotificationLocale, ConfirmationTemplate>>> = confirmationTemplates,
): NotificationContent {
  const template = templates[notificationLocale(locale)] ?? templates.es;
  if (!template) throw new Error("Falta la plantilla de confirmación en español");
  return template(data);
}
