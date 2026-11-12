import { Module } from "@nestjs/common";
import { TenantModule } from "../tenant/tenant.module.js";
import { TenantSettingsController } from "./tenant-settings.controller.js";

/**
 * Ajustes de la agencia (T-F1-1a): GET/PUT /admin/tenant-settings con RLS
 * forzada en tenant_settings, TOTP y rol owner/admin. La escritura pasa por
 * el AuditInterceptor global (ruta @Auditable).
 */
@Module({
  imports: [TenantModule],
  controllers: [TenantSettingsController],
})
export class TenantSettingsModule {}
