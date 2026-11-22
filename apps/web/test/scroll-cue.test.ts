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

  it("alinea la sección destino con el viewport al seguir un ancla", () => {
    const css = read("src/app/globals.css");
    const target = css.slice(css.indexOf(".scroll-target"), css.indexOf(".scroll-cue"));
    expect(target).toContain("scroll-margin-top: 0");
    expect(target).not.toContain("scroll-margin-top: 7rem");

    const page = read("src/app/[locale]/page.tsx");
    const featured = read("src/components/featured-stays.tsx");
    expect(page).toContain('id="search" className="search-stage scroll-target relative py-16');
    expect(page).toContain("scroll-target relative flex min-h-dvh flex-col");
    expect(featured).toContain("scroll-target relative flex min-h-dvh flex-col");
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

  it("retira la bajada cuando su destino llega arriba, sin solapar la subida", () => {
    const source = read("src/components/scroll-cue.tsx");
    expect(source).toContain('if (direction !== "down") return false;');
    expect(source).toContain("const reachedTarget = () => {");
    expect(source).toContain("intersecting.current && !reachedTarget()");
    expect(source).toContain('window.addEventListener("scroll", update, { passive: true })');
    expect(source).toContain("window.removeEventListener(\"scroll\", update)");
    expect(source).toContain("}, [direction, targetId]);");
  });

  it("la flecha de subida apunta al inicio y se etiqueta en el idioma activo", () => {
    const html = renderToStaticMarkup(
      createElement(ScrollCue, {
        targetId: "inicio",
        label: "Volver al inicio",
        direction: "up",
        tone: "on-light",
      }),
    );
    expect(html).toContain('href="#inicio"');
    expect(html).toContain('aria-label="Volver al inicio"');
    expect(html).toContain('data-direction="up"');
    expect(html).toContain('d="m6 15 6-6 6 6"');
    expect(html).not.toContain('d="m6 9 6 6 6-6"');
  });

  it("el cierre ofrece la subida y el hero el ancla de inicio", () => {
    const page = read("src/app/[locale]/page.tsx");
    expect(page).toContain('id="inicio" className="hero-section');
    expect(page).toContain('<ScrollCue targetId="inicio" direction="up"');
    expect(page).toContain('id="cierre"');

    const es = JSON.parse(read("messages/es.json")) as { home: Record<string, string> };
    const en = JSON.parse(read("messages/en.json")) as { home: Record<string, string> };
    expect(es.home.scrollToTop).toBe("Volver al inicio");
    expect(en.home.scrollToTop).toBe("Back to top");
  });

  it("el balanceo de subida se desactiva con movimiento reducido", () => {
    const css = read("src/app/globals.css");
    const cue = css.slice(css.indexOf(".scroll-cue"), css.indexOf(".search-glass"));
    expect(cue).toContain('[data-direction="up"] .scroll-cue-icon');
    expect(cue).toContain("animation-name: cue-nudge-up");
    expect(cue).toContain("@keyframes cue-nudge-up");
    expect(cue).toContain("translateY(-3px)");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain('[data-direction="up"] .scroll-cue-icon');
  });
});
