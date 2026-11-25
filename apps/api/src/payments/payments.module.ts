import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { RatesModule } from "../rates/rates.module.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { AdminPaymentsController } from "./admin-payments.controller.js";
import { PaymentProviderModule } from "./payment-provider.module.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsGuard } from "./payments.guard.js";
import { PaymentsService } from "./payments.service.js";

/**
 * Pagos (T-F1-9, design §7): alta por el dueño de la reserva, consulta y
 * revisión del panel. La pasarela se inyecta por token desde
 * `PaymentProviderModule` para que el servicio dependa de `PaymentProvider`
 * (D9) y una pasarela real no toque el dominio.
 *
 * F-FINAL-003 cerrado en T-F2-5: la intención se escribe en `refund_dispatches`
 * dentro de la transacción y el efecto externo se despacha tras el commit; la
 * reconciliación vive en `JobsModule` con el MISMO adaptador inyectado.
 */
@Module({
  imports: [
    TenantModule,
    AuditModule,
    RatesModule,
    DocumentsModule,
    JobsModule,
    NotificationsModule,
    PaymentProviderModule,
  ],
  controllers: [PaymentsController, AdminPaymentsController],
  providers: [PaymentsService, PaymentsGuard],
  // La cancelación de una reserva reserva la intención en la misma transacción
  // (T-F1-10, T-F2-5, design §7) y despacha el efecto tras el commit.
  exports: [PaymentsService],
})
export class PaymentsModule {}
