import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { AGENCY_ADMIN_ROLES } from "../admin/admin-route.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { prisma } from "../prisma.js";

/** Lo minimo que el guard necesita de la sesion (estructural). */
interface SessionInfo {
  session: { activeOrganizationId?: string | null };
  user: { id: string };
}

interface AuthenticatedRequest {
  session?: SessionInfo;
}

/**
 * Guard de ruta de los ajustes de la agencia (T-F1-1a, specs/auth-access).
 *
 * Corre despues del guard global (AuthGuard) y antes del interceptor de
 * auditoria, asi que una peticion sin agencia activa o sin membresia nunca
 * abre la transaccion auditable. Reglas:
 * - sin agencia activa -> 403 ACTIVE_ORGANIZATION_REQUIRED;
 * - con agencia activa pero sin membresia -> 403 ACTIVE_ORGANIZATION_REQUIRED;
 * - membresia con rol distinto de owner/admin -> 403 FORBIDDEN;
 * - owner/admin pasa (el TOTP lo exige antes el guard global, por estar la
 *   ruta bajo /admin).
 *
 * No se usan @OrgRoles ni @MemberHasPermission: ambos lanzan un FORBIDDEN
 * generico y la spec exige el codigo ACTIVE_ORGANIZATION_REQUIRED.
 */
@Injectable()
export class TenantSettingsGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = request.session;
    if (!session) {
      // Red de seguridad: el guard global ya exige sesion.
      throw new ApiProblemException("UNAUTHENTICATED", "La solicitud requiere una sesión.");
    }

    const organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      throw activeOrganizationRequired();
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, organizationId },
      select: { role: true },
    });
    if (!member) {
      throw activeOrganizationRequired();
    }

    if (!AGENCY_ADMIN_ROLES.includes(member.role)) {
      throw new ApiProblemException(
        "FORBIDDEN",
        "Solo el dueño o un administrador de la agencia puede gestionar los ajustes.",
      );
    }

    return true;
  }
}

function activeOrganizationRequired(): ApiProblemException {
  return new ApiProblemException(
    "ACTIVE_ORGANIZATION_REQUIRED",
    "La operación requiere una agencia activa de la que el usuario sea miembro.",
  );
}
