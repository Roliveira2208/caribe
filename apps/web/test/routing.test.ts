import { describe, expect, it } from "vitest";
import { routing } from "../src/i18n/routing";

const fixedRoutes = [
  "/",
  "/search",
  "/hotels/[id]",
  "/checkout/[productId]",
  "/login",
  "/two-factor",
  "/account",
  "/account/trips",
  "/reservas/[code]",
] as const;

describe("routing de la web", () => {
  it("expone es y en como idiomas", () => {
    expect(routing.locales).toEqual(["es", "en"]);
  });

  it("usa es como idioma por defecto", () => {
    expect(routing.defaultLocale).toBe("es");
  });

  it("siempre prefija el idioma en la URL (/es, /en)", () => {
    expect(routing.localePrefix).toBe("always");
  });

  it("declara las rutas fijas en ingles para es y en", () => {
    expect(Object.keys(routing.pathnames ?? {}).sort()).toEqual([...fixedRoutes].sort());
    for (const route of fixedRoutes) {
      const localized = routing.pathnames?.[route];
      expect(localized).toBeDefined();
      expect(Object.values(localized ?? {}).every((path) => path === route)).toBe(true);
    }
  });

  it.each(["es", "en"] as const)("no renombra la ruta en %s", (locale) => {
    const localized = routing.pathnames;
    expect(localized?.["/search"]?.[locale]).toBe("/search");
    expect(localized?.["/hotels/[id]"]?.[locale]).toBe("/hotels/[id]");
    expect(localized?.["/account/trips"]?.[locale]).toBe("/account/trips");
  });
});
