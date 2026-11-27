import { z } from "zod";

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";

export const localeSchema = z.enum(LOCALES);

export function isLocale(value: string): value is Locale {
  return localeSchema.safeParse(value).success;
}

/**
 * Cambia el prefijo de idioma de una ruta local ya validada, conservando el
 * resto del path. Si no hay prefijo reconocido, devuelve la raíz del idioma.
 */
export function replacePathLocale(path: string, locale: Locale): string {
  const rest = path.replace(/^\/(?:es|en)(?=\/|$)/, "");
  return rest === "" ? `/${locale}` : `/${locale}${rest}`;
}

/** Valor de `user.locale` que puede usarse como idioma; `es` si no es válido. */
export function preferredLocale(value: string | null | undefined): Locale {
  return typeof value === "string" && isLocale(value) ? value : DEFAULT_LOCALE;
}
