import type { Locale } from "@caribe/shared";
import { isFixedRoute, localizedPath } from "@/lib/localized-path";

/** Parámetros dinámicos del inventario de rutas públicas. */
export type LanguageRouteParams = {
  id?: string;
  productId?: string;
};

/**
 * URL del otro idioma para el selector de la cabecera. El nombre de la ruta no
 * se traduce: solo cambia el prefijo. Los parámetros se conservan codificados
 * para que el detalle y el checkout no vuelvan a la portada al cambiar de idioma.
 */
export function languageSwitchHref(
  locale: Locale,
  pathname: string,
  params: LanguageRouteParams = {},
): string {
  const values: Record<string, string> = {};
  if (params.id) values.id = params.id;
  if (params.productId) values.productId = params.productId;
  if (isFixedRoute(pathname)) return localizedPath(locale, pathname, values);
  return `/${locale}${pathname}`;
}
