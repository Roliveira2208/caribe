import type { AuditActor } from "./panel-access";

/**
 * Módulos del panel F2. No hay módulo de reservas: la matriz F1 se cumple
 * ocultando cualquier enlace, pantalla o resumen de reservas (spec `admin-ui`,
 * «Matriz de permisos F1 en la UI»).
 */
export const PANEL_MODULES = [
  "catalog",
  "payments",
  "rates",
  "audit",
  "users",
  "reports",
] as const;

export type PanelModule = (typeof PANEL_MODULES)[number];

const AGENCY_MODULES: Record<string, readonly PanelModule[]> = {
  owner: PANEL_MODULES,
  admin: PANEL_MODULES,
  agent: ["catalog", "payments", "rates"],
  provider: ["catalog", "rates"],
  member: [],
};

/**
 * Matriz de navegación resuelta en servidor. El Super Admin entra en modo
 * plataforma con todos los módulos en solo lectura; sin sesión, sin rol de
 * membresía o con un rol desconocido no se ofrece ninguno.
 */
export function resolvePanelModules(
  status: AuditActor["status"],
  role: string | null,
): readonly PanelModule[] {
  if (status === "platform") return PANEL_MODULES;
  if (status !== "ready" || role === null) return [];
  return AGENCY_MODULES[role] ?? [];
}
