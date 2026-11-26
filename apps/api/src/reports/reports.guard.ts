import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import {
  activeMembershipOf,
  activeOrganizationRequired,
  type ActiveMembershipRequest,
} from "../tenant/active-membership.js";
import { isPlatformRole } from "../tenant/tenant-context.js";

/**
 * Guard del reporte de ventas (T-F2-23, specs/reports "Alcance por rol").
 *
 * Corre tras el guard global (sesión y TOTP) y tras `ActiveMembershipGuard`.
 * Solo owner/admin con agencia activa y el Super Admin en modo plataforma
 * pueden leer; agent, provider y member reciben 403 sin datos. La escritura no
 * existe: el módulo solo expone un GET.
 */

export interface ReportActor {
  tenantId: string | null;
  userId: string;
  isPlatform: boolean;
}

export interface ReportsRequest extends ActiveMembershipRequest {
  session?: {
    session: { activeOrganizationId?: string | null };
    user: { id: string; role?: string | string[] | null };
  };
  reportActor?: ReportActor;
}

@Injectable()
export class ReportsGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ReportsRequest>();
    const session = request.session;
    if (!session) {
      throw new ApiProblemException("UNAUTHENTICATED", "La solicitud requiere una sesión.");
    }

    const membership = await activeMembershipOf(request);
    if (membership) {
      if (membership.role !== "owner" && membership.role !== "admin") {
        throw new ApiProblemException("FORBIDDEN", "Tu rol no puede consultar reportes.");
      }
      request.reportActor = {
        tenantId: membership.organizationId,
        userId: session.user.id,
        isPlatform: false,
      };
      return true;
    }

    if (isPlatformRole(session.user.role)) {
      request.reportActor = { tenantId: null, userId: session.user.id, isPlatform: true };
      return true;
    }

    throw activeOrganizationRequired();
  }
}

/** El guard siempre deja `reportActor`; sin él sería un fallo de cableado. */
export function reportActorOf(request: ReportsRequest): ReportActor {
  if (!request.reportActor) {
    throw new Error("ReportsGuard no fijó el actor del reporte");
  }
  return request.reportActor;
}
