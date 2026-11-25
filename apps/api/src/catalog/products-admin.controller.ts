import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import { ActiveMembershipGuard } from "../tenant/active-membership.guard.js";
import { ProductsAdminService } from "./products-admin.service.js";
import {
  availabilityWriteSchema,
  createProductSchema,
  productsAdminQuerySchema,
  updateProductSchema,
  type AvailabilityWriteBody,
  type CreateProductBody,
  type PanelAvailabilityRead,
  type PanelAvailabilityWrite,
  type PanelProduct,
  type PanelProductPage,
  type ProductsAdminQuery,
  type UpdateProductBody,
} from "./products-admin.schemas.js";
import {
  availabilityQuerySchema,
  type AvailabilityQuery,
} from "./catalog.schemas.js";
import {
  ProductPermission,
  ProductsGuard,
  type ProductActor,
  type ProductsRequest,
} from "./products.guard.js";

/**
 * Panel de productos (T-F1-4, specs/catalog "Estados" y auth-access
 * "Propiedad de productos").
 *
 * Todas las rutas cuelgan de /admin: el guard global exige TOTP a los roles
 * administrativos antes de llegar aquí. `ProductsGuard` aplica después la
 * matriz de permisos `product:*` y deja al servicio la comprobación de
 * propiedad de la fila (proveedor solo su registro; otra agencia, 404).
 *
 * - GET    /admin/products
 * - POST   /admin/products
 * - GET    /admin/products/:id
 * - PUT    /admin/products/:id
 * - DELETE /admin/products/:id        (borrado lógico)
 * - POST   /admin/products/:id/publish
 * - POST   /admin/products/:id/archive
 * - GET    /admin/products/:id/availability (T-F2-19)
 * - POST   /admin/products/:id/availability (T-F2-19)
 */
@Controller("admin/products")
@UseGuards(ActiveMembershipGuard, ProductsGuard)
export class ProductsAdminController {
  constructor(private readonly productsAdminService: ProductsAdminService) {}

  @Get()
  @ProductPermission("read")
  list(
    @Req() request: ProductsRequest,
    @Query(new ZodValidationPipe(productsAdminQuerySchema)) query: ProductsAdminQuery,
  ): Promise<PanelProductPage> {
    return this.productsAdminService.list(actorOf(request), query);
  }

  @Post()
  @ProductPermission("create")
  create(
    @Req() request: ProductsRequest,
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductBody,
  ): Promise<PanelProduct> {
    return this.productsAdminService.create(actorOf(request), body);
  }

  @Get(":id")
  @ProductPermission("read")
  detail(
    @Req() request: ProductsRequest,
    @Param("id") id: string,
  ): Promise<PanelProduct> {
    return this.productsAdminService.detail(actorOf(request), id);
  }

  @Get(":id/availability")
  @ProductPermission("read")
  readAvailability(
    @Req() request: ProductsRequest,
    @Param("id") id: string,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQuery,
  ): Promise<PanelAvailabilityRead> {
    return this.productsAdminService.readAvailability(actorOf(request), id, query);
  }

  @Put(":id")
  @ProductPermission("update")
  update(
    @Req() request: ProductsRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductBody,
  ): Promise<PanelProduct> {
    return this.productsAdminService.update(actorOf(request), id, body);
  }

  @Delete(":id")
  @ProductPermission("delete")
  @HttpCode(204)
  async remove(@Req() request: ProductsRequest, @Param("id") id: string): Promise<void> {
    await this.productsAdminService.remove(actorOf(request), id);
  }

  @Post(":id/publish")
  @ProductPermission("update")
  @HttpCode(200)
  publish(@Req() request: ProductsRequest, @Param("id") id: string): Promise<PanelProduct> {
    return this.productsAdminService.publish(actorOf(request), id);
  }

  @Post(":id/archive")
  @ProductPermission("update")
  @HttpCode(200)
  archive(@Req() request: ProductsRequest, @Param("id") id: string): Promise<PanelProduct> {
    return this.productsAdminService.archive(actorOf(request), id);
  }

  @Post(":id/availability")
  @ProductPermission("update")
  @HttpCode(200)
  writeAvailability(
    @Req() request: ProductsRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(availabilityWriteSchema)) body: AvailabilityWriteBody,
  ): Promise<PanelAvailabilityWrite> {
    return this.productsAdminService.writeAvailability(actorOf(request), id, body);
  }
}

/**
 * El guard siempre deja `productActor` en la petición; si faltara sería un
 * error de cableado y no se debe degradar a un actor implícito.
 */
function actorOf(request: ProductsRequest): ProductActor {
  if (!request.productActor) {
    throw new Error("ProductsGuard no fijó el actor de productos");
  }
  return request.productActor;
}
