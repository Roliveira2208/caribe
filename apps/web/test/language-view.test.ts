import { describe, expect, it } from "vitest";
import { languageSwitchHref } from "../src/lib/language-view";

describe("languageSwitchHref", () => {
  it("cambia solo el prefijo en las rutas fijas", () => {
    expect(languageSwitchHref("en", "/search")).toBe("/en/search");
    expect(languageSwitchHref("es", "/account/trips")).toBe("/es/account/trips");
    expect(languageSwitchHref("en", "/")).toBe("/en/");
  });

  it("conserva los parametros del detalle y del checkout", () => {
    expect(languageSwitchHref("en", "/hotels/[id]", { id: "hotel-42" })).toBe(
      "/en/hotels/hotel-42",
    );
    expect(languageSwitchHref("es", "/checkout/[productId]", { productId: "p 1" })).toBe(
      "/es/checkout/p%201",
    );
  });

  it("prefija rutas fuera del inventario sin perder el nombre", () => {
    expect(languageSwitchHref("en", "/futura")).toBe("/en/futura");
  });
});
