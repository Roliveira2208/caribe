import { PATH_METADATA } from "@nestjs/common/constants";
import type { PermissionCheck } from "@thallesp/nestjs-better-auth";
import type { Role } from "better-auth/plugins/access";
import {
  accessControl,
  adminRole,
  agentRole,
  memberRole,
  ownerRole,
  providerRole,
  superAdminRole,
  systemUserRole,
} from "../access.js";
import { PLATFORM_ROLE } from "../tenant/tenant-context.js";

/**
 * Clasificacion de rutas administrativas (T-F0-8, delta de auth-access).
 *
 * Un endpoint es administrativo si esta registrado bajo el prefijo /admin de
 * la API (las rutas de negocio se registran sin el prefijo global /api/v1) o
 * si exige un permiso exclusivo de los roles administrativos (owner/admin de
 * agencia o super_admin de plataforma). Tambien lo es si exige directamente
 * uno de esos roles con @Roles/@OrgRoles: es una condicion mas estricta que
 * la spec, nunca menos.
 *
 * La segunda familia son las rutas servidas por el middleware de Better Auth
 * (fix de la verificacion f0-foundations): las escrituras del plugin admin
 * (/api/auth/admin/*) y las escrituras administrativas del plugin
 * organization. Ambas familias las clasifica este mismo modulo para que el
 * guard de Nest, los hooks de Better Auth y el inventario de rutas de los
 * tests calculen lo mismo sin duplicar la definicion.
 */

/** Roles de agencia que exigen segundo factor (matriz T-F0-6). */
export const AGENCY_ADMIN_ROLES: readonly string[] = ["owner", "admin"];

/**
 * Claves internas que escriben los decoradores de @thallesp/nestjs-better-
 * auth con SetMetadata. La lib no las exporta; si una version futura cambia
 * alguna, el guard deja de verla y falla el inventario e2e de rutas (esa es
 * la red de seguridad de ese test).
 */
export const AUTH_METADATA_KEYS = {
  systemRoles: "ROLES",
  orgRoles: "ORG_ROLES",
  userHasPermission: "USER_HAS_PERMISSION",
  memberHasPermission: "MEMBER_HAS_PERMISSION",
} as const;

/** Forma de los checks de permisos que aceptan los decoradores de la lib. */
export interface PermissionCheckOptions {
  permission?: PermissionCheck;
  permissions?: PermissionCheck;
}

/** Lo que el guard y el inventario necesitan saber de una ruta registrada. */
export interface RouteSecurity {
  /** Ruta registrada (controller + metodo, sin el prefijo global /api/v1). */
  path: string;
  /** Permisos exigidos por decoradores (capa sistema y agencia, unidos). */
  permissions?: PermissionCheck;
  /** Roles de sistema exigidos (@Roles). */
  systemRoles?: string[];
  /** Roles de agencia exigidos (@OrgRoles). */
  orgRoles?: string[];
}

const ADMIN_ROLES: Role[] = [ownerRole, adminRole, superAdminRole];
const NON_ADMIN_ROLES: Role[] = [systemUserRole, agentRole, providerRole, memberRole];

/**
 * Permisos exclusivos de los roles administrativos: concedidos a owner,
 * admin o super_admin y a ningun otro rol. Se calculan desde la matriz de
 * access.ts (no a mano) para que un cambio de matriz recalibre que rutas
 * exigen segundo factor sin tocar este archivo.
 */
const adminExclusivePermissions: ReadonlySet<string> = computeAdminExclusivePermissions();

function computeAdminExclusivePermissions(): ReadonlySet<string> {
  const exclusive = new Set<string>();
  for (const [resource, actions] of Object.entries(accessControl.statements)) {
    for (const action of actions) {
      const statement = { [resource]: [action] };
      const heldByAdmin = ADMIN_ROLES.some((role) => role.authorize(statement).success);
      const heldByOthers = NON_ADMIN_ROLES.some((role) => role.authorize(statement).success);
      if (heldByAdmin && !heldByOthers) exclusive.add(`${resource}:${action}`);
    }
  }
  return exclusive;
}

/** true si algun permiso del check es exclusivo de los roles administrativos. */
export function requiresAdminExclusivePermission(permissions: PermissionCheck): boolean {
  return Object.entries(permissions).some(([resource, actions]) =>
    actions.some((action) => adminExclusivePermissions.has(`${resource}:${action}`)),
  );
}

/** true si la ruta es administrativa (ver definicion arriba). */
export function isAdminRoute(route: RouteSecurity): boolean {
  if (route.path === "admin" || route.path.startsWith("admin/")) return true;
  if (route.permissions && requiresAdminExclusivePermission(route.permissions)) return true;
  if (route.systemRoles?.includes(PLATFORM_ROLE)) return true;
  if (route.orgRoles?.some((role) => AGENCY_ADMIN_ROLES.includes(role))) return true;
  return false;
}

