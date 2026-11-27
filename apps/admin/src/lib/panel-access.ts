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

/** Vista de la cabecera: no activa nada, solo decide qué selector mostrar. */
export type OrganizationChoice =
  | { status: "hidden" }
  | { status: "choose"; organizations: AgencyOption[] }
  | { status: "fixed"; organization: AgencyOption };

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
 * Rol de la membresía activa para las matrices del panel (T-F2-8 y T-F2-11).
 * Better Auth ya expone esta lectura en `/organization/get-active-member-role`;
 * no se añade un endpoint propio y un rol ausente o inválido falla cerrado.
 */
export async function loadActiveMemberRole(
  options: LoadPanelAccessOptions,
): Promise<string | null> {
  const response = await authRequest("/organization/get-active-member-role", options);
  if (!response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null) return null;
  const role = (body as { role?: unknown }).role;
  return typeof role === "string" && role !== "" ? role : null;
}

/** Alias conservado para el panel de tasas; comparte la misma lectura. */
export const loadRateRole = loadActiveMemberRole;

/** Actor necesario para la matriz del visor de auditoría (T-F2-15). */
export interface AuditActor {
  status: "ready" | "platform" | "login";
  role: string | null;
}

/**
 * Resuelve en servidor si quien pide la auditoría es Super Admin (plataforma)
 * o un miembro con agencia activa. No fija la organización: solo lee la sesión
 * y el rol de la membresía activa, igual que el panel de tasas.
 */
export async function loadAuditActor(
  options: LoadPanelAccessOptions,
): Promise<AuditActor> {
  const response = await authRequest("/get-session", options);
  if (!response.ok) return { status: "login", role: null };
  const body = (await response.json().catch(() => null)) as SessionData | null;
  const user = body?.user;
  if (!user) return { status: "login", role: null };
  const roles = Array.isArray(user.role) ? user.role : [user.role];
  if (roles.includes(SUPER_ADMIN_ROLE)) {
    return { status: "platform", role: SUPER_ADMIN_ROLE };
  }
  const role = await loadActiveMemberRole(options);
  return role === null ? { status: "login", role: null } : { status: "ready", role };
}

/**
 * Id del usuario autenticado, leído de la misma sesión de Better Auth (T-F2-12).
 * Se usa solo para deshabilitar la revisión del propio pago; sin sesión válida
 * devuelve null y la UI falla cerrado.
 */
export async function loadSessionUser(
  options: LoadPanelAccessOptions,
): Promise<string | null> {
  const response = await authRequest("/get-session", options);
  if (!response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null) return null;
  const user = (body as { user?: { id?: unknown } }).user;
  return typeof user?.id === "string" && user.id !== "" ? user.id : null;
}

/**
 * Estado del selector de la cabecera. No fija la organización activa: las
 * páginas ya lo hacen con `loadPanelAccess`. Evita una segunda escritura de
 * `set-active` al renderizar la cabecera en cada ruta.
 */
export async function loadOrganizationChoice(
  options: LoadPanelAccessOptions,
): Promise<OrganizationChoice> {
  const sessionResponse = await authRequest("/get-session", options);
  if (!sessionResponse.ok) return { status: "hidden" };
  const sessionBody = (await sessionResponse.json().catch(() => null)) as SessionData | null;
  if (!sessionBody?.user) return { status: "hidden" };

  const organizationsResponse = await authRequest("/organization/list", options);
  if (!organizationsResponse.ok) return { status: "hidden" };
  const organizations = parseAgencies(await organizationsResponse.json().catch(() => null));
  const access = resolvePanelAccess(sessionBody, organizations);
  if (access.status === "choose") {
    return { status: "choose", organizations: access.organizations };
  }
  if (access.status === "ready" || access.status === "activate") {
    return { status: "fixed", organization: access.organization };
  }
  return { status: "hidden" };
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
