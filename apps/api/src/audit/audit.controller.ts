import { Controller, ForbiddenException, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { AuditLog, Prisma } from "../generated/prisma/client.js";
import { csvLocale, type CsvResponse } from "../csv/csv.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import {
  activeMembershipOf,
  activeOrganizationRequired,
  type ActiveMembershipRequest,
} from "../tenant/active-membership.js";
import { ActiveMembershipGuard } from "../tenant/active-membership.guard.js";
import { isPlatformRole } from "../tenant/tenant-context.js";
import { TenantService } from "../tenant/tenant.service.js";
import { AGENCY_AUDIT_READER_ROLES } from "./audit-access.js";
import { auditCsv } from "./audit.csv.js";
import { sanitizeAuditPayload } from "./audit-sanitize.js";
import { decodeAuditCursor, encodeAuditCursor } from "./audit.cursor.js";
import {
  AUDIT_DEFAULT_LIMIT,
  type AuditLogItem,
  type AuditLogPage,
  listAuditLogsQuerySchema,
  type ListAuditLogsQuery,
} from "./audit.schemas.js";

/** Lo minimo que el controller necesita de la sesion (estructural). */
interface SessionInfo {
  session: { activeOrganizationId?: string | null };
  user: { id: string; role?: string | string[] | null };
}

interface AuthenticatedRequest extends ActiveMembershipRequest {
  session?: SessionInfo;
}

interface AuditFilters {
  action?: string;
  entity?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: { at: Date; id: string };
}

/**
 * Lectura de auditoria (T-F0-9 y T-F2-15, spec audit "Consulta" + delta
 * f2-admin-rates): filtros por accion, entidad, actor y rango, paginacion
 * keyset `(at, id)` y alcance por agencia/plataforma. `format=csv` entrega por
 * la MISMA ruta la pagina ya filtrada, con columnas permitidas y textos es/en.
 *
 * El alcance se resuelve en el handler (no con decoradores de permiso): la
 * lib AND-evalua @UserHasPermission y @MemberHasPermission sobre la misma
 * ruta, asi que "owner/admin de agencia O super_admin" no es expresable con
 * decoradores. El guard global sigue exigiendo sesion y, al estar bajo
 * /admin, TOTP para los roles administrativos; la matriz de acceso se
 * respeta con AGENCY_AUDIT_READER_ROLES (owner/admin, audit:read).
 */
@Controller("admin/audit-logs")
@UseGuards(ActiveMembershipGuard)
export class AuditController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listAuditLogsQuerySchema)) query: ListAuditLogsQuery,
    @Res() response: CsvResponse,
  ): Promise<void> {
    const session = request.session;
    if (!session) {
      // El guard global ya exigio sesion; red de seguridad.
      throw new ApiProblemException("UNAUTHENTICATED", "La auditoría requiere una sesión.");
    }
    const filters = toFilters(query);
    let page: AuditLogPage;

    if (isPlatformRole(session.user.role)) {
      // Super Admin: filas de plataforma y de todas las agencias.
      page = this.page(
        await this.tenantService.withPlatform((tx) => this.query(tx, filters)),
        filters.limit,
      );
    } else {
      const membership = await activeMembershipOf(request);
      if (!membership) {
        throw activeOrganizationRequired();
      }
      if (!AGENCY_AUDIT_READER_ROLES.includes(membership.role)) {
        // Escenario "Agente consulta auditoría" -> 403.
        throw new ForbiddenException(
          "Solo los administradores de la agencia consultan la auditoría",
        );
      }
      const organizationId = membership.organizationId;

      // RLS (app.tenant_id) garantiza el alcance con el rol de aplicacion y el
      // WHERE lo fija tambien en la consulta: defensa en profundidad, y el
      // comportamiento no depende del rol de la conexion (en pruebas la API
      // conecta como superusuario, que PostgreSQL exime de RLS).
      page = this.page(
        await this.tenantService.withTenant(organizationId, (tx) =>
          this.query(tx, filters, { tenantId: organizationId }),
        ),
        filters.limit,
      );
    }

    if (query.format === "csv") {
      response.type("text/csv; charset=utf-8");
      response.setHeader("Content-Disposition", 'attachment; filename="audit-logs.csv"');
      response.send(auditCsv(page, csvLocale(query.lang)));
      return;
    }
    response.json(page);
  }

  /** Consulta keyset: pide una fila de mas para saber si hay pagina siguiente. */
  private query(
    tx: Prisma.TransactionClient,
    filters: AuditFilters,
    scope?: Prisma.AuditLogWhereInput,
  ): Promise<AuditLog[]> {
    const conditions: Prisma.AuditLogWhereInput[] = [];
    if (scope) conditions.push(scope);
    if (filters.action) conditions.push({ action: filters.action });
    if (filters.entity) conditions.push({ entity: filters.entity });
    if (filters.actorId) conditions.push({ actorId: filters.actorId });
    if (filters.from || filters.to) {
      conditions.push({
        at: {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        },
      });
    }
    if (filters.cursor) {
      conditions.push({
        OR: [
          { at: { lt: filters.cursor.at } },
          { at: filters.cursor.at, id: { lt: filters.cursor.id } },
        ],
      });
    }

    return tx.auditLog.findMany({
      where: conditions.length > 0 ? { AND: conditions } : undefined,
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: filters.limit + 1,
    });
  }

  /** Arma la pagina: recorta la fila extra y calcula el cursor siguiente. */
  private page(rows: AuditLog[], limit: number): AuditLogPage {
    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;
    const items = visible.map(toItem);
    const last = visible.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last ? encodeAuditCursor({ at: last.at.toISOString(), id: last.id }) : null,
    };
  }
}

/** Fila de la API: estados redactados tambien en lectura y fecha ISO. */
function toItem(row: AuditLog): AuditLogItem {
  return {
    id: row.id,
    tenantId: row.tenantId,
    actorId: row.actorId,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    before: row.before === null ? null : sanitizeAuditPayload(row.before),
    after: row.after === null ? null : sanitizeAuditPayload(row.after),
    ip: row.ip,
    at: row.at.toISOString(),
  };
}

/** Convierte la query ya validada al filtro interno (fechas y cursor). */
function toFilters(query: ListAuditLogsQuery): AuditFilters {
  const filters: AuditFilters = { limit: query.limit ?? AUDIT_DEFAULT_LIMIT };
  if (query.action !== undefined) filters.action = query.action;
  if (query.entity !== undefined) filters.entity = query.entity;
  if (query.actor !== undefined) filters.actorId = query.actor;
  if (query.from !== undefined) filters.from = new Date(query.from);
  if (query.to !== undefined) filters.to = new Date(query.to);
  if (query.cursor !== undefined) {
    const cursor = decodeAuditCursor(query.cursor);
    filters.cursor = { at: new Date(cursor.at), id: cursor.id };
  }
  return filters;
}
