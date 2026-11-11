import { describe, expect, it } from "vitest";
import { alternateLinks } from "../src/i18n/metadata";

describe("alternateLinks de la web", () => {
  it("genera canonical, hreflang es/en y x-default para una ruta", () => {
    expect(alternateLinks("es", "/login")).toEqual({
      canonical: "/es/login",
      languages: {
        es: "/es/login",
        en: "/en/login",
        "x-default": "/es/login",
      },
    });
  });

  it("usa la ruta raiz cuando el path es vacio", () => {
    expect(alternateLinks("en", "")).toEqual({
      canonical: "/en",
      languages: {
        es: "/es",
        en: "/en",
        "x-default": "/es",
      },
    });
  });

  it("el idioma activo define la canonical aunque no sea el por defecto", () => {
    expect(alternateLinks("en", "/two-factor")?.canonical).toBe("/en/two-factor");
  });
});
