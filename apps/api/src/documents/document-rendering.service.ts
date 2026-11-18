import { Inject, Injectable } from "@nestjs/common";
import { formatValueDate } from "@caribe/shared";
import { parsePolicySnapshot, type CancellationRule } from "../bookings/cancellation-policy.js";
import { travelerSchema } from "../bookings/bookings.schemas.js";
import { apiConfig } from "../config.js";
import {
  DOCUMENT_JOB_ATTEMPTS,
  DOCUMENT_JOB_DELAYS,
  type RenderDocumentPayload,
} from "../jobs/jobs.constants.js";
import { Prisma, type DocumentType } from "../generated/prisma/client.js";
import { TenantService } from "../tenant/tenant.service.js";
import { voucherQrUrl } from "./free-form-receipt.provider.js";
import {
  INVOICE_PROVIDER,
  type FrozenBooking,
  type FrozenPayment,
  type InvoiceProvider,
} from "./invoice-provider.js";

/** Resultado observable de un intento de renderizado. */
export interface RenderResult {
  documentId: string;
  status: "READY" | "FAILED";
  attempts: number;
  fileUrl: string | null;
  error: string | null;
}

/** Opciones para ejecutar los reintentos sin esperar de verdad en las pruebas. */
export interface RenderRetryOptions {
  attempts?: number;
  delays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "error desconocido";
}

/** El enum de Prisma incluye REFUND_NOTE; F1 solo emite voucher y recibo. */
function documentTypeOf(type: DocumentType): "VOUCHER" | "RECEIPT" {
  if (type === "REFUND_NOTE") throw new Error("Las notas de reembolso no se emiten en F1");
  return type;
}

function titleOf(value: Prisma.JsonValue): { es: string; en: string } {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record["es"] === "string" && typeof record["en"] === "string") {
      return { es: record["es"], en: record["en"] };
    }
  }
  return { es: "", en: "" };
}

/**
 * Renderiza los PDF pendientes y gestiona su ciclo de vida (T-F1-11d, spec
 * documents "Ciclo de vida del documento", "Generación fallida" y
 * "Reintentos automáticos").
 *
 * Lee la instantánea congelada dentro de `withTenant` (RLS), genera el archivo
 * FUERA de la transacción para no retener la conexión durante la escritura y
 * marca `READY` en una segunda transacción con `status: PENDING` en el `WHERE`:
 * dos trabajos simultáneos no se pisan y un documento ya `READY` no se
 * regenera. Los fallos se registran en `documents.error` y, tras los 3
 * intentos, la fila queda `FAILED` sin tocar la reserva ni el pago.
 *
 * El servicio se expone para que el e2e lo invoque directamente: en pruebas no
 * hay Redis y BullMQ no arranca.
 */
@Injectable()
export class DocumentRenderingService {
  constructor(
    private readonly tenants: TenantService,
    @Inject(INVOICE_PROVIDER) private readonly invoice: InvoiceProvider,
  ) {}

  /** Un intento: construye la instantánea, emite el PDF y marca `READY`. */
  async render(documentId: string, tenantId: string): Promise<RenderResult> {
    const snapshot = await this.tenants.withTenant(tenantId, (tx) =>
      this.freeze(tx, documentId, tenantId),
    );

    if (snapshot.alreadyReady) {
      return {
        documentId,
        status: "READY",
        attempts: 0,
        fileUrl: snapshot.fileUrl,
        error: null,
      };
    }

    const issued = await this.invoice.issue(snapshot.booking, snapshot.payment);
    await this.tenants.withTenant(tenantId, (tx) =>
      tx.document.updateMany({
        where: { id: documentId, tenantId, status: "PENDING" },
        data: {
          status: "READY",
          fileUrl: issued.fileUrl,
          issuedAt: issued.issuedAt,
          error: null,
        },
      }),
    );
    return {
      documentId,
      status: "READY",
      attempts: 1,
      fileUrl: issued.fileUrl,
      error: null,
    };
  }

