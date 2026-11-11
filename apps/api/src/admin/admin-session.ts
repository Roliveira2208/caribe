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
 * (super_admin) o membresia activa owner/admin en la agencia.
 *
 * La usa el guard de Nest (T-F0-8) y el middleware de Better Auth (fix de la
 * verificacion f0-foundations: las rutas /api/auth/admin/* y las escrituras
 * administrativas de /api/auth/organization/* tambien exigen TOTP), de modo
 * que ambas familias clasifican igual a un mismo usuario.
 *
 * Better Auth 1.7.18 no expone API de servidor para el rol del miembro activo
 * (la lib cae en undefined), asi que se lee el registro member: la
 * organizacion activa la verifico Better Auth al fijarla y la membresia activa
 * solo puede ser una por agencia.
 */
export async function isAdminLevelSession(session: AdminSessionInfo): Promise<boolean> {
  if (isPlatformRole(session.user.role)) return true;
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return false;
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id, organizationId },
    select: { role: true },
  });
  return member?.role !== undefined && AGENCY_ADMIN_ROLES.includes(member.role);
}
