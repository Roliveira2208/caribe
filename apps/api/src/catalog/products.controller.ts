import { Controller, Get } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

/**
 * Stub publico de F0: el guard global deniega por defecto y este endpoint se
 * marca explicitamente como publico (spec auth-access, "Catalogo publico").
 */
@Controller("products")
export class ProductsController {
  @AllowAnonymous()
  @Get()
  findAll() {
    // TODO(F1): catalogo real de specs/catalog; F1 lo sustituye (T-F1-7b).
    return { items: [] };
  }
}
