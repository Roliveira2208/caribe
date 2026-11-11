import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
} from "@nestjs/common";
import type { AuthEvent, Prisma } from "../generated/prisma/client.js";
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
const OUTCOMES = new Set(["success", "error"]);

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
export class AuthEventsController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest, @Query() rawQuery: Record<string, unknown>) {
    const session = request.session;
    if (!session) {
      // El guard global ya exigio sesion; red de seguridad.
      throw new ForbiddenException("Los eventos requieren una sesión");
    }
    const filters = parseFilters(rawQuery);

    if (isPlatformRole(session.user.role)) {
      // Super Admin: eventos de plataforma y de todas las agencias.
      return this.page(
        await this.tenantService.withPlatform((tx) => this.query(tx, filters)),
        filters.limit,
      );
    }

    const organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      throw new ForbiddenException(
        "Los eventos requieren una agencia activa o el rol de plataforma",
      );
    }
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, organizationId },
      select: { role: true },
    });
    if (!member || !AGENCY_AUDIT_READER_ROLES.includes(member.role)) {
      // Escenario "Agente no lee eventos" -> 403.
      throw new ForbiddenException("Solo los administradores de la agencia consultan los eventos");
    }

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

/** Valida la query de la consulta; cualquier valor fuera de rango es 400. */
function parseFilters(rawQuery: Record<string, unknown>): AuthEventFilters {
  const filters: AuthEventFilters = { limit: DEFAULT_LIMIT };

  const route = single(rawQuery["route"], "route");
  if (route !== undefined) {
    if (route.length === 0) throw invalidQuery("route no puede estar vacío");
    filters.route = route;
  }

  const outcome = single(rawQuery["outcome"], "outcome");
  if (outcome !== undefined) {
    if (!OUTCOMES.has(outcome)) {
      throw invalidQuery("outcome debe ser success o error");
    }
    filters.outcome = outcome as "success" | "error";
  }

  const from = single(rawQuery["from"], "from");
  if (from !== undefined) filters.from = parseDate(from, "from");

  const to = single(rawQuery["to"], "to");
  if (to !== undefined) filters.to = parseDate(to, "to");

  if (filters.from && filters.to && filters.from > filters.to) {
    throw invalidQuery("from no puede ser posterior a to");
  }

  const limit = single(rawQuery["limit"], "limit");
  if (limit !== undefined) {
    const value = Number(limit);
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
      throw invalidQuery(`limit debe ser un entero entre 1 y ${MAX_LIMIT}`);
    }
    filters.limit = value;
  }

  const cursor = single(rawQuery["cursor"], "cursor");
  if (cursor !== undefined) filters.cursor = decodeCursor(cursor);

  return filters;
}

/** Valor escalar de la query; los arrays (parametro repetido) son 400. */
function single(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalidQuery(`${name} debe ser un valor único`);
  return value;
}

function parseDate(value: string, name: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw invalidQuery(`${name} debe ser una fecha ISO 8601`);
  }
  return date;
}

/** Cursor keyset `(at, id)` codificado en base64url; invalido -> 400. */
function decodeCursor(raw: string): { at: Date; id: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalidQuery("cursor inválido");
  }
  if (typeof decoded !== "object" || decoded === null) {
    throw invalidQuery("cursor inválido");
  }
  const record = decoded as Record<string, unknown>;
  const at = typeof record["at"] === "string" ? new Date(record["at"]) : undefined;
  const id = record["id"];
  if (!at || Number.isNaN(at.getTime()) || typeof id !== "string" || id.length === 0) {
    throw invalidQuery("cursor inválido");
  }
  return { at, id };
}

function invalidQuery(detail: string): BadRequestException {
  return new BadRequestException({ code: "VALIDATION_ERROR", message: detail });
}
