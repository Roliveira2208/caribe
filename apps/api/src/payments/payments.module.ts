import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { RatesModule } from "../rates/rates.module.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { AdminPaymentsController } from "./admin-payments.controller.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsGuard } from "./payments.guard.js";
import { PAYMENT_PROVIDER, PaymentsService } from "./payments.service.js";
import { SimulatedPaymentProvider } from "./simulated-payment.provider.js";

/**
 * Pagos (T-F1-9, design §7): alta por el dueño de la reserva, consulta y
 * revisión del panel. La pasarela se inyecta por token para que el servicio
 * dependa de `PaymentProvider` (D9) y una pasarela real no toque el dominio.
 */
@Module({
  imports: [TenantModule, AuditModule, RatesModule, DocumentsModule, JobsModule],
  controllers: [PaymentsController, AdminPaymentsController],
  providers: [
    PaymentsService,
    PaymentsGuard,
    { provide: PAYMENT_PROVIDER, useClass: SimulatedPaymentProvider },
  ],
  // La cancelación de una reserva emite su reembolso dentro de la misma
  // transacción (T-F1-10, design §7).
  exports: [PaymentsService],
})
export class PaymentsModule {}
