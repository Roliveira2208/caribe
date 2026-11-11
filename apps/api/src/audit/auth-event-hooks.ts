import { randomUUID } from "node:crypto";
import { getIP, isAPIError } from "better-auth/api";
import {
  betterAuthAdminRouteOf,
  isBetterAuthAdminWriteRoute,
  targetOrganizationIdOf,
  tenantOrganizationIdOf,
  type BetterAuthAdminRoute,
  type BetterAuthPreState,
} from "../admin/admin-route.js";
import type { AdminSessionInfo } from "../admin/admin-session.js";
import {
  authEventService,
  type AuthEventAttempt,
  type AuthEventError,
  type AuthEventResult,
} from "./auth-event.service.js";

/**
 * Hooks de auth_events para el middleware de Better Auth (T-F1-0b, delta de
 * audit).
 *
 * - El intento se escribe en el `before` cuando hay sesion y la ruta es una
 *   escritura administrativa. Si esa escritura falla, el hook lanza y la
 *   accion no se ejecuta (fallo cerrado).
 * - El resultado se escribe en el `after` (exito o APIError) y, cuando el
 *   `before` rechaza o lanza, en su propio `catch`: Better Auth no ejecuta
 *   `after` si `before` lanza, y el rechazo por segundo factor tiene que
 *   dejar su fila de resultado.
 * - El rate limiter corre antes de los hooks y las peticiones sin sesion no
 *   llegan a escribir: ninguno de los dos deja filas.
 *
 * La correlacion viaja en un WeakMap por `ctx.context` (el objeto de contexto
 * de la peticion), junto con el tenant del intento y la organizacion activa
 * de la sesion. No se guarda cuerpo, cookie, token ni mensaje de error.
 */

/** Lo minimo que los hooks necesitan del contexto de Better Auth. */
export interface AuthEventHookContext {
  path: string;
  body?: unknown;
  query?: unknown;
  request?: Request;
  context: {
    returned?: unknown;
    options: Parameters<typeof getIP>[1];
    logger: { error: (message: string, ...args: unknown[]) => void };
  };
}

interface PendingAttempt extends AuthEventAttempt {
  /** Organizacion activa de la sesion en el momento del intento. */
  activeOrganizationId: string | null;
}

/** Intento pendiente de resultado, por objeto de contexto de la peticion. */
const pendingAttempts = new WeakMap<object, PendingAttempt>();

/** Ruta de escritura administrativa de Better Auth; undefined si no lo es. */
export function authEventWriteRouteOf(
  path: string | undefined,
): BetterAuthAdminRoute | undefined {
  return isBetterAuthAdminWriteRoute(path) ? betterAuthAdminRouteOf(path) : undefined;
}

/**
 * Registra el intento y deja la correlacion lista para el resultado. El
 * llamador decide el fallo cerrado: si esta promesa rechaza, el `before`
 * lanza y la escritura no se ejecuta.
 */
export async function beginAuthEvent(
  ctx: AuthEventHookContext,
  route: BetterAuthAdminRoute,
  session: AdminSessionInfo,
): Promise<void> {
  const body = asRecord(ctx.body);
  const query = asRecord(ctx.query);
  // En las rutas de organizacion el intento se imputa a la agencia objetivo
  // cuando se conoce; "unknown" y "sin objetivo" quedan en NULL (solo los ve
  // el Super Admin). Las rutas de plataforma no tienen agencia: NULL.
  const targetOrganizationId =
    route.authorization === "organization"
      ? targetOrganizationIdOf(
          route.targetOrganization,
          body,
          query,
          session.session.activeOrganizationId,
        )
      : undefined;

  const attempt: AuthEventAttempt = {
    correlationId: randomUUID(),
    tenantId: targetOrganizationId ?? null,
    actorId: session.user.id,
    route: route.path,
    method: methodOf(ctx),
    ip: ctx.request ? getIP(ctx.request, ctx.context.options) : null,
  };
  pendingAttempts.set(ctx.context, {
    ...attempt,
    activeOrganizationId: session.session.activeOrganizationId ?? null,
  });
  await authEventService.recordAttempt(attempt);
}

