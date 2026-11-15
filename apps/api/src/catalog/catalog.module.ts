import { Module } from "@nestjs/common";
import { RatesModule } from "../rates/rates.module.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { CatalogService } from "./catalog.service.js";
import { ProductsAdminController } from "./products-admin.controller.js";
import { ProductsAdminService } from "./products-admin.service.js";
import { ProductsController } from "./products.controller.js";
import { ProductsGuard } from "./products.guard.js";

/**
 * Catálogo público (T-F1-3): búsqueda con filtros y cursor, detalle y
 * disponibilidad por noche. Las consultas corren en el contexto RLS `public`
 * de TenantService; el módulo no expone el servicio fuera de la API.
 *
 * El precio VES informativo (T-F1-6) usa la tasa global de `RatesModule`; sin
 * tasa, la lectura sigue sirviendo solo USD.
 *
 * Panel de productos (T-F1-4): CRUD de tipos de habitación bajo /admin con
 * `ProductsGuard` (matriz `product:*`) y comprobación de propiedad en el
 * servicio, en contexto RLS `tenant` o `platform`.
 */
@Module({
  imports: [TenantModule, RatesModule],
  controllers: [ProductsController, ProductsAdminController],
  providers: [CatalogService, ProductsAdminService, ProductsGuard],
})
export class CatalogModule {}
