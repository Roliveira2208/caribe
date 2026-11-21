import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string): string => readFileSync(join(appRoot, path), "utf8");

describe("sección de búsqueda a pantalla completa", () => {
  it("usa el giro local como fondo y una superficie glass", () => {
    const css = read("src/app/globals.css");
    const stage = css.slice(css.indexOf(".search-stage"), css.indexOf(".search-glass"));
    expect(stage).toContain("min-height: 100dvh");
    expect(stage).toContain('url("/images/kinetic-giro.svg")');
    expect(stage).toContain("background-size: cover");
    const glass = css.slice(css.indexOf(".search-glass"));
    expect(glass).toContain("backdrop-filter: blur(16px)");
    expect(glass).toContain("var(--color-bone) 88%");
  });

  it("sirve el giro desde la propia web sin datos externos", () => {
    const svg = read("public/images/kinetic-giro.svg");
    expect(svg).toContain("<svg");
    expect(svg).toContain('viewBox="0 0 1440 900"');
    for (const color of ["#fbf7ef", "#0e2a3d", "#f4a300", "#1fa6a0"]) {
      expect(svg).toContain(color);
    }
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("xlink:href");
    expect(svg).not.toMatch(/href="(?!https:\/\/www\.w3\.org)/);
  });

  it("monta el mismo formulario en la portada y en /search", () => {
    const home = read("src/components/home-search-panel.tsx");
    const form = read("src/components/search-view.tsx");
    const experience = read("src/components/search-experience.tsx");
    expect(home).toContain('<SearchPanel locale={locale}');
    expect(form).toContain("<SearchPanel");
    expect(experience).toContain("<SearchFormView");
    expect(home).toContain("stagger");
  });
});
