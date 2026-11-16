import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { RatesModule } from "../rates/rates.module.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { BookingExpirationService } from "./booking-expiration.service.js";
import { JobsScheduler } from "./jobs.scheduler.js";

/**
 * Trabajos en segundo plano (T-F1-8, design §3.3): expiración de retenciones
 * cada minuto y refresco diario de la tasa global.
 *
 * `BookingExpirationService` se exporta para que los e2e ejecuten una pasada
 * sin depender de BullMQ ni de Redis.
 */
@Module({
  imports: [TenantModule, AuditModule, RatesModule],
  providers: [BookingExpirationService, JobsScheduler],
  exports: [BookingExpirationService],
})
export class JobsModule {}
