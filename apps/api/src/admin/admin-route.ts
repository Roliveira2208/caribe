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
  // Se limpia cada parte ANTES de descartar vacias: un metodo sin path
  // declara "/" y, si se filtra antes de limpiar, deja una barra final
  // ("products/") que no es la ruta registrada por Nest.
  return [base, method]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter((part) => part.length > 0)
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
  /**
   * De donde sale la agencia objetivo para clasificar el segundo factor en
   * las rutas de organizacion (B3 y el bypass residual de cancel-invitation):
   * - "request": `organizationId` del cuerpo o la query y, si no viene, la
   *   activa.
   * - "unknown": la ruta no acepta `organizationId` y la agencia de la
   *   entidad no se conoce antes de ejecutar (cancel-invitation autoriza por
   *   la agencia de la invitacion; create no tiene agencia previa). Se ignora
   *   el cuerpo: un `organizationId` ajeno no puede librar del TOTP.
   * Obligatorio en las rutas de organizacion (lo comprueba el inventario e2e).
   */
  targetOrganization?: "request" | "unknown";
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
 * conscientemente aqui, en BETTER_AUTH_NON_ADMIN_ORGANIZATION_ROUTES o en
 * BETTER_AUTH_NON_ADMIN_ROUTES. Las tres listas cubren todas las rutas de
 * auth.api; el inventario compara el conjunto real, no solo la tabla.
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
  {
    path: "/organization/create",
    methods: ["POST"],
    authorization: "organization",
    // No acepta organizationId y no hay agencia previa que clasificar.
    targetOrganization: "unknown",
  },
  {
    path: "/organization/update",
    methods: ["POST"],
    authorization: "organization",
    targetOrganization: "request",
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
    targetOrganization: "request",
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
    targetOrganization: "request",
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
    // No acepta organizationId; autoriza por la agencia de la invitacion.
    targetOrganization: "unknown",
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
    targetOrganization: "request",
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
    targetOrganization: "request",
    audit: {
      action: "auth.organization.update-member-role",
      entity: "member",
      entityIdOf: (returned) => idOf(asRecord(returned)),
    },
  },
];

/**
 * Motivo por el que una ruta de Better Auth no exige segundo factor:
 * - "read": solo lectura.
 * - "self-service": el usuario actua sobre su propia cuenta, sesion o
 *   membresia.
 *
 * Cualquier escritura administrativa de agencia o de plataforma tiene que
 * estar en BETTER_AUTH_ADMIN_ROUTES.
 */
export type BetterAuthNonAdminJustification = "read" | "self-service";

/** Ruta de Better Auth que no exige segundo factor, con su justificacion. */
export interface BetterAuthNonAdminRoute {
  /** Path relativo al basePath de Better Auth, con barra inicial. */
  path: string;
  justification: BetterAuthNonAdminJustification;
  /** Motivo legible para la revision humana del inventario. */
  reason: string;
}

/**
 * Rutas de Better Auth fuera de /admin, /organization y /two-factor. Lista
 * cerrada (snapshot de better-auth 1.7.18): si un upgrade anade, renombra o
 * elimina una ruta, el inventario e2e falla hasta que alguien la clasifique
 * aqui. Incluye los dos paths con parametros de la lib; la tabla
 * administrativa no los admite porque su Map exacto no puede casar con
 * ctx.path (el modulo falla al cargar si se anade uno).
 */