  /**
   * Hasta 3 intentos con espera creciente. `sleep` se inyecta para verificar
   * los retardos sin dormir de verdad; los valores por defecto son los del
   * trabajo BullMQ (design §9).
   */
  async renderWithRetries(
    documentId: string,
    tenantId: string,
    options: RenderRetryOptions = {},
  ): Promise<RenderResult> {
    const attempts = options.attempts ?? DOCUMENT_JOB_ATTEMPTS;
    const delays = options.delays ?? DOCUMENT_JOB_DELAYS;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    let lastMessage = "No se pudo generar el documento";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await this.render(documentId, tenantId);
        return { ...result, attempts: attempt };
      } catch (error) {
        lastMessage = messageOf(error);
        await this.recordFailure(documentId, tenantId, lastMessage, attempt === attempts);
        if (attempt < attempts) await sleep(delays[attempt - 1] ?? 0);
      }
    }
    return {
      documentId,
      status: "FAILED",
      attempts,
      fileUrl: null,
      error: lastMessage,
    };
  }

  /** Registra el fallo; en el último intento además marca la fila `FAILED`. */
  private async recordFailure(
    documentId: string,
    tenantId: string,
    message: string,
    final: boolean,
  ): Promise<void> {
    await this.tenants.withTenant(tenantId, (tx) =>
      tx.document.updateMany({
        where: { id: documentId, tenantId, status: "PENDING" },
        data: final ? { status: "FAILED", error: message } : { error: message },
      }),
    );
  }

  /** Datos de la fila ya lista, para no volver a emitir un PDF existente. */
  private async freeze(
    tx: Prisma.TransactionClient,
    documentId: string,
    tenantId: string,
  ): Promise<
    | { alreadyReady: true; fileUrl: string }
    | { alreadyReady: false; booking: FrozenBooking; payment?: FrozenPayment }
  > {
    const document = await tx.document.findFirst({ where: { id: documentId, tenantId } });
    if (!document) throw new Error(`El documento ${documentId} no pertenece a la agencia ${tenantId}`);
    if (document.status === "READY") {
      if (!document.fileUrl) throw new Error("El documento READY no tiene archivo");
      return { alreadyReady: true, fileUrl: document.fileUrl };
    }
    if (document.status !== "PENDING") {
      throw new Error(`El documento ${documentId} está ${document.status}`);
    }

    const booking = await tx.booking.findFirst({ where: { id: document.bookingId, tenantId } });
    if (!booking) throw new Error("La reserva del documento no existe en la agencia");
    const items = await tx.bookingItem.findMany({
      where: { bookingId: booking.id, tenantId },
      orderBy: { checkIn: "asc" },
    });
    if (items.length === 0) throw new Error("La reserva no tiene líneas para el documento");

    const travelers = travelerSchema.array().safeParse(booking.travelers);
    if (!travelers.success) throw new Error("Los viajeros de la reserva no son válidos");

    const [organization, settings] = await Promise.all([
      tx.organization.findFirst({ where: { id: tenantId }, select: { name: true } }),
      tx.tenantSettings.findUnique({ where: { tenantId } }),
    ]);

    const frozen: FrozenBooking = {
      id: booking.id,
      code: booking.code,
      tenantId,
      totalUsd: booking.totalUsd.toString(),
      travelers: travelers.data,
      items: items.map((item) => ({
        hotelKey: item.hotelKey,
        roomType: item.roomType,
        title: titleOf(item.productTitle),
        checkIn: formatValueDate(item.checkIn),
        checkOut: formatValueDate(item.checkOut),
        quantity: item.quantity,
        subtotalUsd: item.subtotalUsd.toString(),
        policySnapshot: parsePolicySnapshot(item.policySnapshot) as {
          policyId: string | null;
          name: string | null;
          rules: CancellationRule[];
        },
      })),
      agency: {
        name: organization?.name ?? "Caribe",
        legalName: settings?.legalName ?? null,
        rif: settings?.rif ?? null,
        address: settings?.address ?? null,
        phone: settings?.phone ?? null,
        email: settings?.email ?? null,
      },
      document: {
        id: document.id,
        number: document.number,
        type: documentTypeOf(document.type),
      },
      qrUrl: voucherQrUrl(apiConfig.webBaseUrl, booking.code),
    };

    if (document.type !== "RECEIPT") return { alreadyReady: false, booking: frozen };
    if (!document.paymentId) throw new Error("El comprobante no tiene pago asociado");
    const payment = await tx.payment.findFirst({
      where: { id: document.paymentId, tenantId, status: "APPROVED" },
    });
    if (!payment) throw new Error("No se emite comprobante de un pago no aprobado");

    const frozenPayment: FrozenPayment = {
      method: payment.method,
      amountUsd: payment.amountUsd.toString(),
      amountVes: payment.amountVes.toString(),
      rate: payment.rate.toString(),
      valueDate: formatValueDate(payment.valueDate),
      reference: payment.reference,
      paidAt: payment.paidAt?.toISOString() ?? "",
    };
    return { alreadyReady: false, booking: frozen, payment: frozenPayment };
  }
}

/** Cuerpo del trabajo BullMQ; el tenant viaja con el id del documento. */
export type { RenderDocumentPayload };
