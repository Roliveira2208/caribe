import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(join(appRoot, "src/app/globals.css"), "utf8");
const home = readFileSync(join(appRoot, "src/app/[locale]/page.tsx"), "utf8");
const featured = readFileSync(join(appRoot, "src/components/featured-stays.tsx"), "utf8");

describe("animaciones de la portada", () => {
  it("define una entrada escalonada y una revelación ligada al scroll", () => {
    expect(css).toContain("@keyframes caribe-rise");
    expect(css).toContain(".hero-enter");
    expect(css).toContain(".scroll-rise");
    expect(css).toContain("animation-timeline: view()");
    expect(css).toContain("animation-range: entry 0% cover 30%");
    expect(home).toContain("hero-enter");
    expect(home).toContain("scroll-rise");
    expect(featured).toContain("scroll-rise");
  });

  it("no oculta contenido con movimiento reducido", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".scroll-rise")));
    expect(reduced).toContain(".hero-enter,\n  .scroll-rise");
    expect(reduced).toContain("animation: none !important");
    expect(reduced).toContain("opacity: 1 !important");
    expect(reduced).toContain("transform: none !important");
  });
});
