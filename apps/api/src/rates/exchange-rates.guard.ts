import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { adminRole, ownerRole } from "../access.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { prisma } from "../prisma.js";
import { isPlatformRole } from "../tenant/tenant-context.js";

/**
 * Guard de las rutas de tasas (T-F1-5, specs/exchange-rates "Ajuste manual" y
 * "Tenencia de las tasas").
 *
 * Corre después del guard global (sesión verificada y, en /admin, TOTP ya
 * exigido a los roles administrativos). Reglas:
 * - `tenant-read` / `tenant-update`: agencia activa con membresía owner/admin
 *   y el permiso `exchange-rate:*`; el Super Admin sin agencia solo lee.
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
export interface RatesRequest {
  session?: {
    session: { activeOrganizationId?: string | null };
    user: { id: string; role?: string | string[] | null };
  };
  rateActor?: RateActor;
}

const AGENCY_ROLES = { owner: ownerRole, admin: adminRole } as const;

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

    const organizationId = session.session.activeOrganizationId;

    if (access === "platform-update") {
      if (organizationId) {
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

    if (organizationId) {
      const member = await prisma.member.findFirst({
        where: { userId: session.user.id, organizationId },
        select: { role: true },
      });
      if (!member) throw activeOrganizationRequired();

      const role = AGENCY_ROLES[member.role as keyof typeof AGENCY_ROLES];
      const action = access === "tenant-update" ? "update" : "read";
      if (!role || !role.authorize({ "exchange-rate": [action] }).success) {
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

function activeOrganizationRequired(): ApiProblemException {
  return new ApiProblemException(
    "ACTIVE_ORGANIZATION_REQUIRED",
    "La operación requiere una agencia activa de la que el usuario sea miembro.",
  );
}
