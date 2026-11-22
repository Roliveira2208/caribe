import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  formatAmount,
  formatRate,
  formatTimestamp,
  formatValueDate,
  paymentReference,
  type DecimalValue,
  type PaymentBody,
  type PaymentIntent,
  type PaymentMethodValue,
  type PaymentProvider,
  type PaymentStatusValue,
  type RefundIntent,
} from "@caribe/shared";
import { runAfterCommit } from "../audit/audit-storage.js";
import { AuditService } from "../audit/audit.service.js";
import {
  parsePolicySnapshot,
  refundAmounts,
  refundPercentage,
} from "../bookings/cancellation-policy.js";
import type { BookingStatusValue } from "../bookings/bookings.schemas.js";
import {
  DocumentIssuanceService,
  type ReservedDocument,
} from "../documents/document-issuance.service.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { Prisma } from "../generated/prisma/client.js";
import { JobsScheduler } from "../jobs/jobs.scheduler.js";
import {
  NotificationService,
  type ReservedNotification,
} from "../notifications/notification.service.js";
import {
  claimIdempotencyKey,
  idempotencyKeyWhere,
  isUniqueViolation,
  releaseIdempotencyKey,
  requireIdempotencyKey,
} from "../idempotency/idempotency.js";
import { ExchangeRateService } from "../rates/exchange-rate.service.js";
import { TENANT_SETTINGS_DEFAULTS } from "../tenant-settings/tenant-settings.schemas.js";
import { TenantService } from "../tenant/tenant.service.js";
import type { PaymentActor } from "./payments.guard.js";
import { decodePaymentsCursor, encodePaymentsCursor } from "./payments.cursor.js";
import {
  PAYMENT_CREATE_ENDPOINT,
  PAYMENTS_DEFAULT_LIMIT,
  hashPaymentRequest,
  parseStoredPaymentResponse,
  type BookingPaymentsResponse,
  type BookingRefundEstimate,
  type ListPaymentsQuery,
  type PaymentPage,
  type PaymentResponse,
  type RefundResponse,
} from "./payments.schemas.js";

/** Token de inyección de la pasarela (la interfaz se borra en runtime). */
export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

/** Reserva con los datos que necesita un pago. */
interface PayableBookingRow {
  id: string;
  tenant_id: string;
  status: BookingStatusValue;
  total_usd: DecimalValue;
  is_expired: boolean;
}

/** Fila de pago tal como la devuelve Prisma. */
interface PaymentRow {
  id: string;
  tenantId: string;
  bookingId: string;
  method: PaymentMethodValue;
  status: PaymentStatusValue;
  amountUsd: DecimalValue;
  amountVes: DecimalValue;
  rate: DecimalValue;
  valueDate: Date;
  reference: string | null;
  reportedBy: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

/** Estado que se audita al revisar un pago. */
interface PaymentReviewState {
  status: PaymentStatusValue;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  bookingStatus: BookingStatusValue;
}

/** Resultado de una revisión: pago serializado y estados para la auditoría. */
export interface ReviewResult {
  payment: PaymentResponse;
  before: PaymentReviewState;
  after: PaymentReviewState;
}

/** Datos del reembolso que emite la cancelación de una reserva (T-F1-10). */
export interface CancellationRefundParams {
  tenantId: string;
  bookingId: string;
  actorId: string;
}

/** Datos de una transacción de alta de pago. */
interface PayParams {
  userId: string;
  tenantId: string;
  bookingId: string;
  key: string;
  body: PaymentBody;
  ip: string | null;
}

/** Resultado interno del alta: pago serializado, documentos y aviso a encolar. */
interface PayResult {
  payment: PaymentResponse;
  documents: ReservedDocument[];
  notification: ReservedNotification | null;
}

/**
 * Pagos (T-F1-9, specs/payments y design §7).
 *
 * El alta la hace el dueño de la reserva: la agencia sale de la reserva, no de
 * la organización activa. El servidor calcula `amount_usd` (total de la
 * reserva), congela la tasa vigente de la agencia y calcula `amount_ves`; el
 * cliente solo aporta método y referencia. La reserva se bloquea con
 * `FOR UPDATE` antes de escribir el pago, de modo que la carrera con la
 * expiración la gana una sola transacción.
 *
 * La revisión la hace un Admin de la agencia distinto de quien reportó, en la
 * transacción que abre el interceptor de auditoría; aprobar confirma la
 * reserva y auditar el pago se confirman juntos o ninguno.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly tenantService: TenantService,
    private readonly auditService: AuditService,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly documents: DocumentIssuanceService,
    private readonly jobs: JobsScheduler,
    private readonly notifications: NotificationService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Reserva el voucher y el comprobante DENTRO de la transacción que aprueba
   * el pago (T-F1-11f, spec documents "Voucher" y "Comprobante de pago"). Si
   * la transacción se revierte, las dos filas `PENDING` desaparecen con ella;
   * la numeración corre a cargo de `DocumentIssuanceService` bajo `FOR UPDATE`.
   */
  private async reserveDocuments(
    tx: Prisma.TransactionClient,
    tenantId: string,
    bookingId: string,
    paymentId: string,
  ): Promise<ReservedDocument[]> {
    const voucher = await this.documents.reserve(tx, {
      tenantId,
      bookingId,
      type: "VOUCHER",
    });
    const receipt = await this.documents.reserve(tx, {
      tenantId,
      bookingId,
      paymentId,
      type: "RECEIPT",
    });
    return [voucher, receipt];
  }

