import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ReportsController } from "../reports/reports.controller.js";
import { ReportsGuard } from "../reports/reports.guard.js";
import { ReportsService } from "../reports/reports.service.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { AdminTwoFactorGuard } from "./admin-two-factor.guard.js";
import { OrganizationsController } from "./organizations.controller.js";

/**
 * Modulo administrativo (T-F0-8): unica fuente del guard global. El
 * app.module registra la lib con disableGlobalAuthGuard: true, asi que
 * AdminTwoFactorGuard (subclase del AuthGuard de la lib) es el unico guard
 * global de la API. T-F0-9 anade POST /admin/organizations (accion de
 * plataforma auditada, delta de audit). Las tasas viven en RatesModule
 * (T-F1-5).
 */
@Module({
  imports: [TenantModule],
  controllers: [OrganizationsController, ReportsController],
  providers: [
    { provide: APP_GUARD, useClass: AdminTwoFactorGuard },
    ReportsService,
    ReportsGuard,
  ],
})
export class AdminModule {}
