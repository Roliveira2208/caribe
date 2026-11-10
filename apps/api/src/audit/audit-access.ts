/**
 * Roles de agencia que pueden leer la auditoria (spec audit "Consulta": solo
 * Admin de agencia y Super Admin). La correspondencia con la matriz T-F0-6 la
 * fija un test contra access.ts: si la matriz cambia, o el test o este listado
 * quedan desincronizados y la suite falla.
 */
export const AGENCY_AUDIT_READER_ROLES: readonly string[] = ["owner", "admin"];
