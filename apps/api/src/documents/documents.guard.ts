import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "better-auth/plugins/access";
import { adminRole, agentRole, ownerRole, providerRole } from "../access.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import {
  activeMembershipOf,
  type ActiveMembershipRequest,
} from "../tenant/active-membership.js";

/**
 * Guard de descarga de documentos (T-F1-11e, spec documents "Descarga
 * autenticada", "Sin sesión", "Personal de la agencia descarga").
 *
 * Corre después del guard global de sesión. Siempre revalida la membresía
 * activa: una sesión con la agencia revocada no sirve ni para el dueño. La
 * agencia activa solo se usa como alcance adicional si el rol puede leer
 * reservas; un cliente con una membresía sin permisos sigue pudiendo descargar
 * SUS documentos, y el servicio aplica RLS por propietario.
 */
export const DOCUMENT_ACCESS_KEY = "caribe:document-access";
export type DocumentAccess = "download";
export const DocumentPermission = (access: DocumentAccess) =>
  SetMetadata(DOCUMENT_ACCESS_KEY, access);

export interface DocumentActor {
  userId: string;
  /** Agencia activa revalidada; `null` cuando solo aplica la propiedad. */
  tenantId: string | null;
  membershipRole: string | null;
}

export interface DocumentsRequest extends ActiveMembershipRequest {
  session?: {
    session: { activeOrganizationId?: string | null };
    user: { id: string; role?: string | string[] | null };
  };
  documentActor?: DocumentActor;
}

const AGENCY_DOCUMENT_ROLES: Record<string, Role> = {
  owner: ownerRole,
  admin: adminRole,
  agent: agentRole,
  provider: providerRole,
};

@Injectable()
export class DocumentsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DocumentsRequest>();
    if (!request.session) {
      throw new ApiProblemException("UNAUTHENTICATED", "La solicitud requiere una sesión.");
    }

    const access = this.reflector.get<DocumentAccess>(
      DOCUMENT_ACCESS_KEY,
      context.getHandler(),
    );
    if (!access) {
      // Fallo cerrado: una ruta de documentos sin acceso declarado no autoriza.
      throw new ApiProblemException("FORBIDDEN", "La ruta no declara un acceso de documentos.");
    }

    // Revalida la membresía aunque el documento sea propio: ver active-membership.
    const membership = await activeMembershipOf(request);
    const role = membership ? AGENCY_DOCUMENT_ROLES[membership.role] : undefined;
    const canReadAgency = role?.authorize({ booking: ["read"] }).success === true;

    request.documentActor = {
      userId: request.session.user.id,
      tenantId: canReadAgency ? membership?.organizationId ?? null : null,
      membershipRole: canReadAgency ? membership?.role ?? null : null,
    };
    return true;
  }
}

/** El guard siempre deja `documentActor`; sin él sería un fallo de cableado. */
export function documentActorOf(request: DocumentsRequest): DocumentActor {
  if (!request.documentActor) {
    throw new Error("DocumentsGuard no fijó el actor de documentos");
  }
  return request.documentActor;
}
