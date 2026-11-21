import { defineRouting } from "next-intl/routing";
import { DEFAULT_LOCALE, LOCALES } from "@caribe/shared";

/**
 * Rutas públicas fijas en inglés (decisión de arquitectura de f1-navigation-refresh).
 * next-intl solo añade el prefijo `es` o `en`: el segmento `search`, `hotels`,
 * `checkout` o `account` no cambia al cambiar de idioma.
 */
const fixedPath = (path: string) => Object.fromEntries(LOCALES.map((locale) => [locale, path]));

export const routing = defineRouting({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
  pathnames: {
    "/": "/",
    "/search": fixedPath("/search"),
    "/hotels/[id]": fixedPath("/hotels/[id]"),
    "/checkout/[productId]": fixedPath("/checkout/[productId]"),
    "/login": fixedPath("/login"),
    "/two-factor": fixedPath("/two-factor"),
    "/account": fixedPath("/account"),
    "/account/trips": fixedPath("/account/trips"),
  },
});