export const BETTER_AUTH_NON_ADMIN_ROUTES: readonly BetterAuthNonAdminRoute[] = [
  {
    path: "/account-info",
    justification: "read",
    reason: "Informacion de la cuenta propia (lectura).",
  },
  {
    path: "/callback/:id",
    justification: "self-service",
    reason: "Callback de proveedor social sobre la cuenta propia; hoy no hay proveedores habilitados.",
  },
  {
    path: "/change-email",
    justification: "self-service",
    reason: "Cambio del correo de la cuenta propia.",
  },
  {
    path: "/change-password",
    justification: "self-service",
    reason: "Cambio de la contrasena de la cuenta propia.",
  },
  {
    path: "/delete-user",
    justification: "self-service",
    reason: "Baja de la cuenta propia.",
  },
  {
    path: "/delete-user/callback",
    justification: "self-service",
    reason: "Callback de la baja de la cuenta propia.",
  },
  {
    path: "/error",
    justification: "read",
    reason: "Pagina de error de Better Auth.",
  },
  {
    path: "/get-access-token",
    justification: "self-service",
    reason: "Token de acceso de la sesion propia.",
  },
  {
    path: "/get-session",
    justification: "read",
    reason: "Sesion actual (lectura).",
  },
  {
    path: "/link-social",
    justification: "self-service",
    reason: "Vinculacion de una cuenta social propia.",
  },
  {
    path: "/list-accounts",
    justification: "read",
    reason: "Cuentas vinculadas de la cuenta propia (lectura).",
  },
  {
    path: "/list-sessions",
    justification: "read",
    reason: "Sesiones de la cuenta propia (lectura).",
  },
  {
    path: "/ok",
    justification: "read",
    reason: "Comprobacion de salud de Better Auth.",
  },
  {
    path: "/refresh-token",
    justification: "self-service",
    reason: "Renovacion del token de la sesion propia.",
  },
  {
    path: "/request-password-reset",
    justification: "self-service",
    reason: "Solicitud de restablecimiento de la contrasena propia.",
  },
  {
    path: "/reset-password",
    justification: "self-service",
    reason: "Restablecimiento de la contrasena propia.",
  },
  {
    path: "/reset-password/:token",
    justification: "self-service",
    reason: "Restablecimiento de la contrasena propia con token.",
  },
  {
    path: "/revoke-other-sessions",
    justification: "self-service",
    reason: "Revocacion de las demas sesiones propias.",
  },
  {
    path: "/revoke-session",
    justification: "self-service",
    reason: "Revocacion de una sesion propia.",
  },
  {
    path: "/revoke-sessions",
    justification: "self-service",
    reason: "Revocacion de todas las sesiones propias.",
  },
  {
    path: "/send-verification-email",
    justification: "self-service",
    reason: "Reenvio del correo de verificacion de la cuenta propia.",
  },
  {
    path: "/sign-in/email",
    justification: "self-service",
    reason: "Inicio de sesion con correo y contrasena.",
  },
  {
    path: "/sign-in/social",
    justification: "self-service",
    reason: "Inicio de sesion social; hoy no hay proveedores habilitados.",
  },
  {
    path: "/sign-out",
    justification: "self-service",
    reason: "Cierre de la sesion propia.",
  },
  {
    path: "/sign-up/email",
    justification: "self-service",
    reason: "Registro con correo y contrasena.",
  },
  {
    path: "/unlink-account",
    justification: "self-service",
    reason: "Desvinculacion de una cuenta social propia.",
  },
  {
    path: "/update-session",
    justification: "self-service",
    reason: "Actualizacion de datos de la sesion propia.",
  },
  {
    path: "/update-user",
    justification: "self-service",
    reason: "Actualizacion del perfil propio.",
  },
  {
    path: "/verify-email",
    justification: "self-service",
    reason: "Verificacion del correo de la cuenta propia.",
  },
  {
    path: "/verify-password",
    justification: "self-service",
    reason: "Verificacion de la contrasena de la cuenta propia.",
  },
];

/**
 * Rutas de /organization/* que NO son administrativas (lectura, aceptar o
 * rechazar invitaciones propias, fijar la agencia activa): no exigen TOTP.
 * Completan la particion de /organization/* junto a BETTER_AUTH_ADMIN_ROUTES.
 * Cada entrada declara por que no exige segundo factor.
 */
