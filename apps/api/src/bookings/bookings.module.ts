import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { BookingsController } from "./bookings.controller.js";
import { BookingsService } from "./bookings.service.js";

/**
 * Reservas (T-F1-7): creacion con retencion multi-noche, viajeros, codigo e
 * `Idempotency-Key`. La auditoria se escribe dentro de la misma transaccion
 * (AuditModule) y todo el acceso a datos pasa por TenantService.
 */
@Module({
  imports: [TenantModule, AuditModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
