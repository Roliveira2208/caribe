import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "@caribe/shared";
import type { AuthEvent, Prisma } from "../generated/prisma/client.js";
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

/** Lo minimo que el controller necesita de la sesion (estructural). */
interface SessionInfo {
  session: { activeOrganizationId?: string | null };
  user: { id: string; role?: string | string[] | null };
}

interface AuthenticatedRequest extends ActiveMembershipRequest {
  session?: SessionInfo;
}

/** Fila de auth_events tal como la expone la consulta (sin mensaje interno). */
interface AuthEventItem {
  id: string;
  tenantId: string | null;
  correlationId: string;
  phase: string;
  actorId: string | null;
  route: string;
  method: string;
  ip: string | null;
  outcome: string | null;
  error: { code: string; status: number; name: string } | null;
  entity: string | null;
  entityId: string | null;
  at: string;
}

/** Filtros ya validados de la consulta. */
interface AuthEventFilters {
  route?: string;
  outcome?: "success" | "error";
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: { at: Date; id: string };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Query de la consulta, validada con Zod estricto (T-F1-0c): una clave
 * desconocida o un parametro repetido (array) responden 422. `from` y `to`
 * son ISO 8601 y el rango se valida aqui, antes del handler.
 */
const querySchema = z
  .strictObject({
    route: z.string().min(1).optional(),
    outcome: z.enum(["success", "error"]).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
    cursor: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: "from no puede ser posterior a to",
      });
    }
  });

type AuthEventQuery = z.infer<typeof querySchema>;

/**
 * Consulta de auth_events (T-F1-0b, delta de audit "Visibilidad de los
 * intentos" y "Consulta de intentos"): solo lectura, con filtros por ruta,
 * `outcome` y rango de fechas, y paginacion por cursor keyset `(at, id)`.
 *
 * Alcance igual que la auditoria: el Admin de agencia solo ve los eventos de
 * su agencia; el Super Admin, los de plataforma (tenant_id NULL) y los de
 * todas las agencias. Ningun otro rol lee la tabla. El guard global exige
 * sesion y, al estar bajo /admin, TOTP para los roles administrativos.
 *
 * La respuesta expone el error como `{ code, status, name }`: nunca el
 * mensaje interno de la lib ni el cuerpo de la peticion.
 */
@Controller("admin/auth-events")
@UseGuards(ActiveMembershipGuard)
export class AuthEventsController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(querySchema)) query: AuthEventQuery,
  ) {
    const session = request.session;
    if (!session) {
      // El guard global ya exigio sesion; red de seguridad.
      throw new ApiProblemException("UNAUTHENTICATED", "Los eventos requieren una sesión.");
    }
    const filters = toFilters(query);

    if (isPlatformRole(session.user.role)) {
      // Super Admin: eventos de plataforma y de todas las agencias.
      return this.page(
        await this.tenantService.withPlatform((tx) => this.query(tx, filters)),
        filters.limit,
      );
    }

    const membership = await activeMembershipOf(request);
    if (!membership) {
      throw activeOrganizationRequired();
    }
    if (!AGENCY_AUDIT_READER_ROLES.includes(membership.role)) {
      // Escenario "Agente no lee eventos" -> 403.
      throw new ForbiddenException("Solo los administradores de la agencia consultan los eventos");
    }
    const organizationId = membership.organizationId;

    // RLS (app.tenant_id) garantiza el alcance con el rol de aplicacion y el
    // WHERE lo fija tambien en la consulta: defensa en profundidad, y el
    // comportamiento no depende del rol de la conexion (en pruebas la API
    // conecta como superusuario, que PostgreSQL exime de RLS).
    return this.page(
      await this.tenantService.withTenant(organizationId, (tx) =>
        this.query(tx, filters, { tenantId: organizationId }),
      ),
      filters.limit,
    );
  }

  /** Consulta keyset: pide una fila de mas para saber si hay pagina siguiente. */
  private query(
    tx: Prisma.TransactionClient,
    filters: AuthEventFilters,
    scope?: Prisma.AuthEventWhereInput,
  ): Promise<AuthEvent[]> {
    const conditions: Prisma.AuthEventWhereInput[] = [];
    if (scope) conditions.push(scope);
    if (filters.route) conditions.push({ route: filters.route });
    if (filters.outcome) conditions.push({ outcome: filters.outcome });
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

    return tx.authEvent.findMany({
      where: conditions.length > 0 ? { AND: conditions } : undefined,
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: filters.limit + 1,
    });
  }

  /** Arma la pagina: recorta la fila extra y calcula el cursor siguiente. */
  private page(
    rows: AuthEvent[],
    limit: number,
  ): { items: AuthEventItem[]; nextCursor: string | null } {
    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;
    const items = visible.map(toItem);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.at, last.id) : null,
    };
  }
}

/** Fila de la API: error estable y fecha ISO; nada mas del registro. */
function toItem(row: AuthEvent): AuthEventItem {
  return {
    id: row.id,
    tenantId: row.tenantId,
    correlationId: row.correlationId,
    phase: row.phase,
    actorId: row.actorId,
    route: row.route,
    method: row.method,
    ip: row.ip,
    outcome: row.outcome,
    error:
      row.outcome === "error"
        ? {
            code: row.errorCode ?? "UNKNOWN",
            status: row.errorStatus ?? 500,
            name: row.errorName ?? "Error",
          }
        : null,
    entity: row.entity,
    entityId: row.entityId,
    at: row.at.toISOString(),
  };
}

/** Cursor keyset `(at, id)` en base64url (JSON interno, no opaco por seguridad). */
function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify({ at, id }), "utf8").toString("base64url");
}

/** Convierte la query ya validada al filtro interno (fechas y cursor). */
function toFilters(query: AuthEventQuery): AuthEventFilters {
  const filters: AuthEventFilters = { limit: query.limit ?? DEFAULT_LIMIT };
  if (query.route !== undefined) filters.route = query.route;
  if (query.outcome !== undefined) filters.outcome = query.outcome;
  if (query.from !== undefined) filters.from = new Date(query.from);
  if (query.to !== undefined) filters.to = new Date(query.to);
  if (query.cursor !== undefined) filters.cursor = decodeCursor(query.cursor);
  return filters;
}

/** Cursor keyset `(at, id)` codificado en base64url; invalido -> 422. */
function decodeCursor(raw: string): { at: Date; id: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (typeof decoded !== "object" || decoded === null) {
    throw invalidCursor();
  }
  const record = decoded as Record<string, unknown>;
  const at = typeof record["at"] === "string" ? new Date(record["at"]) : undefined;
  const id = record["id"];
  if (!at || Number.isNaN(at.getTime()) || typeof id !== "string" || id.length === 0) {
    throw invalidCursor();
  }
  return { at, id };
}

function invalidCursor(): ApiProblemException {
  return new ApiProblemException("VALIDATION_ERROR", "La solicitud no es válida.", [
    { path: "cursor", message: "cursor inválido" },
  ]);
}
