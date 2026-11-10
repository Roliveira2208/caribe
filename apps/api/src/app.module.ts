import { Module } from "@nestjs/common";
import { AuthModule } from "@thallesp/nestjs-better-auth";
import { auth } from "./auth.js";
import { AdminModule } from "./admin/admin.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { BookingsModule } from "./bookings/bookings.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { TenantModule } from "./tenant/tenant.module.js";

@Module({
  // disableGlobalAuthGuard: la subclase AdminTwoFactorGuard (AdminModule) es
  // el unico guard global y extiende el AuthGuard de la lib (T-F0-8).
  imports: [
    AuthModule.forRoot({ auth, disableGlobalAuthGuard: true }),
    AdminModule,
    AuditModule,
    CatalogModule,
    BookingsModule,
    TenantModule,
  ],
})
export class AppModule {}
