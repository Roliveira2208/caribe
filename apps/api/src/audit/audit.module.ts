import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { TenantModule } from "../tenant/tenant.module.js";
import { AuditController } from "./audit.controller.js";
import { AuditInterceptor } from "./audit-interceptor.js";
import { AuditService } from "./audit.service.js";

/**
 * Modulo de auditoria (T-F0-9): AuditInterceptor global (solo actua en rutas
 * @Auditable), AuditService para escribir dentro de la transaccion del
 * llamador y el endpoint de consulta GET /admin/audit-logs.
 */
@Module({
  imports: [TenantModule],
  controllers: [AuditController],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
