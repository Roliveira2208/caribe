import { createAccessControl } from "better-auth/plugins/access";

/**
 * Matriz de roles y permisos (T-F0-6, aprobada por el dueño; copia en
 * design.md de f0-foundations).
 *
 * Un unico archivo define el universo de recursos y acciones y, a partir de
 * el, los roles de las dos capas de Better Auth. Todo permiso es explicito:
 * ningun rol hereda de otro y TypeScript solo acepta aqui las acciones
 * declaradas en el universo.
 *
 * Capa de sistema (user.role, plugin admin; el mapa REEMPLAZA los defaults,
 * asi que el rol de sistema "admin" que trae Better Auth deja de existir):
 * - user (Cliente): sin permisos.
 * - super_admin: plataforma y negocio en solo lectura.
 *
 * Capa de agencia (member.role, plugin organization; el mapa SE MEZCLA con
 * los defaults, por eso "member" se neutraliza con permisos vacios):
 * - owner / admin: gestion completa de la agencia; solo owner la disuelve.
 * - agent: crea y consulta reservas, consulta pagos.
 * - provider: gestiona productos y consulta reservas.
 *
 * La propiedad de fila (proveedor edita solo SU producto, cliente ve solo SUS
 * reservas y documentos, 404 sobre lo ajeno) es de la capa de servicio y
 * llega con specs/catalog y bookings (F1); esta matriz solo fija permisos.
 */
export const accessControl = createAccessControl({
  // Negocio.
  product: ["create", "read", "update", "delete"],
  booking: ["create", "read", "update", "cancel"],
  payment: ["read", "review"],
  "exchange-rate": ["read", "update"],
  report: ["read"],
  audit: ["read"],
  // Gestion de la agencia.
  organization: ["create", "read", "update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  // Plataforma.
  user: ["create", "list", "get", "update", "set-role", "ban", "set-password"],
  session: ["list", "revoke"],
});

// ---------------------------------------------------------------------------
// Capa de sistema (user.role). Reemplaza el mapa del plugin admin.
// ---------------------------------------------------------------------------

/** Cliente: cualquier usuario sin rol de plataforma; sin permisos. */
export const systemUserRole = accessControl.newRole({});

/**
 * Super Admin: plataforma completa (sin delete fisico de agencias ni
 * impersonate, que nadie tiene) y negocio en solo lectura. La auditoria que
 * lee cubre plataforma y todas las agencias (delta de audit de f0).
 */
export const superAdminRole = accessControl.newRole({
  organization: ["create", "read", "update"],
  user: ["create", "list", "get", "update", "set-role", "ban", "set-password"],
  session: ["list", "revoke"],
  product: ["read"],
  booking: ["read"],
  payment: ["read"],
  "exchange-rate": ["read"],
  report: ["read"],
  audit: ["read"],
});

// ---------------------------------------------------------------------------
// Capa de agencia (member.role). Se mezcla con los defaults de organization.
// ---------------------------------------------------------------------------

/** owner: lo mismo que admin y, ademas, disuelve la agencia. */
export const ownerRole = accessControl.newRole({
  product: ["create", "read", "update", "delete"],
  booking: ["create", "read", "update", "cancel"],
  payment: ["read", "review"],
  "exchange-rate": ["read", "update"],
  report: ["read"],
  audit: ["read"],
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
});

/** admin de agencia: todo lo de owner salvo disolver la agencia. */
export const adminRole = accessControl.newRole({
  product: ["create", "read", "update", "delete"],
  booking: ["create", "read", "update", "cancel"],
  payment: ["read", "review"],
  "exchange-rate": ["read", "update"],
  report: ["read"],
  audit: ["read"],
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
});

/** agent: crea y consulta reservas; consulta pagos. */
export const agentRole = accessControl.newRole({
  booking: ["create", "read"],
  payment: ["read"],
});

/** provider: gestiona productos y consulta reservas (solo de los suyos en F1). */
export const providerRole = accessControl.newRole({
  product: ["create", "read", "update", "delete"],
  booking: ["read"],
});

/**
 * Default de Better Auth neutralizado: trae ac:["read"] y el mapa de
 * organization se mezcla con los defaults, asi que una membresia sin rol
 * conocido no debe conceder nada.
 */
export const memberRole = accessControl.newRole({});
