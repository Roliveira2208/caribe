import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AdminController } from "./admin.controller.js";
import { AdminTwoFactorGuard } from "./admin-two-factor.guard.js";

/**
 * Modulo administrativo (T-F0-8): unica fuente del guard global. El
 * app.module registra la lib con disableGlobalAuthGuard: true, asi que
 * AdminTwoFactorGuard (subclase del AuthGuard de la lib) es el unico guard
 * global de la API.
 */
@Module({
  controllers: [AdminController],
  providers: [{ provide: APP_GUARD, useClass: AdminTwoFactorGuard }],
})
export class AdminModule {}