export const BETTER_AUTH_NON_ADMIN_ORGANIZATION_ROUTES: readonly BetterAuthNonAdminRoute[] = [
  {
    path: "/organization/accept-invitation",
    justification: "self-service",
    reason: "Aceptar una invitacion propia.",
  },
  {
    path: "/organization/check-slug",
    justification: "read",
    reason: "Comprobar la disponibilidad de un slug.",
  },
  {
    path: "/organization/get-active-member",
    justification: "read",
    reason: "Membresia activa propia (lectura).",
  },
  {
    path: "/organization/get-active-member-role",
    justification: "read",
    reason: "Rol en la membresia activa propia (lectura).",
  },
  {
    path: "/organization/get-full-organization",
    justification: "read",
    reason: "Organizacion activa con sus miembros (lectura).",
  },
  {
    path: "/organization/get-invitation",
    justification: "read",
    reason: "Invitacion propia (lectura).",
  },
  {
    path: "/organization/get-organization",
    justification: "read",
    reason: "Organizacion (lectura).",
  },
  {
    path: "/organization/has-permission",
    justification: "read",
    reason: "Comprobacion de permisos (lectura).",
  },
  {
    path: "/organization/leave",
    justification: "self-service",
    reason: "Abandonar una organizacion propia.",
  },
  {
    path: "/organization/list",
    justification: "read",
    reason: "Organizaciones del usuario (lectura).",
  },
  {
    path: "/organization/list-invitations",
    justification: "read",
    reason: "Invitaciones de la organizacion (lectura).",
  },
  {
    path: "/organization/list-members",
    justification: "read",
    reason: "Miembros de la organizacion (lectura).",
  },
  {
    path: "/organization/list-user-invitations",
    justification: "read",
    reason: "Invitaciones del usuario (lectura).",
  },
  {
    path: "/organization/reject-invitation",
    justification: "self-service",
    reason: "Rechazar una invitacion propia.",
  },
  {
    path: "/organization/set-active",
    justification: "self-service",
    reason: "Fijar la organizacion activa de la sesion propia.",
  },
];

/** Paths de la allowlist de organizacion (vista derivada para el inventario). */
export const BETTER_AUTH_NON_ADMIN_ORGANIZATION_PATHS: readonly string[] =
  BETTER_AUTH_NON_ADMIN_ORGANIZATION_ROUTES.map((route) => route.path);

/**
 * La clasificacion administrativa es un Map exacto: un path con parametros
 * (:id) no puede casar con ctx.path y quedaria sin proteger. Falla al cargar
 * el modulo (build/arranque) hasta que la clasificacion soporte patrones.
 * Las rutas con parametros de la lib son no administrativas y viven en
 * BETTER_AUTH_NON_ADMIN_ROUTES, que si las declara explicitamente.
 */
function assertNoParameterizedAdminPath(
  routes: readonly { path: string }[],
  label: string,
): void {
  const parameterized = routes.filter((route) => route.path.includes(":"));
  if (parameterized.length > 0) {
    throw new Error(
      `${label} no admite paths con parametros (:): ${parameterized
        .map((route) => route.path)
        .join(", ")}`,
    );
  }
}

assertNoParameterizedAdminPath(BETTER_AUTH_ADMIN_ROUTES, "BETTER_AUTH_ADMIN_ROUTES");
assertNoParameterizedAdminPath(
  BETTER_AUTH_NON_ADMIN_ORGANIZATION_ROUTES,
  "BETTER_AUTH_NON_ADMIN_ORGANIZATION_ROUTES",
);

/*
 * Politica de rutas administrativas sin sesion (T-F1-0): no hay
 * autenticacion por token (API key, bearer, SSO, OAuth). Las rutas
 * administrativas se autentican solo por la cookie de sesion; sin sesion, la
 * lib rechaza la peticion y el hook no exige TOTP porque no hay rol que
 * clasificar. El inventario e2e comprueba que ninguna ruta administrativa
 * responde 2xx sin cookie y que el conjunto de plugins es exactamente
 * organization + admin + two-factor. Habilitar cualquier otro plugin exige
 * una change que actualice esta politica, la clasificacion y el inventario
 * (AGENTS.md, "Que NO hacer").
 */
const betterAuthRouteByPath = new Map<string, BetterAuthAdminRoute>(
  BETTER_AUTH_ADMIN_ROUTES.map((route) => [route.path, route]),
);

