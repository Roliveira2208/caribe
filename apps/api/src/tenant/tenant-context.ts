/**
 * GUC (parametros de sesion de PostgreSQL) que activan las politicas RLS de
 * las tablas con tenant_id (hoy audit_logs; catalogo y reservas llegan en
 * F1/F2). TenantService los fija con set_config(..., true) dentro de una
 * transaccion: el valor vive solo durante esa transaccion.
 */
export const TENANT_GUC = "app.tenant_id";
export const PLATFORM_GUC = "app.platform";

/**
 * Lo minimo que el TenantModule necesita de una sesion de Better Auth: la
 * organizacion activa y el rol de sistema. Estructural y sin importar la lib
 * para que la resolucion sea una funcion pura, facil de probar, y acepte la
 * sesion real del guard (`UserSession` es asignable a esta forma).
 */
export interface SessionTenantInfo {
  session: { activeOrganizationId?: string | null };
  user: { role?: string | string[] | null };
}

/**
 * Contexto de tenant resuelto de una peticion:
 * - "tenant": la sesion tiene organizacion activa (membresia verificada por
 *   Better Auth al fijarla); el GUC app.tenant_id queda listo para RLS.
 * - "platform": Super Admin sin organizacion activa (no es miembro de
 *   ninguna): ve plataforma (tenant_id NULL) y todas las agencias.
 * - "none": ni organizacion ni rol de plataforma (Cliente). Sin GUC, las
 *   politicas RLS no devuelven nada: fallo cerrado.
 */
export type TenantContext =
  { kind: "tenant"; tenantId: string } | { kind: "platform" } | { kind: "none" };

/** Rol de sistema con alcance de plataforma (matriz T-F0-6). */
export const PLATFORM_ROLE = "super_admin";

export function isPlatformRole(role: string | string[] | null | undefined): boolean {
  if (role === null || role === undefined) return false;
  return Array.isArray(role) ? role.includes(PLATFORM_ROLE) : role === PLATFORM_ROLE;
}

/**
 * Resuelve el contexto de tenant de una sesion. La organizacion activa gana
 * sobre el rol de plataforma: si un Super Admin llegara a fijar una agencia
 * activa, opera como miembro de esa agencia.
 */
export function tenantContextFromSession(
  session: SessionTenantInfo | null | undefined,
): TenantContext {
  const activeOrganizationId = session?.session.activeOrganizationId;
  if (activeOrganizationId) {
    return { kind: "tenant", tenantId: activeOrganizationId };
  }
  if (isPlatformRole(session?.user.role)) {
    return { kind: "platform" };
  }
  return { kind: "none" };
}
