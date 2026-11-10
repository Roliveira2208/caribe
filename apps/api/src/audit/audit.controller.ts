import { Controller, ForbiddenException, Get, Req } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import { isPlatformRole } from "../tenant/tenant-context.js";
import { TenantService } from "../tenant/tenant.service.js";
import { AGENCY_AUDIT_READER_ROLES } from "./audit-access.js";

/** Lo minimo que el controller necesita de la sesion (estructural). */
interface SessionInfo {
  session: { activeOrganizationId?: string | null };
  user: { id: string; role?: string | string[] | null };
}

interface AuthenticatedRequest {
  session?: SessionInfo;
}

/**
 * Lectura de auditoria (T-F0-9, specs/audit "Consulta" + delta de alcance de
 * f0-foundations): el admin de agencia solo ve las filas de su agencia; el
 * Super Admin, las de plataforma (tenant_id NULL) y las de todas las agencias.
 *
 * El alcance se resuelve en el handler (no con decoradores de permiso): la
 * lib AND-evalua @UserHasPermission y @MemberHasPermission sobre la misma
 * ruta, asi que "owner/admin de agencia O super_admin" no es expresable con
 * decoradores. El guard global sigue exigiendo sesion y, al estar bajo
 * /admin, TOTP para los roles administrativos; la matriz de acceso se
 * respeta con AGENCY_AUDIT_READER_ROLES (owner/admin, audit:read).
 */
@Controller("admin/audit-logs")
export class AuditController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    const session = request.session;
    if (!session) {
      // El guard global ya exigio sesion; red de seguridad.
      throw new ForbiddenException("La auditoría requiere una sesión");
    }

    if (isPlatformRole(session.user.role)) {
      // Super Admin: filas de plataforma y de todas las agencias.
      return { items: await this.tenantService.withPlatform((tx) => this.query(tx)) };
    }
    const organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      throw new ForbiddenException(
        "La auditoría requiere una agencia activa o el rol de plataforma",
      );
    }
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, organizationId },
      select: { role: true },
    });
    if (!member || !AGENCY_AUDIT_READER_ROLES.includes(member.role)) {
      // Escenario "Agente consulta auditoría" -> 403.
      throw new ForbiddenException("Solo los administradores de la agencia consultan la auditoría");
    }

    // RLS (app.tenant_id) garantiza el alcance con el rol de aplicacion y el
    // WHERE lo fija tambien en la consulta: defensa en profundidad, y el
    // comportamiento no depende del rol de la conexion (en pruebas la API
    // conecta como superusuario, que PostgreSQL exime de RLS).
    return {
      items: await this.tenantService.withTenant(organizationId, (tx) =>
        this.query(tx, { tenantId: organizationId }),
      ),
    };
  }

  private query(tx: Prisma.TransactionClient, where?: Prisma.AuditLogWhereInput) {
    return tx.auditLog.findMany({ where, orderBy: { at: "desc" }, take: 100 });
  }
}