/** Ruta administrativa de Better Auth por path; undefined si no lo es. */
export function betterAuthAdminRouteOf(path: string | undefined): BetterAuthAdminRoute | undefined {
  if (!path) return undefined;
  return betterAuthRouteByPath.get(path);
}

/**
 * Rutas administrativas de solo lectura (T-F1-0b): exigen TOTP pero no
 * generan filas en auth_events porque no escriben nada. Las dos primeras usan
 * GET; list-user-sessions y has-permission usan POST por el cliente de la lib.
 * La lista es cerrada: un path que no esté en la tabla administrativa falla al
 * cargar el módulo.
 */
export const BETTER_AUTH_ADMIN_READ_ONLY_PATHS: readonly string[] = [
  "/admin/get-user",
  "/admin/list-users",
  "/admin/list-user-sessions",
  "/admin/has-permission",
];

const betterAuthAdminReadOnlyPaths = new Set(BETTER_AUTH_ADMIN_READ_ONLY_PATHS);

for (const path of BETTER_AUTH_ADMIN_READ_ONLY_PATHS) {
  if (!betterAuthRouteByPath.has(path)) {
    throw new Error(`${path} no está en BETTER_AUTH_ADMIN_ROUTES`);
  }
}

/**
 * true si el path es una escritura administrativa de Better Auth y por tanto
 * deja intento y resultado en auth_events (delta de audit, T-F1-0b). Las
 * rutas de solo lectura y las que no son administrativas devuelven false.
 */
export function isBetterAuthAdminWriteRoute(path: string | undefined): boolean {
  const route = betterAuthAdminRouteOf(path);
  return route !== undefined && !betterAuthAdminReadOnlyPaths.has(route.path);
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
 *
 * Devuelve `null` cuando la ruta no acepta `organizationId` y la agencia de
 * la entidad no se conoce antes de ejecutar ("unknown"): la clasificacion no
 * puede creerle el cuerpo a la peticion ni asumir la activa (cancel-invitation
 * autoriza por la agencia de la invitacion, que puede no ser la activa) y el
 * hook falla cerrado. `undefined` es "no hay objetivo" para las rutas que si
 * lo aceptan (sin cuerpo, query ni activa).
 *
 * No se usa en las rutas del plugin admin: son de plataforma y no afectan a
 * una agencia en concreto.
 */
export function targetOrganizationIdOf(
  targetOrganization: "request" | "unknown" | undefined,
  body: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined,
  activeOrganizationId: string | null | undefined,
): string | null | undefined {
  // Cualquier valor distinto de "request" (incluida una ruta sin declarar)
  // no puede clasificarse con datos de la peticion: falla cerrado.
  if (targetOrganization !== "request") return null;
  return organizationIdFromInputs(body, query) ?? nonEmptyString(activeOrganizationId);
}

/**
 * Agencia a la que imputar la fila de auditoria de una escritura de
 * organizacion: la del cuerpo/query, la de la entidad devuelta o, en su
 * defecto, la activa. cancel-invitation no recibe organizationId en el
 * cuerpo: la invitacion devuelta (que no se borra, se marca canceled) la
 * trae. /organization/update y delete devuelven la propia organizacion, cuyo
 * id ES el tenant.
 *
 * `targetOrganization` decide si el cuerpo/query puede usarse para imputar
 * (T-F0-19): solo cuando la ruta declara que su agencia objetivo sale de la
 * peticion ("request"). En las rutas "unknown" (cancel-invitation) el hook
 * after ve el cuerpo crudo antes de que la lib lo valide e ignore el campo,
 * asi que un `organizationId` de otra agencia desviaria la fila a un tenant
 * ajeno; ahi manda la entidad devuelta.
 */
export function tenantOrganizationIdOf(
  entity: string,
  returned: Record<string, unknown>,
  body: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined,
  activeOrganizationId: string | null | undefined,
  targetOrganization: "request" | "unknown" | undefined,
): string | undefined {
  const fromInputs =
    targetOrganization === "request" ? organizationIdFromInputs(body, query) : undefined;
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
