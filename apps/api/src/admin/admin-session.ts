import { prisma } from "../prisma.js";
import { isPlatformRole } from "../tenant/tenant-context.js";
import { AGENCY_ADMIN_ROLES } from "./admin-route.js";

/**
 * Lo minimo que el guard de Nest y el middleware de Better Auth necesitan de
 * la sesion (estructural, como SessionTenantInfo del tenant module): la sesion
 * real de Better Auth es asignable a esta forma.
 */
export interface AdminSessionInfo {
  session: { activeOrganizationId?: string | null };
  user: { id: string; role?: string | string[] | null; twoFactorEnabled?: boolean | null };
}

/** Mensaje del 403 TWO_FACTOR_REQUIRED (guard de Nest y middleware de BA). */
export const TWO_FACTOR_REQUIRED_MESSAGE =
  "Activa el segundo factor (TOTP) antes de usar los endpoints administrativos";

/**
 * true si la sesion pertenece a un rol administrativo: rol de plataforma
 * (super_admin) o membresia owner/admin.
 *
 * La usa el guard de Nest (T-F0-8) y el middleware de Better Auth (fix de la
 * verificacion f0-foundations: las rutas /api/auth/admin/* y las escrituras
 * administrativas de /api/auth/organization/* tambien exigen TOTP), de modo
 * que ambas familias clasifican igual a un mismo usuario.
 *
 * `targetOrganizationId` es la agencia que la escritura afecta (B3 del segundo
 * informe): Better Auth autoriza las escrituras de /organization/* por
 * membresia en ESA agencia, no por la activa, asi que cuando llega solo cuenta
 * el rol ahi (ser owner de otra agencia no vuelve administrativa la sesion).
 * Sin agencia objetivo se evalua la activa y, si tampoco hay, se falla cerrado
 * con el admin de cualquier agencia: una escritura de organizacion sin
 * objetivo determinable no puede clasificarse y no debe librarse del TOTP.
 *
 * `null` (bypass residual de cancel-invitation) significa "no se puede saber
 * por la peticion": la ruta no acepta organizationId y la agencia de la
 * entidad puede no ser la activa, asi que se ignora la activa y se falla
 * cerrado con el admin de cualquier agencia. Es la unica forma de que un
 * `organizationId` ajeno en el cuerpo no libre del TOTP a quien autoriza por
 * la agencia de la entidad (la invitacion).
 *
 * Better Auth 1.7.18 no expone API de servidor para el rol del miembro activo
 * (la lib cae en undefined), asi que se lee el registro member. La membresia
 * es unica por (organizacion, usuario).
 */
export async function isAdminLevelSession(
  session: AdminSessionInfo,
  targetOrganizationId?: string | null,
): Promise<boolean> {
  if (isPlatformRole(session.user.role)) return true;

  if (targetOrganizationId === null) return adminInAnyAgency(session.user.id);

  const organizationId = targetOrganizationId || session.session.activeOrganizationId;
  if (organizationId) {
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, organizationId },
      select: { role: true },
    });
    return member?.role !== undefined && AGENCY_ADMIN_ROLES.includes(member.role);
  }

  return adminInAnyAgency(session.user.id);
}

/** true si el usuario es owner/admin en alguna agencia. */
async function adminInAnyAgency(userId: string): Promise<boolean> {
  const adminMembership = await prisma.member.findFirst({
    where: { userId, role: { in: [...AGENCY_ADMIN_ROLES] } },
    select: { id: true },
  });
  return adminMembership !== null;
}
