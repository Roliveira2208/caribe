import { Controller, Get, Put } from "@nestjs/common";
import { AllowAnonymous, MemberHasPermission } from "@thallesp/nestjs-better-auth";

/**
 * Stubs de F0: el catalogo publico y un PUT protegido por permiso de agencia
 * (matriz T-F0-6, spec auth-access "Proveedor edita su producto"). El
 * catalogo real llega con specs/catalog y sustituye ambos (T-F1-7b); la
 * propiedad del producto (que el proveedor solo edite el suyo) es de la
 * capa de servicio en F1, este stub la ignora.
 */
@Controller("products")
export class ProductsController {
  @AllowAnonymous()
  @Get()
  findAll() {
    // TODO(F1): catalogo real de specs/catalog; F1 lo sustituye (T-F1-7b).
    return { items: [] };
  }

  @MemberHasPermission({ permissions: { product: ["update"] } })
  @Put(":id")
  update() {
    // TODO(F1): catalogo real de specs/catalog; F1 lo sustituye (T-F1-7b).
    return { updated: true };
  }
}
