import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { PaymentProviderModule } from "../payments/payment-provider.module.js";
import { RefundReconciliationService } from "../payments/refund-reconciliation.service.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { BookingExpirationService } from "./booking-expiration.service.js";
import { JobsScheduler } from "./jobs.scheduler.js";
import { PendingRecoveryService } from "./pending-recovery.service.js";

/**
 * Trabajos en segundo plano (T-F1-8, design §3.3): expiración de retenciones
 * y reconciliación de reembolsos cada minuto. La tasa se refresca de forma
 * perezosa desde T-F1-5b.
 *
 * `BookingExpirationService` y `RefundReconciliationService` se exportan para
 * que los e2e ejecuten una pasada sin depender de BullMQ ni de Redis.
 */
@Module({
  imports: [
    TenantModule,
    AuditModule,
    DocumentsModule,
    NotificationsModule,
    PaymentProviderModule,
  ],
  providers: [
    BookingExpirationService,
    PendingRecoveryService,
    RefundReconciliationService,
    JobsScheduler,
  ],
  exports: [
    BookingExpirationService,
    PendingRecoveryService,
    RefundReconciliationService,
    JobsScheduler,
  ],
})
export class JobsModule {}
