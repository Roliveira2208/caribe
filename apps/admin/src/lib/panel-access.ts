import type { SessionData, SessionUser } from "@caribe/shared";

/** Agencia que el panel puede mostrar en el selector o en la cabecera. */
export interface AgencyOption {
  id: string;
  name: string;
}

/**
 * Estado resuelto de la agencia activa del panel. `activate` es una intención:
 * el cargador la ejecuta contra Better Auth antes de entregar `ready`.
 */
export type PanelAccess =
  | { status: "login" }
  | { status: "platform" }
  | { status: "no-membership" }
  | { status: "choose"; organizations: AgencyOption[] }
  | { status: "activate"; organization: AgencyOption }
  | { status: "ready"; organization: AgencyOption }
  | { status: "error" };

const SUPER_ADMIN_ROLE = "super_admin";

function isSuperAdmin(user: SessionUser): boolean {
  const roles = Array.isArray(user.role) ? user.role : [user.role];
  return roles.some((role) => role === SUPER_ADMIN_ROLE);
}

function activeOrganizationId(session: SessionData | null): string | null {
  const candidate = session?.session as { activeOrganizationId?: unknown } | null | undefined;
  return typeof candidate?.activeOrganizationId === "string" && candidate.activeOrganizationId !== ""
    ? candidate.activeOrganizationId
    : null;
}

/**
 * Decide qué pantalla debe ver quien entra al panel. La decisión es pura para
 * poder probar los cuatro escenarios de la spec sinmontar Next ni la API.
 */
export function resolvePanelAccess(
  session: SessionData | null,
  organizations: AgencyOption[],
): PanelAccess {
  if (!session?.user) return { status: "login" };
  if (isSuperAdmin(session.user)) return { status: "platform" };
  if (organizations.length === 0) return { status: "no-membership" };

  const activeId = activeOrganizationId(session);
  const active = activeId ? organizations.find((org) => org.id === activeId) : undefined;
  if (active) return { status: "ready", organization: active };

  if (organizations.length === 1) {
    return { status: "activate", organization: organizations[0]! };
  }
  return { status: "choose", organizations };
}

/** Parsea la respuesta de `/organization/list` de Better Auth de forma tolerante. */
export function parseAgencies(body: unknown): AgencyOption[] {
  const raw = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null
      ? ((body as { organizations?: unknown; items?: unknown }).organizations ??
        (body as { items?: unknown }).items)
      : null;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const candidate = entry as { id?: unknown; name?: unknown };
    if (typeof candidate.id !== "string" || candidate.id === "") return [];
    if (typeof candidate.name !== "string" || candidate.name === "") return [];
    return [{ id: candidate.id, name: candidate.name }];
  });
}

interface LoadPanelAccessOptions {
  /** Cabecera Cookie completa de la petición entrante (cookie de sesión). */
  cookieHeader: string;
  /** Origen confiable de la app para Better Auth. */
  origin: string;
  /** URL base de la API; por defecto la del entorno de desarrollo. */
  apiUrl?: string;
  /** fetch inyectable en pruebas. */
  fetchImpl?: typeof globalThis.fetch;
}

async function authRequest(
  path: string,
  options: LoadPanelAccessOptions,
  init: { method?: string; body?: string } = {},
): Promise<Response> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const apiUrl = options.apiUrl ?? process.env["API_URL"] ?? "http://localhost:3002";
  return doFetch(`${apiUrl}/api/auth${path}`, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: {
      cookie: options.cookieHeader,
      origin: options.origin,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    ...(init.body ? { body: init.body } : {}),
  });
}

/**
 * Resuelve la agencia activa en el servidor. Con una sola membresía fija la
 * agencia llamando a Better Auth; con varias no fija nada y deja elegir.
 */
export async function loadPanelAccess(
  options: LoadPanelAccessOptions,
): Promise<Exclude<PanelAccess, { status: "activate" }>> {
  const sessionResponse = await authRequest("/get-session", options);
  if (!sessionResponse.ok) return { status: "error" };
  const sessionBody = (await sessionResponse.json().catch(() => null)) as SessionData | null;
  const session = sessionBody?.user ? sessionBody : null;

  const organizationsResponse = await authRequest("/organization/list", options);
  if (!organizationsResponse.ok) return { status: "error" };
  const organizations = parseAgencies(await organizationsResponse.json().catch(() => null));

  const access = resolvePanelAccess(session, organizations);
  if (access.status !== "activate") return access;

  const setActive = await authRequest("/organization/set-active", options, {
    method: "POST",
    body: JSON.stringify({ organizationId: access.organization.id }),
  });
  if (!setActive.ok) return { status: "error" };
  return { status: "ready", organization: access.organization };
}
