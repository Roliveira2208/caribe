import { Controller, Get, Param } from "@nestjs/common";

/**
 * Stub protegido de F0: sin @AllowAnonymous, el guard global exige sesion
 * (spec auth-access, "Ruta protegida sin sesion").
 */
@Controller("bookings")
export class BookingsController {
  @Get(":id")
  findOne(@Param("id") id: string) {
    // TODO(F1): reservas reales de specs/booking; F1 lo sustituye (T-F1-7b).
    return { id, message: "TODO(F1)" };
  }
}
