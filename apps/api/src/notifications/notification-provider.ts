import type { NotificationContent } from "./notification-templates.js";

/**
 * Contrato del único canal de F1 (T-F1-12, spec notifications "Proveedor y
 * transporte"). Igual que `InvoiceProvider`, el token separa el dominio del
 * transporte: SMTP entra en producción y un doble en las pruebas, sin que
 * reservas ni pagos conozcan nodemailer.
 *
 * `template` es el contenido ya resuelto en el idioma del destinatario; el
 * proveedor solo transporta. No hay `cc` ni `bcc`: el destinatario es siempre
 * el dueño de la reserva y F1 no copia a la agencia ni a terceros (spec
 * "Destinatario y privacidad").
 */
export const NOTIFICATION_PROVIDER = Symbol("NOTIFICATION_PROVIDER");

export interface NotificationProvider {
  send(template: NotificationContent, recipient: string): Promise<void>;
}