/** Une los checks de permisos de todos los decoradores de una ruta. */
export function mergeRoutePermissions(
  ...checks: Array<PermissionCheckOptions | undefined>
): PermissionCheck | undefined {
  const merged: Record<string, string[]> = {};
  for (const check of checks) {
    for (const source of [check?.permission, check?.permissions]) {
      if (!source) continue;
      for (const [resource, actions] of Object.entries(source)) {
        merged[resource] = [...(merged[resource] ?? []), ...actions];
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Une la ruta del controller y la del metodo ("admin/x" + "y" -> "admin/x/y"). */
export function joinRoutePath(base?: string, method?: string): string {
  const clean = (value: string) => value.replace(/^\/+|\/+$/g, "");
  return [base, method]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .map(clean)
    .join("/");
}

/** Ruta registrada de un handler (sin el prefijo global /api/v1). */
export function registeredRoutePath(controller: object, handler: object): string {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
  const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
  return joinRoutePath(base, methodPath);
}

// ---------------------------------------------------------------------------
// Rutas del middleware de Better Auth (fix de la verificacion f0-foundations)
// ---------------------------------------------------------------------------

/** Record de un valor desconocido (los endpoints devuelven JSON plano). */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** id (string) de un registro; undefined si no viene o no es string. */
function idOf(record: Record<string, unknown> | undefined): string | undefined {
  const id = record?.["id"];
  return typeof id === "string" ? id : undefined;
}

/** Estado previo que el hook before guarda para que el after pueda auditar. */
export interface BetterAuthPreState {
  sessionId: string;
  userId: string;
}

/**
 * Regla de auditoria de una escritura administrativa de Better Auth (delta de
 * audit). entityId y after se extraen del resultado del endpoint y de su body;
 * el estado previo (antes) queda NULL porque el middleware solo observa el
 * resultado, y lo declara el delta de audit.
 */
export interface BetterAuthAuditRule {
  /** Nombre con prefijo auth. para distinguirlas de las de la API de Nest. */
  action: string;
  /** Entidad afectada: user, session, invitation, member, organization. */
  entity: string;
  /** Escrituras del plugin admin: plataforma (tenant_id NULL). */
  platform?: boolean;
  /** Marca que el antes se pierde al ejecutar: el hook before lo guarda. */
  preState?: "session-by-token";
  entityIdOf: (
    returned: Record<string, unknown>,
    body: Record<string, unknown>,
    pre?: BetterAuthPreState,
  ) => string | undefined;
  /** after de la fila; por defecto, el resultado del endpoint. */
  afterOf?: (returned: Record<string, unknown>, body: Record<string, unknown>, pre?: BetterAuthPreState) => unknown;
}

/** Ruta administrativa servida por el middleware de Better Auth. */
export interface BetterAuthAdminRoute {
  /** Path relativo al basePath de Better Auth, con barra inicial. */
  path: string;
  /** Metodos HTTP con los que responde la ruta. */
  methods: readonly string[];
  /**
   * Capa que autoriza la escritura (B3 del segundo informe): las rutas del
   * plugin admin son de plataforma; las de organizacion, de agencia. El hook
   * before resuelve la organizacion objetivo solo en las de organizacion y el
   * after imputa la fila de auditoria a esa agencia.
   */
  authorization: "platform" | "organization";
  /** Regla de auditoria; ausente en las rutas administrativas de solo lectura. */
  audit?: BetterAuthAuditRule;
}

/** id del usuario afectado, del objeto user del resultado (set-role, ban...). */
function userIdFromReturnedUser(returned: Record<string, unknown>): string | undefined {
  return idOf(asRecord(returned["user"]));
}

/** id del usuario afectado, del body (revoke-user-sessions, remove-user...). */
function userIdFromBody(_returned: Record<string, unknown>, body: Record<string, unknown>): string | undefined {
  const userId = body["userId"];
  return typeof userId === "string" ? userId : undefined;
}

/**
 * Rutas administrativas del middleware de Better Auth. La lista es cerrada a
 * proposito: si una actualizacion de la lib anade o renombra una ruta, el
 * inventario e2e (two-factor.e2e.ts) falla hasta que alguien la clasifique
 * conscientemente aqui o en BETTER_AUTH_NON_ADMIN_ORGANIZATION_PATHS.
 *
 * Las formas de retorno verificadas contra better-auth 1.7.18:
 * - set-role/create-user/ban-user/unban-user/impersonate-user -> { user }
 * - update-user (adminUpdateUser) y update-member-role/update/invite-member/
 *   cancel-invitation/delete (organization) -> objeto plano con id
 * - remove-member -> { member }; stop-impersonating -> { session, user }
 * - revoke-user-session(s)/remove-user -> { success };
 *   set-user-password -> { status }
 */
export const BETTER_AUTH_ADMIN_ROUTES: readonly BetterAuthAdminRoute[] = [
  // Plugin admin: escrituras de plataforma, tenant_id NULL.
  {
    path: "/admin/set-role",
    methods: ["POST"],
    authorization: "platform",
    audit: {
      platform: true,
      action: "auth.admin.set-role",
      entity: "user",
      entityIdOf: userIdFromReturnedUser,
    },
  },
  {
    path: "/admin/create-user",
    methods: ["POST"],
    authorization: "platform",
    audit: {
      platform: true,
      action: "auth.admin.create-user",
      entity: "user",
      entityIdOf: userIdFromReturnedUser,
    },
  },
  {
    path: "/admin/update-user",
    methods: ["POST"],
    authorization: "platform",
    audit: {
      platform: true,
      action: "auth.admin.update-user",
      entity: "user",
      entityIdOf: (returned) => idOf(asRecord(returned)),
    },
  },
  {
    path: "/admin/ban-user",
    methods: ["POST"],
    authorization: "platform",
    audit: {
      platform: true,
      action: "auth.admin.ban-user",
      entity: "user",
      entityIdOf: userIdFromReturnedUser,
    },
  },
  {
    path: "/admin/unban-user",
    methods: ["POST"],
    authorization: "platform",
    audit: {
      platform: true,
      action: "auth.admin.unban-user",
      entity: "user",
      entityIdOf: userIdFromReturnedUser,
    },
  },
  {
    path: "/admin/impersonate-user",
    methods: ["POST"],
    authorization: "platform",
    audit: {
      platform: true,
      action: "auth.admin.impersonate-user",
      entity: "user",
      entityIdOf: userIdFromReturnedUser,
    },
  },
  {
    path: "/admin/stop-impersonating",
    methods: ["POST"],
    authorization: "platform",
    audit: {
      platform: true,
      action: "auth.admin.stop-impersonating",
      entity: "session",
      entityIdOf: (returned) => idOf(asRecord(returned["session"])),
    },
  },
  {
    path: "/admin/revoke-user-session",
    methods: ["POST"],
    authorization: "platform",
    audit: {
      platform: true,
      action: "auth.admin.revoke-user-session",
      entity: "session",
      // La fila de session se borra al ejecutar la accion: el id y el dueno
      // se guardan en el hook before (preState) porque despues ya no existen.
      //
      // M3 del segundo informe: la lib responde 200 {success:true} aunque el
      // token no corresponda a ninguna fila de session (deleteSession es un
      // no-op silencioso). Con el preestado vacio el hook after no audita: un
      // 200 no prueba que se revoco nada. El e2e de auth lo deja documentado.
      preState: "session-by-token",
      entityIdOf: (_returned, _body, pre) => pre?.sessionId,
      afterOf: (_returned, _body, pre) => (pre?.userId ? { userId: pre.userId } : undefined),
    },
  },
  {
    path: "/admin/revoke-user-sessions",
    methods: ["POST"],
    authorization: "platform",
    audit: {
      platform: true,
      action: "auth.admin.revoke-user-sessions",
      entity: "user",
      entityIdOf: userIdFromBody,
    },
  },
  {
    path: "/admin/remove-user",
    methods: ["POST"],
    authorization: "platform",
    audit: {
      platform: true,
      action: "auth.admin.remove-user",
      entity: "user",
      entityIdOf: userIdFromBody,
    },
  },
  {
    path: "/admin/set-user-password",
    methods: ["POST"],
    authorization: "platform",
    audit: {
      platform: true,
      action: "auth.admin.set-user-password",
      entity: "user",
      entityIdOf: userIdFromBody,
    },
  },
  // Plugin admin: solo lectura. Exigen TOTP, no auditan.
  { path: "/admin/get-user", methods: ["GET"], authorization: "platform" },
  { path: "/admin/list-users", methods: ["GET"], authorization: "platform" },
  { path: "/admin/list-user-sessions", methods: ["POST"], authorization: "platform" },
  { path: "/admin/has-permission", methods: ["POST"], authorization: "platform" },
  // Plugin organization: escrituras administrativas de agencia. create no
  // audita ni se salta con sesion: con allowUserToCreateOrganization: false
  // una sesion de usuario nunca llega a escribir (403 de la propia lib).
  { path: "/organization/create", methods: ["POST"], authorization: "organization" },
  {
    path: "/organization/update",
    methods: ["POST"],
    authorization: "organization",
    audit: {
      action: "auth.organization.update",
      entity: "organization",
      entityIdOf: (returned) => idOf(asRecord(returned)),
    },
  },
  {
    path: "/organization/delete",
    methods: ["POST"],
    authorization: "organization",
    audit: {
      action: "auth.organization.delete",
      entity: "organization",
      entityIdOf: (returned) => idOf(asRecord(returned)),
    },
  },
  {
    path: "/organization/invite-member",
    methods: ["POST"],
    authorization: "organization",
    audit: {
      action: "auth.organization.invite-member",
      entity: "invitation",
      entityIdOf: (returned) => idOf(asRecord(returned)),
    },
  },
  {
    path: "/organization/cancel-invitation",
    methods: ["POST"],
    authorization: "organization",
    audit: {
      action: "auth.organization.cancel-invitation",
      entity: "invitation",
      entityIdOf: (returned) => idOf(asRecord(returned)),
    },
  },
  {
    path: "/organization/remove-member",
    methods: ["POST"],
    authorization: "organization",
    audit: {
      action: "auth.organization.remove-member",
      entity: "member",
      entityIdOf: (returned) => idOf(asRecord(returned["member"])),
    },
  },
  {
    path: "/organization/update-member-role",
    methods: ["POST"],
    authorization: "organization",
    audit: {
      action: "auth.organization.update-member-role",
      entity: "member",
      entityIdOf: (returned) => idOf(asRecord(returned)),
    },
  },
];

/**
 * Rutas de /organization/* que NO son administrativas (lectura, aceptar o
 * rechazar invitaciones propias, fijar la agencia activa): no exigen TOTP.
 * Completan la particion de /organization/* junto a BETTER_AUTH_ADMIN_ROUTES.
 */
export const BETTER_AUTH_NON_ADMIN_ORGANIZATION_PATHS: readonly string[] = [
  "/organization/accept-invitation",
  "/organization/check-slug",
  "/organization/get-active-member",
  "/organization/get-active-member-role",
  "/organization/get-full-organization",
  "/organization/get-invitation",
  "/organization/get-organization",
  "/organization/has-permission",
  "/organization/leave",
  "/organization/list",
  "/organization/list-invitations",
  "/organization/list-members",
  "/organization/list-user-invitations",
  "/organization/reject-invitation",
  "/organization/set-active",
];

const betterAuthRouteByPath = new Map<string, BetterAuthAdminRoute>(
  BETTER_AUTH_ADMIN_ROUTES.map((route) => [route.path, route]),
);

/** Ruta administrativa de Better Auth por path; undefined si no lo es. */
export function betterAuthAdminRouteOf(path: string | undefined): BetterAuthAdminRoute | undefined {
  if (!path) return undefined;
  return betterAuthRouteByPath.get(path);
}

// ---------------------------------------------------------------------------
// Organizacion objetivo de una escritura (B3 del segundo informe)
// ---------------------------------------------------------------------------

/** string no vacia: Better Auth trata "" como ausente en body.organizationId. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** organizationId de un registro (invitacion, miembro). */
function organizationIdOfRecord(record: Record<string, unknown> | undefined): string | undefined {
  return nonEmptyString(record?.["organizationId"]);
}

/** organizationId del cuerpo o de la query, en el orden en que los lee la lib. */
function organizationIdFromInputs(
  body: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined,
): string | undefined {
  return nonEmptyString(body?.["organizationId"]) ?? nonEmptyString(query?.["organizationId"]);
}

/**
 * Organizacion objetivo de una escritura de /organization/* para clasificar
 * el segundo factor: la del cuerpo o la query y, si no viene, la activa.
 * undefined si no puede determinarse: el hook falla cerrado.
 *
 * No se usa en las rutas del plugin admin: son de plataforma y no afectan a
 * una agencia en concreto.
 */
export function targetOrganizationIdOf(
  body: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined,
  activeOrganizationId: string | null | undefined,
): string | undefined {
  return organizationIdFromInputs(body, query) ?? nonEmptyString(activeOrganizationId);
}

/**
 * Agencia a la que imputar la fila de auditoria de una escritura de
 * organizacion: la del cuerpo/query, la de la entidad devuelta o, en su
 * defecto, la activa. cancel-invitation no recibe organizationId en el
 * cuerpo: la invitacion devuelta (que no se borra, se marca canceled) la
 * trae. /organization/update y delete devuelven la propia organizacion, cuyo
 * id ES el tenant.
 */
export function tenantOrganizationIdOf(
  entity: string,
  returned: Record<string, unknown>,
  body: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined,
  activeOrganizationId: string | null | undefined,
): string | undefined {
  const fromInputs = organizationIdFromInputs(body, query);
  if (fromInputs) return fromInputs;

  if (entity === "organization") return idOf(returned);

  const nested =
    entity === "invitation"
      ? organizationIdOfRecord(asRecord(returned["invitation"]))
      : entity === "member"
        ? organizationIdOfRecord(asRecord(returned["member"]))
        : undefined;
  return nested ?? organizationIdOfRecord(returned) ?? nonEmptyString(activeOrganizationId);
}
