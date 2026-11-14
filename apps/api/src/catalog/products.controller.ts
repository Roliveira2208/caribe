import { Controller, Get, Param, Put, Query } from "@nestjs/common";
import { AllowAnonymous, MemberHasPermission } from "@thallesp/nestjs-better-auth";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import {
  availabilityQuerySchema,
  catalogQuerySchema,
  type AvailabilityQuery,
  type CatalogQuery,
} from "./catalog.schemas.js";
import { CatalogService } from "./catalog.service.js";

/**
 * Catálogo público (T-F1-3, specs/catalog) y el PUT protegido por permiso de
 * agencia que se conserva de F0 (matriz T-F0-6, spec auth-access "Proveedor
 * edita su producto"). El CRUD real y la comprobación de propiedad del
 * producto llegan con T-F1-4/T-F1-7b; este stub las ignora.
 *
 * Las tres lecturas son anónimas: la búsqueda con filtros y cursor, el detalle
 * y la disponibilidad por noche. Las queries se validan con los esquemas
 * compartidos y responden 422 ante cualquier clave o valor inválido.
 */
@Controller("products")
export class ProductsController {
  constructor(private readonly catalogService: CatalogService) {}

  @AllowAnonymous()
  @Get()
  findAll(@Query(new ZodValidationPipe(catalogQuerySchema)) query: CatalogQuery) {
    return this.catalogService.search(query);
  }

  @AllowAnonymous()
  @Get(":id/availability")
  availability(
    @Param("id") id: string,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQuery,
  ) {
    return this.catalogService.availability(id, query);
  }

  @AllowAnonymous()
  @Get(":id")
  detail(@Param("id") id: string) {
    return this.catalogService.detail(id);
  }

  @MemberHasPermission({ permissions: { product: ["update"] } })
  @Put(":id")
  update() {
    // TODO(F1): catalogo real de specs/catalog; T-F1-7b sustituye este stub.
    return { updated: true };
  }
}
