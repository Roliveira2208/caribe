/**
 * GUC (parametros de sesion de PostgreSQL) que activan las politicas RLS de
 * las tablas de negocio (T-F1-0d, spec tenant-isolation). TenantService los
 * fija con set_config(..., true) dentro de una transaccion: el valor vive solo
 * durante esa transaccion y no se hereda de una peticion o trabajo anterior.
 *
 * - `app.tenant_id`: agencia del contexto `tenant` (personal) o `tenant`+`owner`.
 * - `app.user_id`: persona del contexto `owner` (cliente sin agencia activa).
 * - `app.public`: catalogo anonimo, solo lectura.
 * - `app.platform`: Super Admin de plataforma.
 * - `app.rates_global`: job diario de la tasa BCV, solo filas globales de
 *   `exchange_rates`.
 */
export const TENANT_GUC = "app.tenant_id";
export const USER_GUC = "app.user_id";
export const PUBLIC_GUC = "app.public";
export const PLATFORM_GUC = "app.platform";
export const RATES_GLOBAL_GUC = "app.rates_global";

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
 * Contexto de datos resuelto de una peticion o de un trabajo (spec
 * tenant-isolation, "Contextos de datos explicitos"):
 * - "tenant": la sesion tiene organizacion activa (membresia verificada por
 *   Better Auth al fijarla); el GUC app.tenant_id queda listo para RLS.
 * - "owner": persona sobre sus propias filas, sin exigir membresia ni
 *   organizacion activa (app.user_id).
 * - "tenant+owner": cliente que opera sobre una reserva propia dentro de una
 *   agencia (p. ej. al pagar); se fijan ambos GUC y las politicas combinan
 *   con OR.
 * - "public": catalogo anonimo; solo lectura de productos publicados, su
 *   disponibilidad y los destinos que referencian.
 * - "platform": Super Admin sin organizacion activa (no es miembro de
 *   ninguna): ve plataforma (tenant_id NULL) y todas las agencias.
 * - "rates_global": trabajo diario de la tasa BCV; solo escribe filas de
 *   exchange_rates con tenant_id NULL.
 * - "none": ni organizacion ni rol de plataforma (Cliente). Sin GUC, las
 *   politicas RLS no devuelven nada: fallo cerrado.
 *
 * Solo "tenant" y "platform" se resuelven de la sesion (tenantContextFromSession);
 * los demas los elige el caso de uso con la operacion concreta.
 */
export type TenantContext =
  | { kind: "tenant"; tenantId: string }
  | { kind: "owner"; userId: string }
  | { kind: "tenant+owner"; tenantId: string; userId: string }
  | { kind: "public" }
  | { kind: "platform" }
  | { kind: "rates_global" }
  | { kind: "none" };

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