  /**
   * Encola los renders generados por una aprobación. Un fallo de Redis no debe
   * convertir un pago aprobado en un error de la API: se registra y la fila
   * queda `PENDING` para reintentarla al configurar la cola.
   */
  private async enqueueDocumentRenders(documents: ReservedDocument[]): Promise<void> {
    for (const document of documents) {
      try {
        await this.jobs.enqueueDocumentRender({
          documentId: document.id,
          tenantId: document.tenantId,
        });
      } catch (error) {
        this.logger.error(`No se pudo encolar el documento ${document.id}: ${String(error)}`);
      }
    }
  }

  /**
   * Reserva el único aviso de F1 DENTRO de la transacción que confirma la
   * reserva (T-F1-12, spec notifications "Idempotencia de los avisos"). Si la
   * transacción se revierte, la fila `PENDING` desaparece con ella.
   */
  private async reserveNotification(
    tx: Prisma.TransactionClient,
    tenantId: string,
    bookingId: string,
    userId: string,
  ): Promise<ReservedNotification> {
    return this.notifications.reserve(tx, { tenantId, bookingId, userId });
  }

  /** Encola el aviso tras el commit; un fallo de Redis no deshace la reserva. */
  private async enqueueNotification(notification: ReservedNotification): Promise<void> {
    try {
      await this.jobs.enqueueNotification({
        notificationId: notification.id,
        tenantId: notification.tenantId,
      });
    } catch (error) {
      this.logger.error(`No se pudo encolar el aviso ${notification.id}: ${String(error)}`);
    }
  }

  /** Alta de un pago de una reserva propia (spec payments, "Creación de pago"). */
  async create(input: {
    userId: string;
    bookingId: string;
    idempotencyKey: string | undefined;
    body: PaymentBody;
    ip: string | null;
  }): Promise<PaymentResponse> {
    const key = requireIdempotencyKey(input.idempotencyKey);
    const requestHash = hashPaymentRequest(input.bookingId, input.body);
    const claim = await claimIdempotencyKey({
      tenantService: this.tenantService,
      userId: input.userId,
      endpoint: PAYMENT_CREATE_ENDPOINT,
      key,
      requestHash,
      parseResponse: parseStoredPaymentResponse,
    });

    if (claim.kind === "reused") {
      throw new ApiProblemException(
        "IDEMPOTENCY_KEY_REUSED",
        "La clave de idempotencia ya se usó con otro cuerpo.",
      );
    }
    if (claim.kind === "in-progress") {
      throw new ApiProblemException(
        "IDEMPOTENCY_KEY_IN_PROGRESS",
        "La solicitud con esta clave de idempotencia sigue en curso.",
      );
    }
    if (claim.kind === "replay") {
      // Reintento idéntico: se devuelve el pago ya creado sin una segunda fila
      // ni una segunda auditoría.
      return this.paymentForUser(input.userId, claim.response.id);
    }

    try {
      const booking = await this.ownedBooking(input.userId, input.bookingId);
      if (!booking) throw notFound();
      assertPayable(booking.status, booking.is_expired);

      // T-F1-5b: el alta de pago asegura la tasa del día antes de congelarla.
      // Un fallo del proveedor no lanza: queda el respaldo guardado y, si no
      // hay ninguno, `rateForPayment` responde 503 RATE_UNAVAILABLE.
      await this.exchangeRateService.ensureTodayRate();

      return await this.attemptPayment({
        userId: input.userId,
        tenantId: booking.tenant_id,
        bookingId: input.bookingId,
        key,
        body: input.body,
        ip: input.ip,
      });
    } catch (error) {
      // Una solicitud fallida no deja la clave atrapada en vuelo.
      await releaseIdempotencyKey(
        this.tenantService,
        input.userId,
        PAYMENT_CREATE_ENDPOINT,
        key,
      ).catch(() => undefined);
      throw error;
    }
  }

