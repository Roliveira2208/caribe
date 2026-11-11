import { describe, expect, it } from "vitest";
import {
  ADMIN_PORT,
  API_PORT,
  DEFAULT_LOCALE,
  LOCALES,
  WEB_PORT,
  isLocale,
  localeSchema,
} from "../src/index";

describe("locale", () => {
  it("acepta es y en como idiomas válidos", () => {
    for (const locale of LOCALES) {
      expect(localeSchema.parse(locale)).toBe(locale);
      expect(isLocale(locale)).toBe(true);
    }
  });

  it("rechaza idiomas fuera del catálogo", () => {
    expect(isLocale("fr")).toBe(false);
    expect(localeSchema.safeParse("fr").success).toBe(false);
  });

  it("usa es como idioma por defecto", () => {
    expect(DEFAULT_LOCALE).toBe("es");
  });
});

describe("ports", () => {
  it("asigna un puerto distinto a cada app", () => {
    expect(new Set([WEB_PORT, ADMIN_PORT, API_PORT]).size).toBe(3);
  });
});
