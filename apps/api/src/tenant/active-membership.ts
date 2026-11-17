import { ApiProblemException } from "../errors/api-problem.exception.js";
import { prisma } from "../prisma.js";

/**
 * Revalidación central de la agencia activa (extensión de F1-S2).
 *
 * `activeOrganizationId` puede quedar obsoleto en una sesión abierta: revocar
 * una membresía no limpia ese campo. Confiar solo en RLS con ese valor abre
 * otra agencia a un usuario que ya no pertenece a ella. Todas las rutas que
 * resuelvan la agencia desde la sesión pasan por aquí.
 */

/** Lo mínimo que se necesita de la sesión de Better Auth. */
export interface ActiveMembershipSession {
  session: { activeOrganizationId?: string | null };
  user: { id: string };
}

export interface ActiveMembership {
  organizationId: string;
  role: string;
}

/** Petición donde se cachea la resolución para no repetir la consulta. */
export interface ActiveMembershipRequest {
  session?: ActiveMembershipSession | null;
  activeMembership?: ActiveMembership | null;
}

/** Error único para «sin agencia» y para «agencia revocada» (403). */
export function activeOrganizationRequired(): ApiProblemException {
  return new ApiProblemException(
    "ACTIVE_ORGANIZATION_REQUIRED",
    "La operación requiere una agencia activa de la que el usuario sea miembro.",
  );
}

/**
 * Agencia activa efectiva de la petición, o `null` si la sesión no tiene
 * organización activa. Si la tiene pero el usuario ya no es miembro, falla
 * cerrado con 403 en lugar de degradar a otro contexto.
 */
export async function activeMembershipOf(
  request: ActiveMembershipRequest,
): Promise<ActiveMembership | null> {
  if (request.activeMembership !== undefined) return request.activeMembership;

  const session = request.session;
  const organizationId = session?.session.activeOrganizationId;
  if (!organizationId) {
    request.activeMembership = null;
    return null;
  }

  const member = await prisma.member.findFirst({
    where: { userId: session.user.id, organizationId },
    select: { role: true },
  });
  if (!member) throw activeOrganizationRequired();

  const membership: ActiveMembership = { organizationId, role: member.role };
  request.activeMembership = membership;
  return membership;
}
