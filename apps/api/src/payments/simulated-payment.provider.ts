import { Injectable } from "@nestjs/common";
import type {
  PaymentIntent,
  PaymentProvider,
  ProviderPayment,
  ProviderRefund,
  RefundIntent,
} from "@caribe/shared";

/**
 * Pasarela simulada de F1 (T-F1-9, design §7).
 *
 * No hay cobro real: el adaptador devuelve el estado que corresponde al modo
 * de la agencia. En AUTO aprueba al instante; en MANUAL deja el pago en
 * revisión para que lo resuelva un Admin distinto del pagador. Una pasarela
 * real implementa `PaymentProvider` sin tocar el dominio (D9).
 */
@Injectable()
export class SimulatedPaymentProvider implements PaymentProvider {
  async createPayment(intent: PaymentIntent): Promise<ProviderPayment> {
    return {
      status: intent.autoApprove ? "APPROVED" : "IN_REVIEW",
      providerReference: null,
    };
  }

  async confirm(_paymentId: string): Promise<ProviderPayment> {
    return { status: "APPROVED", providerReference: null };
  }

  async refund(_intent: RefundIntent): Promise<ProviderRefund> {
    // Los reembolsos se persisten en T-F1-10; la pasarela simulada no cobra.
    return { providerReference: null };
  }
}
