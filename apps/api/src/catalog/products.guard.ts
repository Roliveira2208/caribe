import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "better-auth/plugins/access";
import { adminRole, ownerRole, providerRole } from "../access.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import {
  activeMembershipOf,
  activeOrganizationRequired,
  type ActiveMembershipRequest,
} from "../tenant/active-membership.js";
import { isPlatformRole } from "../tenant/tenant-context.js";

/**
 * Guard del panel de productos (T-F1-4, specs/auth-access "Propiedad de
 * productos").
 *
 * Corre después del guard global, así que la sesión ya está verificada y, en
 * rutas /admin, el TOTP ya se exigió a los roles administrativos. Aquí se
 * aplica la matriz de permisos y la regla de plataforma:
 * - agencia activa: la membresía debe conceder `product:<acción>` (owner,
 *   admin y provider lo hacen; agent no);
 * - sin agencia activa y rol de plataforma: solo lectura (el Super Admin no
 *   crea, edita, publica ni archiva);
 * - sin agencia y sin rol de plataforma: 403 ACTIVE_ORGANIZATION_REQUIRED.
 *
 * La propiedad de fila (proveedor solo sus productos, 404 entre agencias) es
 * del servicio: el permiso por sí solo no autoriza un producto ajeno.
 */

export type ProductAction = "create" | "read" | "update" | "delete";

/** Clave de metadata del decorador @ProductPermission. */
export const PRODUCT_PERMISSION_KEY = "caribe:product-permission";

/** Declara la acción de producto que exige un handler. */
export const ProductPermission = (action: ProductAction) =>
  SetMetadata(PRODUCT_PERMISSION_KEY, action);

export interface ProductActor {
  /** Agencia activa; `null` para el Super Admin de plataforma. */
  tenantId: string | null;
  userId: string;
  membershipRole: "owner" | "admin" | "provider" | null;
  isPlatform: boolean;
}

/** Lo mínimo que el guard y el controller necesitan de la petición. */
export interface ProductsRequest extends ActiveMembershipRequest {
  session?: {
    session: { activeOrganizationId?: string | null };
    user: { id: string; role?: string | string[] | null };
  };
  productActor?: ProductActor;
}

const AGENCY_PRODUCT_ROLES: Record<string, Role> = {
  owner: ownerRole,
  admin: adminRole,
  provider: providerRole,
};

@Injectable()
export class ProductsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ProductsRequest>();
    const session = request.session;
    if (!session) {
      throw new ApiProblemException("UNAUTHENTICATED", "La solicitud requiere una sesión.");
    }

    const action = this.reflector.get<ProductAction>(
      PRODUCT_PERMISSION_KEY,
      context.getHandler(),
    );
    if (!action) {
      // Fallo cerrado: una ruta del panel sin acción declarada no autoriza.
      throw forbidden("La ruta no declara una acción de producto.");
    }

    const membership = await activeMembershipOf(request);
    if (membership) {
      const organizationId = membership.organizationId;
      const role = AGENCY_PRODUCT_ROLES[membership.role];
      if (!role || !role.authorize({ product: [action] }).success) {
        throw forbidden("Tu rol no puede realizar esta acción sobre productos.");
      }

      request.productActor = {
        tenantId: organizationId,
        userId: session.user.id,
        membershipRole: membership.role as ProductActor["membershipRole"],
        isPlatform: false,
      };
      return true;
    }

    if (isPlatformRole(session.user.role)) {
      if (action !== "read") {
        throw forbidden("El Super Admin solo puede consultar productos.");
      }
      request.productActor = {
        tenantId: null,
        userId: session.user.id,
        membershipRole: null,
        isPlatform: true,
      };
      return true;
    }

    throw activeOrganizationRequired();
  }
}

function forbidden(detail: string): ApiProblemException {
  return new ApiProblemException("FORBIDDEN", detail);
}