/**
 * Registra el resultado del intento pendiente. Best-effort por contrato: si
 * la escritura falla, el fallo va al log y la accion ya confirmada se
 * mantiene. Sin intento pendiente (peticion sin sesion o ruta de solo
 * lectura) no hace nada.
 *
 * `error` llega desde el `catch` del `before` o desde el `after` con el
 * APIError devuelto por el handler. En los errores el tenant es el del
 * intento; en los exitos, la agencia de la entidad devuelta cuando exista.
 */
export async function finishAuthEvent(
  ctx: AuthEventHookContext,
  error?: unknown,
  pre?: BetterAuthPreState,
): Promise<void> {
  const attempt = pendingAttempts.get(ctx.context);
  if (!attempt) return;
  pendingAttempts.delete(ctx.context);

  const route = betterAuthAdminRouteOf(ctx.path);
  if (!route) return;

  const returned = ctx.context.returned;
  const failed = error !== undefined || returned instanceof Error;
  const returnedRecord = asRecord(returned) ?? {};
  const entity = route.audit?.entity ?? null;
  const entityId =
    !failed && entity && route.audit
      ? (route.audit.entityIdOf(returnedRecord, asRecord(ctx.body) ?? {}, pre) ?? null)
      : null;

  const result: AuthEventResult = {
    correlationId: attempt.correlationId,
    tenantId: failed
      ? attempt.tenantId
      : resultTenantOf(route, entity, returnedRecord, ctx, attempt),
    actorId: attempt.actorId,
    route: attempt.route,
    method: attempt.method,
    ip: attempt.ip,
    outcome: failed ? "error" : "success",
    error: failed ? authEventErrorOf(error ?? returned) : null,
    entity,
    entityId,
  };

  try {
    await authEventService.recordResult(result);
  } catch (writeError) {
    ctx.context.logger.error(
      `auth_events de ${ctx.path}: la escritura del resultado falló`,
      writeError,
    );
  }
}

/** Forma estable { code, status, name }; nunca incluye el mensaje interno. */
export function authEventErrorOf(error: unknown): AuthEventError {
  if (isAPIError(error)) {
    const body = asRecord(error.body);
    const code = typeof body?.["code"] === "string" ? body["code"] : String(error.status);
    // La clase APIError de la lib no declara `name` en sus tipos, pero en
    // ejecucion hereda de Error y siempre es "APIError"; la spec exige un
    // nombre estable en la fila.
    return { code, status: error.statusCode, name: "APIError" };
  }
  return {
    code: "INTERNAL_SERVER_ERROR",
    status: 500,
    name: error instanceof Error && error.name ? error.name : "Error",
  };
}

/** Metodo HTTP de la peticion (las escrituras de la tabla son POST). */
function methodOf(ctx: AuthEventHookContext): string {
  return (ctx.request?.method ?? "POST").toUpperCase();
}

/** Registro de un valor desconocido (cuerpo/query/resultado JSON). */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * Agencia de la fila de resultado de un exito: la de la entidad devuelta
 * cuando exista; si la ruta no declara entidad (organization/create), el id
 * del objeto devuelto (la propia agencia). Las de plataforma quedan NULL.
 */
function resultTenantOf(
  route: BetterAuthAdminRoute,
  entity: string | null,
  returned: Record<string, unknown>,
  ctx: AuthEventHookContext,
  attempt: PendingAttempt,
): string | null {
  if (route.authorization === "platform") return null;
  if (entity) {
    return (
      tenantOrganizationIdOf(
        entity,
        returned,
        asRecord(ctx.body),
        asRecord(ctx.query),
        attempt.activeOrganizationId,
        route.targetOrganization,
      ) ?? null
    );
  }
  return typeof returned["id"] === "string" ? returned["id"] : null;
}
