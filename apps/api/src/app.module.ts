import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "@thallesp/nestjs-better-auth";
import { auth } from "./auth.js";
import { AdminModule } from "./admin/admin.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { BookingsModule } from "./bookings/bookings.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { resolveBusinessRateLimits } from "./config.js";
import { DocumentsModule } from "./documents/documents.module.js";
import { ProblemDetailsFilter } from "./errors/problem-details.filter.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { PaymentsModule } from "./payments/payments.module.js";
import { RatesModule } from "./rates/rates.module.js";
import { BusinessRateLimitGuard } from "./security/business-rate-limit.js";
import { TenantModule } from "./tenant/tenant.module.js";
import { TenantSettingsModule } from "./tenant-settings/tenant-settings.module.js";

@Module({
  // disableGlobalAuthGuard: la subclase AdminTwoFactorGuard (AdminModule) es
  // el unico guard global y extiende el AuthGuard de la lib (T-F0-8).
  imports: [
    // El CORS lo configura bootstrap (T-F2-3): la integración regala un `origin`
    // de lista que devuelve `Access-Control-Allow-Credentials` incluso a un
    // origen desconocido, y la spec exige no autorizar credenciales en ese caso.
    AuthModule.forRoot({
      auth,
      disableGlobalAuthGuard: true,
      disableTrustedOriginsCors: true,
    }),
    // T-F2-4: el almacenamiento en memoria es de @nestjs/throttler. Las
    // opciones describen las cuatro políticas; el guard propio decide qué
    // política aplica a cada handler marcado con @BusinessRateLimit.
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const limits = resolveBusinessRateLimits();
        const ttl = limits.windowSeconds * 1_000;
        return [
          { name: "bookings", limit: limits.bookings, ttl },
          { name: "payments", limit: limits.payments, ttl },
          { name: "paymentReviews", limit: limits.paymentReviews, ttl },
          { name: "downloads", limit: limits.downloads, ttl },
        ];
      },
    }),
    AdminModule,
    AuditModule,
    CatalogModule,
    BookingsModule,
    DocumentsModule,
    JobsModule,
    NotificationsModule,
    PaymentsModule,
    RatesModule,
    TenantModule,
    TenantSettingsModule,
  ],
  // Contrato de errores de /api/v1 (T-F1-0c): un unico filtro global.
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: BusinessRateLimitGuard },
  ],
})
export class AppModule {}