  /** Pagos de una reserva propia (el personal usa /admin/payments). */
  async listForBooking(input: {
    userId: string;
    bookingId: string;
  }): Promise<BookingPaymentsResponse> {
    const booking = await this.tenantService.withOwner(input.userId, (tx) =>
      tx.booking.findFirst({
        where: { id: input.bookingId, userId: input.userId },
        select: { id: true, tenantId: true },
      }),
    );
    if (!booking) throw notFound();

    const rows = await this.tenantService.withOwner(input.userId, (tx) =>
      tx.payment.findMany({
        where: { bookingId: booking.id, tenantId: booking.tenantId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
    return { items: rows.map(toPaymentResponse) };
  }

  /** Listado del panel: agencia activa o todas las agencias (Super Admin). */
  async listAdmin(actor: PaymentActor, query: ListPaymentsQuery): Promise<PaymentPage> {
    const limit = query.limit ?? PAYMENTS_DEFAULT_LIMIT;
    const cursor = query.cursor ? decodePaymentsCursor(query.cursor) : null;
    const where: Prisma.PaymentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.bookingId ? { bookingId: query.bookingId } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
      ...(actor.tenantId ? { tenantId: actor.tenantId } : {}),
    };
    const orderBy: Prisma.PaymentOrderByWithRelationInput[] = [
      { createdAt: "desc" },
      { id: "desc" },
    ];

    const rows = actor.tenantId
      ? await this.tenantService.withTenant(actor.tenantId, (tx) =>
          tx.payment.findMany({ where, orderBy, take: limit + 1 }),
        )
      : await this.tenantService.withPlatform((tx) =>
          tx.payment.findMany({ where, orderBy, take: limit + 1 }),
        );

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toPaymentResponse),
      nextCursor:
        rows.length > limit && last
          ? encodePaymentsCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** Detalle de un pago del panel; fuera de alcance responde 404. */
  async detailAdmin(actor: PaymentActor, paymentId: string): Promise<PaymentResponse> {
    const tenantId = actor.tenantId;
    const row = tenantId
      ? await this.tenantService.withTenant(tenantId, (tx) =>
          tx.payment.findFirst({ where: { id: paymentId, tenantId } }),
        )
      : await this.tenantService.withPlatform((tx) =>
          tx.payment.findFirst({ where: { id: paymentId } }),
        );
    if (!row) throw notFound();
    return toPaymentResponse(row);
  }

  /**
   * Aprueba o rechaza un pago dentro de la transacción auditable (spec
   * payments, "Modo de aprobación" y "Máquina de estados del pago").
   *
   * El orden de bloqueo es `bookings` y después `payments`: la segunda
   * revisión concurrente espera, ve el estado ya cambiado y responde 409
   * `PAYMENT_ALREADY_REVIEWED`. Un estado terminal observado en la lectura
   * inicial responde 409 `INVALID_STATE_TRANSITION`.
   */
  async review(
    tx: Prisma.TransactionClient,
    actor: PaymentActor,
    paymentId: string,
    input: { action: "approve" | "reject"; reason?: string },
  ): Promise<ReviewResult> {
    const tenantId = actor.tenantId;
    if (!tenantId) {
      // Red de seguridad: el guard ya rechazó este caso.
      throw new ApiProblemException(
        "FORBIDDEN",
        "La revisión de pagos requiere una agencia activa.",
      );
    }

    const payment = await tx.payment.findFirst({
      where: { id: paymentId, tenantId },
      select: { id: true, bookingId: true, reportedBy: true, status: true },
    });
    if (!payment) throw notFound();
    if (payment.reportedBy === actor.userId) {
      throw new ApiProblemException("FORBIDDEN", "Nadie revisa su propio pago.");
    }
    if (payment.status !== "IN_REVIEW") {
      throw new ApiProblemException(
        "INVALID_STATE_TRANSITION",
        "El pago no está en revisión.",
      );
    }

    // Bloqueo en el orden de design §4: primero la reserva, luego el pago.
    const bookings = await tx.$queryRaw<Array<{ status: BookingStatusValue; is_expired: boolean }>>(
      Prisma.sql`
        SELECT "status"::text AS status,
               ("expires_at" <= (now() AT TIME ZONE 'UTC')) AS is_expired
          FROM "bookings"
         WHERE "id" = ${payment.bookingId}
         FOR UPDATE
      `,
    );
    const booking = bookings[0];
    if (!booking) throw notFound();

    const locked = await tx.$queryRaw<Array<{ status: PaymentStatusValue }>>(Prisma.sql`
      SELECT "status"::text AS status
        FROM "payments"
       WHERE "id" = ${paymentId}
       FOR UPDATE
    `);
    if (locked[0]?.status !== "IN_REVIEW") {
      throw new ApiProblemException(
        "PAYMENT_ALREADY_REVIEWED",
        "Otra revisión ya resolvió el pago.",
      );
    }

    const reviewedAt = new Date();
    const before: PaymentReviewState = {
      status: payment.status,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      bookingStatus: booking.status,
    };

    if (input.action === "approve") {
      if (booking.status === "EXPIRED" || booking.is_expired) {
        throw new ApiProblemException("HOLD_EXPIRED", "La reserva ya venció.");
      }
      if (booking.status === "CANCELLED") {
        throw new ApiProblemException("BOOKING_CANCELLED", "La reserva está cancelada.");
      }
      if (booking.status !== "PENDING_PAYMENT") {
        throw new ApiProblemException("BOOKING_ALREADY_PAID", "La reserva ya está pagada.");
      }

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: "APPROVED",
          reviewedBy: actor.userId,
          reviewedAt,
          paidAt: reviewedAt,
          rejectionReason: null,
        },
      });
      await tx.booking.update({
        where: { id: payment.bookingId },
        data: { status: "CONFIRMED" },
      });
      const documents = await this.reserveDocuments(
        tx,
        tenantId,
        payment.bookingId,
        paymentId,
      );
      const notification = await this.reserveNotification(
        tx,
        tenantId,
        payment.bookingId,
        payment.reportedBy,
      );
      // El render y el correo se encolan solo después de que el interceptor
      // confirme pago, reserva, documentos, aviso y auditoría en la transacción.
      runAfterCommit(() => this.enqueueDocumentRenders(documents));
      runAfterCommit(() => this.enqueueNotification(notification));
    } else {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: "REJECTED",
          reviewedBy: actor.userId,
          reviewedAt,
          rejectionReason: input.reason ?? null,
        },
      });
    }

    const updated = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    return {
      payment: toPaymentResponse(updated),
      before,
      after: {
        status: updated.status,
        reviewedBy: updated.reviewedBy,
        reviewedAt: updated.reviewedAt ? formatTimestamp(updated.reviewedAt) : null,
        rejectionReason: updated.rejectionReason,
        bookingStatus: input.action === "approve" ? "CONFIRMED" : booking.status,
      },
    };
  }

  /**
   * Estimación de reembolso para el detalle de la reserva (T-F1-14a). Lee el
   * pago y el `policy_snapshot` congelados y calcula con `Decimal`; no escribe
   * filas, no llama a la pasarela y no cambia estados. La web solo muestra el
   * resultado: no recalcula montos ni tasas.
   */
  async estimateRefundForCancellation(
    tx: Prisma.TransactionClient,
    params: { tenantId: string; bookingId: string },
  ): Promise<BookingRefundEstimate> {
    const payments = await tx.payment.findMany({
      where: { bookingId: params.bookingId, tenantId: params.tenantId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const payment =
      payments.find((candidate) => candidate.status === "APPROVED") ??
      payments.find((candidate) => candidate.status === "IN_REVIEW") ??
      payments.find((candidate) => candidate.status === "PENDING") ??
      null;
    if (!payment) return { paymentStatus: null, refundEstimate: null };

    const item = await tx.bookingItem.findFirst({
      where: { bookingId: params.bookingId, tenantId: params.tenantId },
      orderBy: { checkIn: "asc" },
      select: { checkIn: true, policySnapshot: true },
    });
    if (!item) return { paymentStatus: payment.status, refundEstimate: null };

    const snapshot = parsePolicySnapshot(item.policySnapshot);
    const percentage = refundPercentage(snapshot.rules, formatValueDate(item.checkIn), new Date());
    if (percentage <= 0) return { paymentStatus: payment.status, refundEstimate: null };

    const amounts = refundAmounts(payment.amountUsd, percentage, payment.rate);
    return {
      paymentStatus: payment.status,
      refundEstimate: {
        amountUsd: amounts.amountUsd,
        amountVes: amounts.amountVes,
        rate: formatRate(payment.rate),
        valueDate: formatValueDate(payment.valueDate),
        percentage,
      },
    };
  }

  /**
   * Reembolso de la cancelación (T-F1-10, specs/payments "Reembolso").
   *
   * Corre DENTRO de la transacción de la reserva: el cupo, el estado de la
   * reserva, el reembolso y la auditoría se confirman juntos o ninguno. El
   * porcentaje sale del `policy_snapshot` congelado en la línea; los montos se
   * calculan desde el USD del pago y su tasa congelada. Un 0 % no escribe fila
   * y deja el pago `APPROVED`.
   *
   * Un pago `IN_REVIEW` impide cancelar (`PAYMENT_IN_REVIEW`); un pago ya
   * reembolsado sin la reserva cancelada responde `REFUND_ALREADY_ISSUED`.
   */
  async refundForCancellation(
    tx: Prisma.TransactionClient,
    params: CancellationRefundParams,
  ): Promise<RefundResponse | null> {
    const payments = await tx.payment.findMany({
      where: { bookingId: params.bookingId, tenantId: params.tenantId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    if (payments.some((payment) => payment.status === "IN_REVIEW")) {
      throw new ApiProblemException(
        "PAYMENT_IN_REVIEW",
        "La reserva tiene un pago en revisión; no se puede cancelar todavía.",
      );
    }
    if (
      payments.some(
        (payment) =>
          payment.status === "REFUNDED" || payment.status === "PARTIALLY_REFUNDED",
      )
    ) {
      throw new ApiProblemException(
        "REFUND_ALREADY_ISSUED",
        "El pago de la reserva ya tiene un reembolso.",
      );
    }

    const payment = payments.find((candidate) => candidate.status === "APPROVED");
    if (!payment) return null;

    const item = await tx.bookingItem.findFirst({
      where: { bookingId: params.bookingId, tenantId: params.tenantId },
      orderBy: { checkIn: "asc" },
      select: { checkIn: true, policySnapshot: true },
    });
    if (!item) return null;

    const snapshot = parsePolicySnapshot(item.policySnapshot);
    const percentage = refundPercentage(
      snapshot.rules,
      formatValueDate(item.checkIn),
      new Date(),
    );
    if (percentage <= 0) return null;

    const amounts = refundAmounts(payment.amountUsd, percentage, payment.rate);
    const reason = `Cancelación de la reserva (${percentage}%)`;
    const intent: RefundIntent = {
      paymentId: payment.id,
      amountUsd: amounts.amountUsd,
      amountVes: amounts.amountVes,
      rate: formatRate(payment.rate),
      reason,
    };
    // La pasarela confirma el reembolso antes de persistirlo; si falla, la
    // transacción entera se revierte.
    await this.provider.refund(intent);

    const refundId = randomUUID();
    const createdAt = new Date();
    await tx.refund.create({
      data: {
        id: refundId,
        tenantId: params.tenantId,
        paymentId: payment.id,
        bookingId: params.bookingId,
        amountUsd: new Prisma.Decimal(amounts.amountUsd),
        amountVes: new Prisma.Decimal(amounts.amountVes),
        exchangeRateId: payment.exchangeRateId,
        rate: payment.rate,
        valueDate: payment.valueDate,
        reason,
        createdBy: params.actorId,
        createdAt,
      },
    });

    const paymentStatus =
      new Prisma.Decimal(amounts.amountUsd).equals(
        new Prisma.Decimal(payment.amountUsd.toString()),
      )
        ? "REFUNDED"
        : "PARTIALLY_REFUNDED";
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: paymentStatus },
    });

    return {
      id: refundId,
      amountUsd: amounts.amountUsd,
      amountVes: amounts.amountVes,
      rate: formatRate(payment.rate),
      valueDate: formatValueDate(payment.valueDate),
      paymentStatus,
    };
  }

  /**
   * Intenta escribir el pago. Un choque con el único parcial de referencia
   * (`tenant_id`, `method`, `reference`) responde 409
   * `DUPLICATE_PAYMENT_REFERENCE`; el rollback deshace todo.
   */
  private async attemptPayment(params: PayParams): Promise<PaymentResponse> {
    try {
      const result = await this.tenantService.withOwnerTenant(params.userId, params.tenantId, (tx) =>
        this.pay(tx, params),
      );
      // En modo AUTO no hay interceptor de auditoría: la transacción de
      // `withOwnerTenant` ya se confirmó al resolver, así que aquí es seguro
      // encolar los documentos y el aviso reservados dentro de ella.
      await this.enqueueDocumentRenders(result.documents);
      if (result.notification) await this.enqueueNotification(result.notification);
      return result.payment;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiProblemException(
          "DUPLICATE_PAYMENT_REFERENCE",
          "Ya existe un pago con esa referencia en la agencia.",
        );
      }
      throw error;
    }
  }

  /** Una transacción completa de alta de pago. */
  private async pay(tx: Prisma.TransactionClient, params: PayParams): Promise<PayResult> {
    const rows = await tx.$queryRaw<PayableBookingRow[]>(Prisma.sql`
      SELECT "id" AS id,
             "tenant_id" AS tenant_id,
             "status"::text AS status,
             "total_usd" AS total_usd,
             ("expires_at" <= (now() AT TIME ZONE 'UTC')) AS is_expired
        FROM "bookings"
       WHERE "id" = ${params.bookingId}
         AND "user_id" = ${params.userId}
       FOR UPDATE
    `);
    const booking = rows[0];
    if (!booking) throw notFound();
    // La reserva pudo vencer o cambiar de estado entre la lectura y el bloqueo.
    assertPayable(booking.status, booking.is_expired);

    const settings = await tx.tenantSettings.findUnique({
      where: { tenantId: params.tenantId },
      select: { paymentMode: true },
    });
    const paymentMode = settings?.paymentMode ?? TENANT_SETTINGS_DEFAULTS.paymentMode;

    // La tasa se congela dentro de la transacción: agencia > global; sin
    // ninguna, 503 RATE_UNAVAILABLE y no se crea el pago.
    const rate = await this.exchangeRateService.rateForPayment(tx, params.tenantId);

    const amountUsd = new Prisma.Decimal(booking.total_usd.toString());
    const amountVes = amountUsd
      .times(new Prisma.Decimal(rate.rate))
      .toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
    const amountUsdText = amountUsd.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
    const reference = paymentReference(params.body);

    const intent: PaymentIntent = {
      bookingId: params.bookingId,
      tenantId: params.tenantId,
      method: params.body.method,
      reference,
      amountUsd: amountUsdText,
      amountVes,
      rate: rate.rate,
      autoApprove: paymentMode === "AUTO",
    };
    const providerPayment = await this.provider.createPayment(intent);

    const paymentId = randomUUID();
    const createdAt = new Date();

    await tx.payment.create({
      data: {
        id: paymentId,
        tenantId: params.tenantId,
        bookingId: params.bookingId,
        method: params.body.method,
        amountUsd: new Prisma.Decimal(amountUsdText),
        amountVes: new Prisma.Decimal(amountVes),
        exchangeRateId: rate.id,
        rate: new Prisma.Decimal(rate.rate),
        valueDate: new Date(`${rate.valueDate}T00:00:00.000Z`),
        reference,
        // PENDING es interno: la transacción lo deja en el estado visible.
        status: "PENDING",
        reportedBy: params.userId,
        createdAt,
      },
    });

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: providerPayment.status,
        paidAt: providerPayment.status === "APPROVED" ? createdAt : null,
      },
    });

    let documents: ReservedDocument[] = [];
    let notification: ReservedNotification | null = null;
    if (providerPayment.status === "APPROVED") {
      await tx.booking.update({
        where: { id: params.bookingId },
        data: { status: "CONFIRMED" },
      });
      documents = await this.reserveDocuments(
        tx,
        params.tenantId,
        params.bookingId,
        paymentId,
      );
      notification = await this.reserveNotification(
        tx,
        params.tenantId,
        params.bookingId,
        params.userId,
      );
    }

    await this.auditService.record(tx, {
      tenantId: params.tenantId,
      actorId: params.userId,
      action: "payment.create",
      entity: "payment",
      entityId: paymentId,
      before: null,
      after: {
        bookingId: params.bookingId,
        method: params.body.method,
        status: providerPayment.status,
        amountUsd: amountUsdText,
        amountVes,
        rate: rate.rate,
        reference,
      },
      ip: params.ip,
    });

    // La respuesta guardada es mínima: solo id y estado (spec booking,
    // "Respuesta guardada mínima").
    await tx.idempotencyKey.update({
      where: idempotencyKeyWhere(params.userId, PAYMENT_CREATE_ENDPOINT, params.key),
      data: {
        responseStatus: 201,
        responseBody: { id: paymentId, status: providerPayment.status },
      },
    });

    const created = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    return { payment: toPaymentResponse(created), documents, notification };
  }

  /** Reserva propia con su estado de vencimiento, leída en el contexto `owner`. */
  private async ownedBooking(
    userId: string,
    bookingId: string,
  ): Promise<PayableBookingRow | null> {
    const rows = await this.tenantService.withOwner(userId, (tx) =>
      tx.$queryRaw<PayableBookingRow[]>(Prisma.sql`
        SELECT "id" AS id,
               "tenant_id" AS tenant_id,
               "status"::text AS status,
               "total_usd" AS total_usd,
               ("expires_at" <= (now() AT TIME ZONE 'UTC')) AS is_expired
          FROM "bookings"
         WHERE "id" = ${bookingId}
           AND "user_id" = ${userId}
         LIMIT 1
      `),
    );
    return rows[0] ?? null;
  }

  /** Pago propio ya creado (reintento idempotente). */
  private async paymentForUser(userId: string, paymentId: string): Promise<PaymentResponse> {
    const row = await this.tenantService.withOwner(userId, (tx) =>
      tx.payment.findFirst({ where: { id: paymentId, reportedBy: userId } }),
    );
    if (!row) throw notFound();
    return toPaymentResponse(row);
  }
}

