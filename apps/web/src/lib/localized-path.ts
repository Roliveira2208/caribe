import type { Locale } from "@caribe/shared";
import { routing } from "@/i18n/routing";

export type FixedRoute = keyof NonNullable<typeof routing.pathnames>;

/** Comprueba que una ruta del router pertenece al inventario fijo. */
export function isFixedRoute(pathname: string): pathname is FixedRoute {
  return Object.prototype.hasOwnProperty.call(routing.pathnames ?? {}, pathname);
}

/**
 * Construye la URL de una ruta pública fija con el prefijo de idioma.
 * El nombre de la ruta no se traduce: solo cambia `/es` por `/en`.
 * Es una función pura para que las vistas sigan siendo probables sin Next.
 */
export function localizedPath(
  locale: Locale,
  route: FixedRoute,
  params: Record<string, string> = {},
): string {
  const localized = routing.pathnames?.[route];
  const template = typeof localized === "string" ? localized : localized?.[locale] ?? route;
  const path = template.replace(/\[([^\]]+)\]/g, (_match, key: string) =>
    encodeURIComponent(params[key] ?? ""),
  );
  return `/${locale}${path}`;
}
