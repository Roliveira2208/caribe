import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { formatAmount, formatValueDate } from "@caribe/shared";
import { apiConfig } from "../config.js";
import { voucherQrUrl } from "../documents/free-form-receipt.provider.js";
import { Prisma, type NotificationStatus } from "../generated/prisma/client.js";
import {
  NOTIFICATION_JOB_ATTEMPTS,
  NOTIFICATION_JOB_DELAYS,
} from "../jobs/jobs.constants.js";
import { TenantService } from "../tenant/tenant.service.js";
import { NOTIFICATION_PROVIDER, type NotificationProvider } from "./notification-provider.js";
import {
  bookingConfirmationContent,
  notificationLocale,
  type BookingConfirmationData,
  type NotificationContent,
} from "./notification-templates.js";

/** Único evento de F1 (spec notifications, "Confirmación de reserva"). */
export const BOOKING_CONFIRMED_TEMPLATE = "BOOKING_CONFIRMED";

/** Clave de deduplicación por tipo y entidad: una reserva, un solo aviso. */
export function bookingConfirmationDedupeKey(bookingId: string): string {
  return `booking.confirmed:${bookingId}`;
}

/** Datos mínimos y sin PII reservados dentro de la transacción que confirma. */
export interface ReserveNotificationInput {
  tenantId: string;
  bookingId: string;
  userId: string;
}

export interface ReservedNotification {
  id: string;
  tenantId: string;
  dedupeKey: string;
}

/** Resultado observable de un envío (para el trabajo y las pruebas). */
export interface SendResult {
  status: Extract<NotificationStatus, "SENT" | "FAILED">;
  attempts: number;
  sent: boolean;
  error: string | null;
}

/** Instantánea leída bajo RLS; distingue "ya enviado" de "sin reserva que enviar". */
type FrozenNotification =
  | { alreadySent: true; recipient: string }
  | { alreadySent: false; bookingMissing: true }
  | {
      alreadySent: false;
      bookingMissing?: false;
      recipient: string;
      subject: string;
      body: string;
    };

/** Opciones para ejecutar reintentos sin dormir de verdad en las pruebas. */
export interface NotificationRetryOptions {
  attempts?: number;
  delays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "error desconocido";
}

/** Correo mínimo: solo hace falta descartar el caso límite "sin correo válido". */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Título del producto en el idioma del aviso, con respaldo a `es` y `en`. */
function titleOf(value: Prisma.JsonValue, locale: "es" | "en"): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const preferred = record[locale];
    if (typeof preferred === "string" && preferred.length > 0) return preferred;
    if (typeof record.es === "string") return record.es;
    if (typeof record.en === "string") return record.en;
  }
  return "";
}

