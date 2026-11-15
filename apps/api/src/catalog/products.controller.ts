import { Controller, Get, Param, Query } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import {
  availabilityQuerySchema,
  catalogQuerySchema,
  type AvailabilityQuery,
  type CatalogQuery,
} from "./catalog.schemas.js";
import { CatalogService } from "./catalog.service.js";

/**
 * Catálogo público (T-F1-3, specs/catalog). Las tres lecturas son anónimas: la
 * búsqueda con filtros y cursor, el detalle y la disponibilidad por noche. Las
 * queries se validan con los esquemas compartidos y responden 422 ante
 * cualquier clave o valor inválido.
 *
 * La escritura de productos vive en el panel (`/admin/products`, T-F1-4); el
 * stub de F0 se retiró en T-F1-7b.
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
}
