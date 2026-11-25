import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { adminRole, agentRole, memberRole, ownerRole, providerRole } from "../access.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import {
  activeMembershipOf,
  activeOrganizationRequired,
  type ActiveMembershipRequest,
} from "../tenant/active-membership.js";
import { isPlatformRole } from "../tenant/tenant-context.js";

/**
 * Guard de las rutas de tasas (T-F1-5, specs/exchange-rates "Ajuste manual" y
 * "Tenencia de las tasas").
 *
 * Corre después del guard global (sesión verificada y, en /admin, TOTP ya
 * exigido a los roles administrativos). Reglas:
 * - `tenant-read` / `tenant-update`: agencia activa con el permiso
 *   `exchange-rate:*` del rol de la membresía (owner/admin escriben; agent y
 *   provider solo leen desde F2); el Super Admin sin agencia solo lee.
 * - `platform-update`: solo el rol de plataforma y solo sin agencia activa
 *   (una agencia activa gana sobre el rol de plataforma).
 * - sin agencia y sin rol de plataforma: 403 ACTIVE_ORGANIZATION_REQUIRED.
 */

export type RateAccess = "tenant-read" | "tenant-update" | "platform-update";

export const RATE_ACCESS_KEY = "caribe:rate-access";

/** Declara el acceso que exige un handler de tasas. */
export const RatePermission = (access: RateAccess) => SetMetadata(RATE_ACCESS_KEY, access);

export interface RateActor {
  /** Agencia activa; `null` para el Super Admin de plataforma. */
  tenantId: string | null;
  userId: string;
  isPlatform: boolean;
}

/** Lo mínimo que el guard y el controller necesitan de la petición. */
export interface RatesRequest extends ActiveMembershipRequest {
  session?: {
    session: { activeOrganizationId?: string | null };
    user: { id: string; role?: string | string[] | null };
  };
  rateActor?: RateActor;
}

/**
 * Declaraciones de los roles de agencia, incluidos los operativos que solo
 * leen. Se lee `statements` en lugar de guardar los objetos `Role` juntos: cada
 * uno tiene un tipo literal distinto y no se pueden meter en un mismo mapa sin
 * perder seguridad de tipos. Un rol desconocido cae a `member` (sin permisos).
 */
const AGENCY_ROLE_STATEMENTS: Record<string, Readonly<Record<string, readonly string[]>>> = {
  owner: ownerRole.statements,
  admin: adminRole.statements,
  agent: agentRole.statements,
  provider: providerRole.statements,
  member: memberRole.statements,
};

@Injectable()
export class ExchangeRatesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RatesRequest>();
    const session = request.session;
    if (!session) {
      throw new ApiProblemException("UNAUTHENTICATED", "La solicitud requiere una sesión.");
    }

    const access = this.reflector.get<RateAccess>(RATE_ACCESS_KEY, context.getHandler());
    if (!access) {
      // Fallo cerrado: una ruta de tasas sin acceso declarado no autoriza.
      throw forbidden("La ruta no declara un acceso de tasas.");
    }

    const membership = await activeMembershipOf(request);

    if (access === "platform-update") {
      if (membership) {
        throw forbidden("El override global se fija sin una agencia activa.");
      }
      if (!isPlatformRole(session.user.role)) {
        throw forbidden("Solo el rol de plataforma puede fijar la tasa global.");
      }
      request.rateActor = {
        tenantId: null,
        userId: session.user.id,
        isPlatform: true,
      };
      return true;
    }

    if (membership) {
      const organizationId = membership.organizationId;
      const statements =
        AGENCY_ROLE_STATEMENTS[membership.role] ?? AGENCY_ROLE_STATEMENTS["member"]!;
      const action = access === "tenant-update" ? "update" : "read";
      if (statements["exchange-rate"]?.includes(action) !== true) {
        throw forbidden("Tu rol no puede consultar o ajustar las tasas de la agencia.");
      }

      request.rateActor = {
        tenantId: organizationId,
        userId: session.user.id,
        isPlatform: false,
      };
      return true;
    }

    if (isPlatformRole(session.user.role)) {
      if (access === "tenant-update") {
        throw forbidden("El Super Admin solo puede consultar la tasa vigente.");
      }
      request.rateActor = {
        tenantId: null,
        userId: session.user.id,
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
