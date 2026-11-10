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
 * La clasificacion es una funcion pura sobre la metadata de la ruta para que
 * el guard (en ejecucion) y el inventario de rutas de los tests calculen lo
 * mismo sin duplicar la definicion.
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
