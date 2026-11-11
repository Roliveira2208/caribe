import type { Metadata } from "next";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@caribe/shared";

/** URL publica de la web para canonical/hreflang absolutos (metadataBase). */
export function siteUrl(): string {
  return process.env.WEB_URL ?? "http://localhost:3000";
}

/**
 * Alternate links para una ruta interna (path sin prefijo de idioma, p. ej.
 * "/login" o "" para la raiz): canonical del idioma activo, hreflang por cada
 * idioma disponible y x-default hacia el idioma por defecto (es).
 */
export function alternateLinks(locale: Locale, path: string): Metadata["alternates"] {
  const languages: Record<string, string> = {};
  for (const available of LOCALES) languages[available] = `/${available}${path}`;
  languages["x-default"] = `/${DEFAULT_LOCALE}${path}`;
  return { canonical: `/${locale}${path}`, languages };
}
