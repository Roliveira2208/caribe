import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AuthModule } from "@thallesp/nestjs-better-auth";
import { auth } from "./auth.js";
import { AdminModule } from "./admin/admin.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { BookingsModule } from "./bookings/bookings.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { ProblemDetailsFilter } from "./errors/problem-details.filter.js";
import { RatesModule } from "./rates/rates.module.js";
import { TenantModule } from "./tenant/tenant.module.js";
import { TenantSettingsModule } from "./tenant-settings/tenant-settings.module.js";

@Module({
  // disableGlobalAuthGuard: la subclase AdminTwoFactorGuard (AdminModule) es
  // el unico guard global y extiende el AuthGuard de la lib (T-F0-8).
  imports: [
    AuthModule.forRoot({ auth, disableGlobalAuthGuard: true }),
    AdminModule,
    AuditModule,
    CatalogModule,
    BookingsModule,
    RatesModule,
    TenantModule,
    TenantSettingsModule,
  ],
  // Contrato de errores de /api/v1 (T-F1-0c): un unico filtro global.
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
