import { Module } from "@nestjs/common";
import { PAYMENT_PROVIDER } from "./payment-provider.token.js";
import { SimulatedPaymentProvider } from "./simulated-payment.provider.js";

/**
 * Adaptador de pagos compartido (F-FINAL-003). Pagos y reconciliación deben
 * hablar con la MISMA instancia del puerto: si cada módulo creara la suya, el
 * proveedor simulado tendría memorias distintas y un reembolso ya aplicado
 * parecería pendiente. Una pasarela real se sustituye aquí sin tocar el dominio.
 */
@Module({
  providers: [{ provide: PAYMENT_PROVIDER, useClass: SimulatedPaymentProvider }],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProviderModule {}