/**
 * Único aviso transaccional de F1 (T-F1-12, spec notifications).
 *
 * `reserve` se llama DENTRO de la transacción que confirma la reserva: crea la
 * fila `PENDING` con `dedupe_key` único, de modo que si la transacción se
 * revierte el aviso desaparece con ella y un evento repetido nunca genera una
 * segunda fila. El envío ocurre DESPUÉS, desde el trabajo encolado: lee la
 * instantánea mínima bajo RLS, llama al proveedor fuera de la transacción y
 * marca `SENT` en una segunda transacción condicionada a `PENDING`. Un fallo
 * de SMTP se reintenta 3 veces, queda registrado como `FAILED` y no toca ni la
 * reserva ni el pago.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly tenants: TenantService,
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
  ) {}

  /** Reserva el aviso en la misma transacción que confirma la reserva. */
  async reserve(
    tx: Prisma.TransactionClient,
    input: ReserveNotificationInput,
  ): Promise<ReservedNotification> {
    const dedupeKey = bookingConfirmationDedupeKey(input.bookingId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { email: true, locale: true },
    });
    const id = randomUUID();
    await tx.$executeRaw`
      INSERT INTO "notification_logs"
        ("id", "tenant_id", "dedupe_key", "template", "recipient", "locale",
         "status", "attempts", "created_at")
      VALUES (${id}, ${input.tenantId}, ${dedupeKey}, ${BOOKING_CONFIRMED_TEMPLATE},
              ${user.email}, ${notificationLocale(user.locale)},
              'PENDING'::"NotificationStatus", 0, now())
      ON CONFLICT ("dedupe_key") DO NOTHING
    `;
    const stored = await tx.notificationLog.findUniqueOrThrow({ where: { dedupeKey } });
    return { id: stored.id, tenantId: stored.tenantId, dedupeKey: stored.dedupeKey };
  }

  /**
   * Hasta 3 intentos con espera creciente; `sleep` se inyecta para verificar
   * los retardos sin dormir de verdad (igual que el render de documentos).
   */
  async sendWithRetries(
    notificationId: string,
    tenantId: string,
    options: NotificationRetryOptions = {},
  ): Promise<SendResult> {
    const attempts = options.attempts ?? NOTIFICATION_JOB_ATTEMPTS;
    const delays = options.delays ?? NOTIFICATION_JOB_DELAYS;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    const snapshot = await this.tenants.withTenant(tenantId, (tx) =>
      this.freeze(tx, notificationId, tenantId),
    );
    if (snapshot.alreadySent) {
      return { status: "SENT", attempts: 0, sent: false, error: null };
    }
    // Sin reserva no hay nada que congelar ni enviar: fallo terminal, sin reintentos.
    if (snapshot.bookingMissing) {
      const error = "La reserva del aviso ya no existe";
      await this.recordFailure(notificationId, tenantId, error, true);
      return { status: "FAILED", attempts: 1, sent: false, error };
    }
    // Correo inválido: fallo definitivo, sin llamar al proveedor ni reintentar.
    if (!isEmail(snapshot.recipient)) {
      const error = "El destinatario no tiene un correo válido";
      await this.recordFailure(notificationId, tenantId, error, true);
      return { status: "FAILED", attempts: 1, sent: false, error };
    }

    const template: NotificationContent = {
      subject: snapshot.subject,
      body: snapshot.body,
    };
    let lastMessage = "No se pudo enviar el aviso";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.provider.send(template, snapshot.recipient);
        await this.markSent(notificationId, tenantId);
        return { status: "SENT", attempts: attempt, sent: true, error: null };
      } catch (error) {
        lastMessage = messageOf(error);
        await this.recordFailure(notificationId, tenantId, lastMessage, attempt === attempts);
        if (attempt < attempts) await sleep(delays[attempt - 1] ?? 0);
      }
    }
    return { status: "FAILED", attempts, sent: false, error: lastMessage };
  }

  /** Lee la instantánea mínima bajo RLS; no abre el proveedor ni red. */
  private async freeze(
    tx: Prisma.TransactionClient,
    notificationId: string,
    tenantId: string,
  ): Promise<FrozenNotification> {
    const log = await tx.notificationLog.findUniqueOrThrow({ where: { id: notificationId } });
    if (log.tenantId !== tenantId) throw new Error("El aviso pertenece a otra agencia");
    if (log.status === "SENT") return { alreadySent: true, recipient: log.recipient };

    const bookingId = log.dedupeKey.slice(log.dedupeKey.indexOf(":") + 1);
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, tenantId },
      select: { code: true, totalUsd: true },
    });
    if (!booking) return { alreadySent: false, bookingMissing: true };
    const item = await tx.bookingItem.findFirst({
      where: { bookingId, tenantId },
      orderBy: [{ id: "asc" }],
    });
    const payment = await tx.payment.findFirst({
      where: { bookingId, tenantId, status: "APPROVED" },
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
    });

    const locale = notificationLocale(log.locale);
    const data: BookingConfirmationData = {
      code: booking.code,
      productTitle: item ? titleOf(item.productTitle, locale) : "",
      checkIn: item ? formatValueDate(item.checkIn) : "",
      checkOut: item ? formatValueDate(item.checkOut) : "",
      totalUsd: formatAmount(booking.totalUsd),
      totalVes: payment ? formatAmount(payment.amountVes) : "0.00",
      voucherUrl: voucherQrUrl(apiConfig.webBaseUrl, booking.code),
    };
    const content = bookingConfirmationContent(locale, data);
    return {
      alreadySent: false,
      recipient: log.recipient,
      subject: content.subject,
      body: content.body,
    };
  }

  /** Marca `SENT` solo si la fila sigue `PENDING`: dos trabajos no se pisan. */
  private async markSent(notificationId: string, tenantId: string): Promise<void> {
    await this.tenants.withTenant(tenantId, (tx) =>
      tx.notificationLog.updateMany({
        where: { id: notificationId, tenantId, status: "PENDING" },
        data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
      }),
    );
  }

  /** Registra el fallo; en el último intento además marca la fila `FAILED`. */
  private async recordFailure(
    notificationId: string,
    tenantId: string,
    message: string,
    final: boolean,
  ): Promise<void> {
    await this.tenants.withTenant(tenantId, (tx) =>
      tx.notificationLog.updateMany({
        where: { id: notificationId, tenantId, status: { not: "SENT" } },
        data: {
          attempts: { increment: 1 },
          ...(final ? { status: "FAILED" as const } : {}),
          lastError: message.slice(0, 500),
        },
      }),
    );
  }
}
