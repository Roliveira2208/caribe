import { createTransport, type Transporter } from "nodemailer";
import type { NotificationProvider } from "./notification-provider.js";
import type { NotificationContent } from "./notification-templates.js";

/** Tiempo máximo de cada llamada al servidor SMTP (spec notifications). */
export const NOTIFICATION_TIMEOUT_MS = 5000;

export interface SmtpProviderOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

/** Opciones puras para poder comprobar los tiempos de espera sin red. */
export function smtpTransportOptions(options: SmtpProviderOptions) {
  return {
    host: options.host,
    port: options.port,
    secure: options.port === 465,
    auth: options.user ? { user: options.user, pass: options.password } : undefined,
    connectionTimeout: NOTIFICATION_TIMEOUT_MS,
    greetingTimeout: NOTIFICATION_TIMEOUT_MS,
    socketTimeout: NOTIFICATION_TIMEOUT_MS,
  };
}

/**
 * Transporte SMTP del MVP: Mailpit en desarrollo y el servidor que configure
 * el despliegue. Los reintentos y el registro de fallos viven en
 * `NotificationService`; aquí solo se envía una vez con un límite de 5 s.
 */
export class SmtpNotificationProvider implements NotificationProvider {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(options: SmtpProviderOptions) {
    this.transporter = createTransport(smtpTransportOptions(options));
    this.from = options.from;
  }

  async send(template: NotificationContent, recipient: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: recipient,
      subject: template.subject,
      text: template.body,
    });
  }
}