/** Solo una reserva `PENDING_PAYMENT` y no vencida se puede pagar. */
function assertPayable(status: BookingStatusValue, isExpired: boolean): void {
  if (status === "EXPIRED") {
    throw new ApiProblemException("HOLD_EXPIRED", "La reserva ya venció.");
  }
  if (status === "CANCELLED") {
    throw new ApiProblemException("BOOKING_CANCELLED", "La reserva está cancelada.");
  }
  if (status === "CONFIRMED") {
    throw new ApiProblemException("BOOKING_ALREADY_PAID", "La reserva ya está pagada.");
  }
  if (isExpired) {
    throw new ApiProblemException("HOLD_EXPIRED", "La reserva ya venció.");
  }
}

function notFound(): ApiProblemException {
  return new ApiProblemException("NOT_FOUND", "El pago o la reserva no existe.");
}

/** Fila de pago -> respuesta con montos (2), tasa (4) y fechas ISO. */
function toPaymentResponse(row: PaymentRow): PaymentResponse {
  return {
    id: row.id,
    bookingId: row.bookingId,
    method: row.method,
    status: row.status,
    amountUsd: formatAmount(row.amountUsd),
    amountVes: formatAmount(row.amountVes),
    rate: formatRate(row.rate),
    valueDate: formatValueDate(row.valueDate),
    reference: row.reference,
    reportedBy: row.reportedBy,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? formatTimestamp(row.reviewedAt) : null,
    rejectionReason: row.rejectionReason,
    paidAt: row.paidAt ? formatTimestamp(row.paidAt) : null,
    createdAt: formatTimestamp(row.createdAt),
  };
}
