import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeaderFrame } from "../src/components/header-frame";
import { SearchReveal } from "../src/components/search-reveal";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string): string => readFileSync(join(appRoot, path), "utf8");

describe("identidad visual Caribe", () => {
  it("define la paleta aprobada y los tokens dark sin Selector de tema", () => {
    const css = read("src/app/globals.css");
    for (const [token, color] of [
      ["ink", "#0e2a3d"],
      ["amber", "#f4a300"],
      ["teal", "#1fa6a0"],
      ["bone", "#fbf7ef"],
      ["coral", "#d64545"],
    ] as const) {
      expect(css).toContain(`--color-${token}: ${color}`);
      expect(css).toMatch(new RegExp(`--color-${token}:\\s*#[0-9a-f]{6}`, "i"));
    }
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("--color-ink: #071c29");
    expect(css).not.toContain("--color-brand-");
    expect(css).toContain("0 18px 40px -24px");
  });

  it("declara el fondo solido antes del soporte de backdrop-filter", () => {
    const css = read("src/app/globals.css");
    const header = css.split(".site-header")[1] ?? "";
    const solid = header.indexOf("background-color: var(--color-ink)");
    const supports = header.indexOf("@supports ((backdrop-filter: blur(1px))");
    expect(solid).toBeGreaterThan(-1);
    expect(supports).toBeGreaterThan(solid);
    expect(css).toContain("data-scrolled=\"false\"");
    expect(css).toContain("data-scrolled=\"true\"");
  });

  it("respeta movimiento reducido con la animación aprobada", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("clip-path: none !important");
    expect(css).toContain("transform: none !important");
    // La change f1-navigation-refresh aprobó una sola animación de portada.
    expect([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1])).toEqual([
      "caribe-rise",
    ]);
  });

  it("comparte un ritmo suave y desactiva el movimiento de forma segura", () => {
    const css = read("src/app/globals.css");
    for (const token of [
      "--ease-caribe: cubic-bezier(0.2, 0.7, 0.2, 1)",
      "--duration-enter: 700ms",
      "--duration-reveal: 650ms",
      "--duration-cue: 400ms",
      "--duration-chrome: 400ms",
    ]) {
      expect(css).toContain(token);
    }
    expect(css).toContain("animation: caribe-rise var(--duration-enter) var(--ease-caribe) both");
    expect(css).toContain("animation: caribe-rise var(--duration-reveal) var(--ease-caribe) both");
    expect(css).toContain(".featured-card:hover");
    expect(css).toContain("::view-transition {");
    expect(css).toContain("::view-transition-group(*)");
  });

  it("mantiene el texto de acento legible sobre bone en modo oscuro", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{[\s\S]*?\.text-teal-ink,\s*\.text-coral-ink \{\s*color: var\(--color-ink\);/,
    );
  });

  it("auto-aloja las dos fuentes aprobadas", () => {
    const layout = read("src/app/[locale]/layout.tsx");
    expect(layout).toContain("next/font/local");
    expect(layout).toContain("--font-clash-display");
    expect(layout).toContain("--font-general-sans");
    for (const file of [
      "clash-display-500.woff2",
      "clash-display-600.woff2",
      "clash-display-700.woff2",
      "general-sans-400.woff2",
      "general-sans-500.woff2",
      "general-sans-600.woff2",
      "general-sans-700.woff2",
      "LICENSE-ITF-FFL.txt",
    ]) {
      expect(read(`public/fonts/${file}`).length).toBeGreaterThan(0);
    }
    const license = read("public/fonts/LICENSE-ITF-FFL.txt");
    expect(license).toContain("You may self-host the Font Software");
    expect(license).toContain("You may, but are not required to, identify or credit");
  });
});

describe("cabecera y revelacion", () => {
  it("la cabecera empieza flotante y expone el menu movil", () => {
    const html = renderToStaticMarkup(
      createElement(HeaderFrame, {
        brand: createElement("span", null, "Caribe"),
        products: createElement("span", null, "productos"),
        tools: createElement("span", null, "tasa"),
        menuLabel: "Menú",
        productsLabel: "Productos",
      }),
    );
    expect(html).toContain('class="site-header"');
    expect(html).toContain('class="site-bar');
    expect(html).toContain('data-scrolled="false"');
    expect(html).toContain('aria-label="Productos"');
    expect(html).toContain('aria-controls="site-tools"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('id="site-tools"');
    expect(html).toContain('data-open="false"');
  });

  it("el panel empieza pendiente y se revela una sola vez", () => {
    const html = renderToStaticMarkup(
      createElement(SearchReveal, null, createElement("div", null, "buscador")),
    );
    expect(html).toContain('data-reveal="pending"');
    expect(html).toContain('class="search-reveal"');
    expect(html).toContain("buscador");
    const source = read("src/components/search-reveal.tsx");
    expect(source).toContain("observer.disconnect()");
    expect(source).toContain("prefers-reduced-motion: reduce");
  });
});

describe("copy sin decoradores", () => {
  it("no usa punto medio, guion largo ni flecha de relleno en las pantallas F1", () => {
    for (const locale of ["es", "en"] as const) {
      const messages = JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
      for (const key of ["nav", "todayRate", "search", "detail", "checkout", "metadata", "home"]) {
        const section = messages[key];
        const text = JSON.stringify(section);
        expect(text, `${locale}.${key}`).not.toContain("·");
        expect(text, `${locale}.${key}`).not.toContain("—");
        expect(text, `${locale}.${key}`).not.toContain("→");
      }
    }
  });
});
