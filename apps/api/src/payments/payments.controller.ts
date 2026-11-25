import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { paymentBodySchema, type PaymentBody } from "@caribe/shared";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import { BusinessRateLimit } from "../security/business-rate-limit.js";
import {
  PaymentPermission,
  PaymentsGuard,
  paymentActorOf,
  type PaymentsRequest,
} from "./payments.guard.js";
import {
  type BookingPaymentsResponse,
  type PaymentResponse,
} from "./payments.schemas.js";
import { PaymentsService } from "./payments.service.js";

/**
 * Pagos de una reserva propia (T-F1-9, specs/payments "Creación de pago" y
 * "Datos por método de pago").
 *
 * - POST /bookings/:id/payments: el dueño reporta un pago con
 *   `Idempotency-Key`; el servidor calcula montos y congela la tasa.
 * - GET  /bookings/:id/payments: el dueño consulta los pagos de su reserva.
 *
 * El acceso `self` solo exige sesión; el servicio responde 404 si la reserva
 * no es del usuario. El personal de la agencia consulta desde /admin/payments.
 */
@Controller("bookings/:id/payments")
@UseGuards(PaymentsGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @BusinessRateLimit("payments")
  @PaymentPermission("self")
  @HttpCode(201)
  create(
    @Req() request: PaymentsRequest,
    @Param("id") bookingId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(paymentBodySchema)) body: PaymentBody,
  ): Promise<PaymentResponse> {
    const actor = paymentActorOf(request);
    return this.paymentsService.create({
      userId: actor.userId,
      bookingId,
      idempotencyKey,
      body,
      ip: request.ip ?? null,
    });
  }

  @Get()
  @PaymentPermission("self")
  list(
    @Req() request: PaymentsRequest,
    @Param("id") bookingId: string,
  ): Promise<BookingPaymentsResponse> {
    const actor = paymentActorOf(request);
    return this.paymentsService.listForBooking({ userId: actor.userId, bookingId });
  }
}
