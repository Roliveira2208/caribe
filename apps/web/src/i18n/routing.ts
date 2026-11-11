import { defineRouting } from "next-intl/routing";
import { DEFAULT_LOCALE, LOCALES } from "@caribe/shared";

// Rutas por idioma /es /en (SDD seccion 9): el catalogo vive en shared para
// que web, admin y API compartan la misma definicion.
export const routing = defineRouting({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});
