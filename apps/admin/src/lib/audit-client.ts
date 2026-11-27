import { AuthApiError, type Locale } from "@caribe/shared";

/**
 * Cliente del visor de auditoría (T-F2-15). La API es la autoridad: aquí solo
 * se construyen query strings con claves permitidas y se conserva el cursor
 * opaco que devuelve el servidor. Nunca se calcula ni se inventa un cursor.
 */

export type AuditAccessStatus = "ready" | "platform" | "login";

export interface AuditAccess {
  visible: boolean;
  canRead: boolean;
  scope: "agency" | "platform";
}

/** Matriz de lectura resuelta en servidor; la UI nunca decide por sí sola. */
export function resolveAuditAccess(status: AuditAccessStatus, role: string | null): AuditAccess {
  if (status === "platform") {
    // `resolvePanelAccess` solo entrega "platform" a un super_admin verificado.
    return { visible: true, canRead: true, scope: "platform" };
  }
  if (status !== "ready") {
    return { visible: false, canRead: false, scope: "agency" };
  }
  if (role === "owner" || role === "admin") {
    return { visible: true, canRead: true, scope: "agency" };
  }
  return { visible: false, canRead: false, scope: "agency" };
}

export interface AuditLogItem {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  at: string;
}

export interface AuthEventItem {
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

export interface AuditPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AuditLogFilters {
  action?: string;
  entity?: string;
  actor?: string;
  from?: string;
  to?: string;
  cursor?: string | null;
}

export interface AuthEventFilters {
  route?: string;
  outcome?: "success" | "error" | "all";
  from?: string;
  to?: string;
  cursor?: string | null;
}

export interface AuditApiOptions {
  fetchImpl?: typeof globalThis.fetch;
}

/** Convierte una respuesta HTTP fallida en el error tipado que entiende la UI. */
async function readError(response: Response): Promise<AuthApiError> {
  const body = (await response.json().catch(() => null)) as
    | { message?: unknown; code?: unknown }
    | null;
  const message =
    typeof body?.message === "string" && body.message !== ""
      ? body.message
      : response.statusText;
  const code = typeof body?.code === "string" ? body.code : undefined;
  return new AuthApiError(response.status, message, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setIfPresent(query: URLSearchParams, key: string, value: string | undefined): void {
  if (typeof value === "string" && value !== "") query.set(key, value);
}

/** Parsea la lista de auditoría descartando filas que no cumplen el contrato. */
function parseAuditPage(body: unknown): AuditPage<AuditLogItem> {
  if (!isRecord(body)) return { items: [], nextCursor: null };
  const items = Array.isArray(body["items"])
    ? body["items"].flatMap((entry): AuditLogItem[] => {
        if (!isRecord(entry)) return [];
        if (
          typeof entry["id"] !== "string" ||
          typeof entry["action"] !== "string" ||
          typeof entry["entity"] !== "string" ||
          typeof entry["entityId"] !== "string" ||
          typeof entry["at"] !== "string"
        ) {
          return [];
        }
        const tenantId = typeof entry["tenantId"] === "string" ? entry["tenantId"] : null;
        const actorId = typeof entry["actorId"] === "string" ? entry["actorId"] : null;
        const ip = typeof entry["ip"] === "string" ? entry["ip"] : null;
        return [
          {
            id: entry["id"],
            tenantId,
            actorId,
            action: entry["action"],
            entity: entry["entity"],
            entityId: entry["entityId"],
            before: entry["before"] ?? null,
            after: entry["after"] ?? null,
            ip,
            at: entry["at"],
          },
        ];
      })
    : [];
  return {
    items,
    nextCursor: typeof body["nextCursor"] === "string" ? body["nextCursor"] : null,
  };
}

/** Parsea la pestaña de eventos con el error estable `{ code, status, name }`. */
function parseAuthEventsPage(body: unknown): AuditPage<AuthEventItem> {
  if (!isRecord(body)) return { items: [], nextCursor: null };
  const items = Array.isArray(body["items"])
    ? body["items"].flatMap((entry): AuthEventItem[] => {
        if (!isRecord(entry)) return [];
        if (
          typeof entry["id"] !== "string" ||
          typeof entry["correlationId"] !== "string" ||
          typeof entry["phase"] !== "string" ||
          typeof entry["route"] !== "string" ||
          typeof entry["method"] !== "string" ||
          typeof entry["at"] !== "string"
        ) {
          return [];
        }
        const error = isRecord(entry["error"]) ? entry["error"] : null;
        return [
          {
            id: entry["id"],
            tenantId: typeof entry["tenantId"] === "string" ? entry["tenantId"] : null,
            correlationId: entry["correlationId"],
            phase: entry["phase"],
            actorId: typeof entry["actorId"] === "string" ? entry["actorId"] : null,
            route: entry["route"],
            method: entry["method"],
            ip: typeof entry["ip"] === "string" ? entry["ip"] : null,
            outcome: typeof entry["outcome"] === "string" ? entry["outcome"] : null,
            error:
              error && typeof error["code"] === "string" && typeof error["status"] === "number"
                ? {
                    code: error["code"],
                    status: error["status"],
                    name: typeof error["name"] === "string" ? error["name"] : "Error",
                  }
                : null,
            entity: typeof entry["entity"] === "string" ? entry["entity"] : null,
            entityId: typeof entry["entityId"] === "string" ? entry["entityId"] : null,
            at: entry["at"],
          },
        ];
      })
    : [];
  return {
    items,
    nextCursor: typeof body["nextCursor"] === "string" ? body["nextCursor"] : null,
  };
}

/** GET /api/v1/admin/audit-logs con filtros por acción, entidad, actor y rango. */
export async function listAdminAuditLogs(
  filters: AuditLogFilters,
  options: AuditApiOptions = {},
): Promise<AuditPage<AuditLogItem>> {
  const query = new URLSearchParams();
  setIfPresent(query, "action", filters.action);
  setIfPresent(query, "entity", filters.entity);
  setIfPresent(query, "actor", filters.actor);
  setIfPresent(query, "from", filters.from);
  setIfPresent(query, "to", filters.to);
  setIfPresent(query, "cursor", filters.cursor ?? undefined);
  const suffix = query.toString();
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch(`/api/v1/admin/audit-logs${suffix ? `?${suffix}` : ""}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  return parseAuditPage(await response.json().catch(() => null));
}

/**
 * CSV por la misma ruta de auditoría, con los MISMOS filtros aplicados y el
 * idioma activo. La API decide las columnas y traduce los estados.
 */
export async function downloadAdminAuditCsv(
  filters: AuditLogFilters,
  locale: Locale,
  options: AuditApiOptions = {},
): Promise<Blob> {
  const query = new URLSearchParams();
  setIfPresent(query, "action", filters.action);
  setIfPresent(query, "entity", filters.entity);
  setIfPresent(query, "actor", filters.actor);
  setIfPresent(query, "from", filters.from);
  setIfPresent(query, "to", filters.to);
  query.set("limit", "100");
  query.set("format", "csv");
  query.set("lang", locale);
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch(`/api/v1/admin/audit-logs?${query.toString()}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  return response.blob();
}

/** GET /api/v1/admin/auth-events con filtros por ruta, outcome y rango. */
export async function listAuthEvents(
  filters: AuthEventFilters,
  options: AuditApiOptions = {},
): Promise<AuditPage<AuthEventItem>> {
  const query = new URLSearchParams();
  setIfPresent(query, "route", filters.route);
  if (filters.outcome && filters.outcome !== "all") query.set("outcome", filters.outcome);
  setIfPresent(query, "from", filters.from);
  setIfPresent(query, "to", filters.to);
  setIfPresent(query, "cursor", filters.cursor ?? undefined);
  const suffix = query.toString();
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch(`/api/v1/admin/auth-events${suffix ? `?${suffix}` : ""}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  return parseAuthEventsPage(await response.json().catch(() => null));
}

/** El error de agencia activa tiene un mensaje propio en el panel. */
export function isAuditOrganizationError(cause: unknown): boolean {
  return cause instanceof AuthApiError && cause.code === "ACTIVE_ORGANIZATION_REQUIRED";
}
