import { describe, expect, it } from "vitest";
import { routing } from "../src/i18n/routing.js";

describe("routing del admin", () => {
  it("expone es y en como idiomas", () => {
    expect(routing.locales).toEqual(["es", "en"]);
  });

  it("usa es como idioma por defecto", () => {
    expect(routing.defaultLocale).toBe("es");
  });

  it("siempre prefija el idioma en la URL (/es, /en)", () => {
    expect(routing.localePrefix).toBe("always");
  });
});
