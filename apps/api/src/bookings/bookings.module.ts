import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { BookingsGuard } from "./bookings.guard.js";
import { BookingsController } from "./bookings.controller.js";
import { BookingsService } from "./bookings.service.js";

/**
 * Reservas (T-F1-7): creacion con retencion multi-noche, viajeros, codigo e
 * `Idempotency-Key`; cancelacion y reembolso (T-F1-10). La auditoria se
 * escribe dentro de la misma transaccion (AuditModule), el reembolso lo emite
 * PaymentsModule y todo el acceso a datos pasa por TenantService.
 */
@Module({
  imports: [TenantModule, AuditModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsGuard],
})
export class BookingsModule {}
