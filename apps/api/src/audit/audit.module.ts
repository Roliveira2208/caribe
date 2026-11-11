import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { TenantModule } from "../tenant/tenant.module.js";
import { AuthEventsController } from "./auth-events.controller.js";
import { AuditController } from "./audit.controller.js";
import { AuditInterceptor } from "./audit-interceptor.js";
import { AuditService } from "./audit.service.js";

/**
 * Modulo de auditoria (T-F0-9, ampliado en T-F1-0b): AuditInterceptor global
 * (solo actua en rutas @Auditable), AuditService para escribir dentro de la
 * transaccion del llamador y las consultas de solo lectura
 * GET /admin/audit-logs y GET /admin/auth-events.
 */
@Module({
  imports: [TenantModule],
  controllers: [AuditController, AuthEventsController],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
