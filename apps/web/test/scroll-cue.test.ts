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
});
