import { Module } from "@nestjs/common";
import { apiConfig } from "../config.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { NOTIFICATION_PROVIDER } from "./notification-provider.js";
import { NotificationService } from "./notification.service.js";
import { SmtpNotificationProvider } from "./smtp-notification.provider.js";

/**
 * Único canal de F1 (design §11). El proveedor se inyecta por token para que
 * las pruebas usen un doble y nunca abran una conexión SMTP; el envío real
 * sale por `NotificationService`, que conoce el dedupe y los reintentos.
 */
@Module({
  imports: [TenantModule],
  providers: [
    NotificationService,
    {
      provide: NOTIFICATION_PROVIDER,
      useFactory: () => new SmtpNotificationProvider(apiConfig.smtp),
    },
  ],
  exports: [NOTIFICATION_PROVIDER, NotificationService],
})
export class NotificationsModule {}
