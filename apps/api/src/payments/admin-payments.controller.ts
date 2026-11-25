import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { attachAuditData, currentAuditTx } from "../audit/audit-storage.js";
import { Auditable } from "../audit/auditable.js";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import { BusinessRateLimit } from "../security/business-rate-limit.js";
import { ActiveMembershipGuard } from "../tenant/active-membership.guard.js";
import { PaymentPermission, PaymentsGuard, paymentActorOf, type PaymentsRequest } from "./payments.guard.js";
import {
  listPaymentsQuerySchema,
  rejectPaymentSchema,
  type ListPaymentsQuery,
  type PaymentPage,
  type PaymentResponse,
  type RejectPaymentBody,
} from "./payments.schemas.js";
import { PaymentsService } from "./payments.service.js";

/**
 * Panel de pagos (T-F1-9, specs/payments "Modo de aprobación" y design §7).
 *
 * Todas las rutas cuelgan de /admin: el guard global exige TOTP a los roles
 * administrativos antes de llegar aquí y `PaymentsGuard` aplica después la
 * matriz `payment:*`.
 *
 * - GET   /admin/payments
 * - GET   /admin/payments/:id
 * - PATCH /admin/payments/:id/approve
 * - PATCH /admin/payments/:id/reject
 *
 * La aprobación y el rechazo van auditados y comparten la transacción del
 * interceptor: el cambio del pago, el de la reserva y la fila de audit_logs se
 * confirman juntos o ninguno.
 */
@Controller("admin/payments")
@UseGuards(ActiveMembershipGuard, PaymentsGuard)
export class AdminPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @PaymentPermission("read")
  list(
    @Req() request: PaymentsRequest,
    @Query(new ZodValidationPipe(listPaymentsQuerySchema)) query: ListPaymentsQuery,
  ): Promise<PaymentPage> {
    return this.paymentsService.listAdmin(paymentActorOf(request), query);
  }

  @Get(":id")
  @PaymentPermission("read")
  detail(
    @Req() request: PaymentsRequest,
    @Param("id") paymentId: string,
  ): Promise<PaymentResponse> {
    return this.paymentsService.detailAdmin(paymentActorOf(request), paymentId);
  }

  @Auditable({ action: "payment.approve", entity: "payment" })
  @Patch(":id/approve")
  @BusinessRateLimit("paymentReviews")
  @PaymentPermission("review")
  @HttpCode(200)
  async approve(
    @Req() request: PaymentsRequest,
    @Param("id") paymentId: string,
  ): Promise<PaymentResponse> {
    const result = await this.paymentsService.review(currentAuditTx(), paymentActorOf(request), paymentId, {
      action: "approve",
    });
    attachAuditData({ entityId: paymentId, before: result.before, after: result.after });
    return result.payment;
  }

  @Auditable({ action: "payment.reject", entity: "payment" })
  @Patch(":id/reject")
  @BusinessRateLimit("paymentReviews")
  @PaymentPermission("review")
  @HttpCode(200)
  async reject(
    @Req() request: PaymentsRequest,
    @Param("id") paymentId: string,
    @Body(new ZodValidationPipe(rejectPaymentSchema)) body: RejectPaymentBody,
  ): Promise<PaymentResponse> {
    const result = await this.paymentsService.review(currentAuditTx(), paymentActorOf(request), paymentId, {
      action: "reject",
      reason: body.reason,
    });
    attachAuditData({ entityId: paymentId, before: result.before, after: result.after });
    return result.payment;
  }
}
