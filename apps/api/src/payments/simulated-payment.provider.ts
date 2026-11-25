import { Injectable } from "@nestjs/common";
import type {
  PaymentIntent,
  PaymentProvider,
  ProviderPayment,
  ProviderRefund,
  ProviderRefundState,
  RefundIntent,
} from "@caribe/shared";
import { ApiProblemException } from "../errors/api-problem.exception.js";

/**
 * Pasarela simulada de F1 (T-F1-9, design §7), idempotente desde T-F2-5.
 *
 * No hay cobro real: el adaptador devuelve el estado que corresponde al modo
 * de la agencia. En AUTO aprueba al instante; en MANUAL deja el pago en
 * revisión para que lo resuelva un Admin distinto del pagador. Una pasarela
 * real implementa `PaymentProvider` sin tocar el dominio (D9).
 *
 * El mapa en memoria simula el estado del sistema externo: repetir un
 * `refundId` devuelve el resultado original y un `refundId` distinto sobre el
 * mismo pago se rechaza. Es la última red antes de sustituir el adaptador por
 * una pasarela real; la primera es el outbox `refund_dispatches`, escrito en la
 * misma transacción que la cancelación.
 */
@Injectable()
export class SimulatedPaymentProvider implements PaymentProvider {
  private readonly refunds = new Map<string, ProviderRefundState>();
  private readonly refundByPayment = new Map<string, string>();

  async createPayment(intent: PaymentIntent): Promise<ProviderPayment> {
    return {
      status: intent.autoApprove ? "APPROVED" : "IN_REVIEW",
      providerReference: null,
    };
  }

  async confirm(_paymentId: string): Promise<ProviderPayment> {
    return { status: "APPROVED", providerReference: null };
  }

  async refund(intent: RefundIntent): Promise<ProviderRefund> {
    const previous = this.refunds.get(intent.refundId);
    if (previous) {
      return { providerReference: previous.providerReference, status: previous.status };
    }
    const issued = this.refundByPayment.get(intent.paymentId);
    if (issued && issued !== intent.refundId) {
      throw new ApiProblemException(
        "REFUND_ALREADY_ISSUED",
        "El pago ya tiene un reembolso emitido con otro identificador.",
      );
    }
    const state: ProviderRefundState = {
      refundId: intent.refundId,
      providerReference: `sim-${intent.refundId}`,
      status: "COMPLETED",
    };
    this.refunds.set(intent.refundId, state);
    this.refundByPayment.set(intent.paymentId, intent.refundId);
    return { providerReference: state.providerReference, status: state.status };
  }

  async getRefund(refundId: string): Promise<ProviderRefundState | null> {
    return this.refunds.get(refundId) ?? null;
  }
}
