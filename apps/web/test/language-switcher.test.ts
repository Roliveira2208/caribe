import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Locale } from "@caribe/shared";
import { LanguagePill } from "../src/components/language-pill";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string): string => readFileSync(join(appRoot, path), "utf8");
const labels = { es: "ES", en: "ENG" };
const markup = (locale: Locale): string =>
  renderToStaticMarkup(
    createElement(LanguagePill, { locale, labels, ariaLabel: "Idioma", onSelect: () => {} }),
  );

describe("selector de idioma en píldora", () => {
  it("muestra ES y ENG sin banderas ni desplegable en ambos idiomas", () => {
    for (const locale of ["es", "en"] as const) {
      const html = markup(locale);
      expect(html).toContain(">ES</button>");
      expect(html).toContain(">ENG</button>");
      expect(html).not.toContain("/images/flags/");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<select");
      expect(html).not.toContain('role="combobox"');
      expect(html).not.toContain('role="listbox"');
      expect(html).toContain("rounded-full");
    }
  });

  it("resalta y anuncia solo el idioma activo", () => {
    expect(markup("es")).toMatch(/<button[^>]*aria-current="true"[^>]*>ES<\/button>/);
    expect(markup("es")).not.toMatch(/<button[^>]*aria-current="true"[^>]*>ENG<\/button>/);
    expect(markup("en")).toMatch(/<button[^>]*aria-current="true"[^>]*>ENG<\/button>/);
    expect(markup("en")).not.toMatch(/<button[^>]*aria-current="true"[^>]*>ES<\/button>/);
  });

  it("mantiene la etiqueta del grupo y el contorno de foco", () => {
    const html = markup("es");
    expect(html).toContain('aria-label="Idioma"');
    expect(html).toContain("focus-visible:outline-2");
    expect(html).toContain("focus-visible:outline-amber");
  });

  it("guarda las etiquetas cortas en es y en y retira las largas", () => {
    for (const locale of ["es", "en"] as const) {
      const nav = JSON.parse(read(`messages/${locale}.json`)).nav as Record<string, string>;
      expect(nav.shortEs).toBe("ES");
      expect(nav.shortEn).toBe("ENG");
      expect(nav.spanish).toBeUndefined();
      expect(nav.english).toBeUndefined();
    }
  });

  it("la verificación en navegador comprueba la píldora, no las banderas", () => {
    const script = read("scripts/verify-navigation.mjs");
    expect(script).toContain('"ES"');
    expect(script).toContain('"ENG"');
    expect(script).not.toContain('getByRole("combobox"');
    expect(script).not.toContain("desplegable con dos banderas");
    expect(script).toContain('problems.push("queda una bandera")');
  });
});
