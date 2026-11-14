import { Module } from "@nestjs/common";
import { TenantModule } from "../tenant/tenant.module.js";
import { CatalogService } from "./catalog.service.js";
import { ProductsController } from "./products.controller.js";

/**
 * Catálogo público (T-F1-3): búsqueda con filtros y cursor, detalle y
 * disponibilidad por noche. Las consultas corren en el contexto RLS `public`
 * de TenantService; el módulo no expone el servicio fuera de la API.
 */
@Module({
  imports: [TenantModule],
  controllers: [ProductsController],
  providers: [CatalogService],
})
export class CatalogModule {}
