import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScrollCue } from "../src/components/scroll-cue";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string): string => readFileSync(join(appRoot, path), "utf8");

describe("gesto de bajada", () => {
  it("es un enlace anclado, anunciado y visible al renderizar", () => {
    const html = renderToStaticMarkup(
      createElement(ScrollCue, { targetId: "search", label: "Ir al buscador" }),
    );
    expect(html).toContain('href="#search"');
    expect(html).toContain('aria-label="Ir al buscador"');
    expect(html).toContain('data-visible="true"');
    expect(html).toContain("scroll-cue");
    expect(html).toContain("aria-hidden=\"true\"");
  });

  it("se fija al viewport y se retira con movimiento reducido", () => {
    const css = read("src/app/globals.css");
    const cue = css.slice(css.indexOf(".scroll-cue"), css.indexOf(".search-glass"));
    expect(cue).toContain("position: fixed");
    expect(cue).toContain('data-visible="true"');
    expect(cue).toContain("visibility: hidden");
    expect(cue).toContain("transition: none");
  });

  it("baja rápido y vuelve despacio, sin escalas ni ondas de impacto", () => {
    const css = read("src/app/globals.css");
    const cue = css.slice(css.indexOf(".scroll-cue"), css.indexOf(".search-glass"));
    expect(cue).toContain("--cue-press-y: 0px");
    expect(cue).toContain('data-pressed="true"');
    expect(cue).toContain("--cue-press-y: 8px");
    expect(cue).toContain("translate(-50%, calc(var(--cue-y) + var(--cue-press-y)))");
    expect(cue).toContain("transform var(--duration-return) var(--ease-out)");
    expect(cue).toContain("transform var(--duration-press) var(--ease-out)");
    expect(cue).not.toContain("@keyframes cue-press");
    expect(cue).not.toContain("scale(");
  });

  it("interpola el desplazamiento y lo cancela ante una acción del usuario", () => {
    const source = read("src/components/scroll-cue.tsx");
    expect(source).toContain("const SCROLL_DURATION_MS = 760");
    expect(source).toContain("function easeInOutCubic");
    expect(source).toContain('behavior: "instant"');
    expect(source).toContain('["wheel", "touchstart", "keydown"]');
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).toContain("scrollMarginTop");
    expect(source).toContain("history.pushState");
  });
});
