import { Controller, Put } from "@nestjs/common";
import { MemberHasPermission } from "@thallesp/nestjs-better-auth";

/**
 * Stub administrativo de F0 (SDD, "Tasas": PUT /admin/exchange-rates/
 * override): fija la exigencia de segundo factor en las rutas bajo /admin
 * (delta de auth-access, T-F0-8). El override real de tasas llega con
 * specs/payments (F2) y sustituye este stub; aqui solo se ejercita el guard.
 */
@Controller("admin/exchange-rates")
export class AdminController {
  @MemberHasPermission({ permissions: { "exchange-rate": ["update"] } })
  @Put("override")
  overrideRate() {
    // TODO(F2): override real de tasa (specs/payments).
    return { overridden: true };
  }
}
