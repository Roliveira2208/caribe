import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Identidad visual del panel (T-F2-6, specs/admin-ui "Tokens Caribe",
 * "Tipografía compartida" y "Cabecera del panel"). Los tests leen el código
 * como texto, igual que los de CSP y mensajes: lo que importa es el contrato de
 * configuración y que no queden copias ni colores antiguos.
 */
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appRoot, "../..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function exists(relativePath: string): boolean {
  return existsSync(join(repoRoot, relativePath));
}

function size(relativePath: string): number {
  return statSync(join(repoRoot, relativePath)).size;
}

const fontFiles = [
  "clash-display-500.woff2",
  "clash-display-600.woff2",
  "clash-display-700.woff2",
  "general-sans-400.woff2",
  "general-sans-500.woff2",
  "general-sans-600.woff2",
  "general-sans-700.woff2",
  "LICENSE-ITF-FFL.txt",
];

describe("identidad visual del panel (T-F2-6)", () => {
  it("Tokens Caribe: ConfigProvider aplica la paleta exacta", () => {
    const providers = read("apps/admin/src/components/providers.tsx");
    expect(providers).toContain("ConfigProvider");
    expect(providers).toContain('colorPrimary: "#0E2A3D"');
    expect(providers).toContain('colorWarning: "#F4A300"');
    expect(providers).toContain('colorSuccess: "#1FA6A0"');
    expect(providers).toContain('colorBgLayout: "#FBF7EF"');
    expect(providers).toMatch(/theme=\{\{[\s\S]*?components:/);
  });

  it("Tokens Caribe: no quedan colores genéricos en el shell", () => {
    const header = read("apps/admin/src/components/site-header.tsx");
    for (const obsolete of ["#e5e7eb", "#1f2937", "#6b7280"]) {
      expect(header).not.toContain(obsolete);
    }
    expect(header).toContain("var(--caribe-ink)");
    expect(header).toContain("var(--caribe-bone)");

    const css = read("apps/admin/src/app/globals.css");
    expect(css).not.toContain("#f5f5f5");
    expect(css).toMatch(/--caribe-ink:\s*#0E2A3D/);
    expect(css).toMatch(/--caribe-amber:\s*#F4A300/);
    expect(css).toMatch(/--caribe-teal:\s*#1FA6A0/);
    expect(css).toMatch(/--caribe-bone:\s*#FBF7EF/);
  });

  it("Tipografía compartida: las fuentes viven en un único paquete", () => {
    const manifest = JSON.parse(read("packages/fonts/package.json")) as { name?: string };
    expect(manifest.name).toBe("@caribe/fonts");

    for (const file of fontFiles) {
      expect(size(`packages/fonts/fonts/${file}`)).toBeGreaterThan(0);
    }
    expect(exists("apps/web/public/fonts")).toBe(false);
    expect(exists("apps/admin/public/fonts")).toBe(false);
  });

  it("Tipografía compartida: ambas apps cargan las fuentes desde el paquete", () => {
    for (const app of ["admin", "web"]) {
      const layout = read(`apps/${app}/src/app/[locale]/layout.tsx`);
      expect(layout).toContain('from "next/font/local"');
      expect(layout).toContain("--font-clash-display");
      expect(layout).toContain("--font-general-sans");
      expect(layout).toContain("../../../../../packages/fonts/fonts/clash-display-500.woff2");
      expect(layout.match(/localFont\(\{/g)).toHaveLength(2);
      expect(layout).not.toMatch(/fonts\.googleapis|fontshare|use\.typekit/);
    }

    const css = read("apps/admin/src/app/globals.css");
    expect(css).toContain("var(--font-clash-display)");
    expect(css).toContain("var(--font-general-sans)");
    expect(css).not.toMatch(/fonts\.googleapis|fontshare|use\.typekit/);
  });

  it("Cabecera del panel: marca, navegación, idioma y sesión desde mensajes", () => {
    const header = read("apps/admin/src/components/site-header.tsx");
    expect(header).toContain('getTranslations("nav")');
    for (const key of ["appName", "tagline"]) {
      expect(header).toContain(`t("${key}")`);
    }
    expect(header).toContain("t(module)");
    expect(read("apps/admin/src/lib/panel-navigation.ts")).toContain('"payments"');
    expect(header).toContain("<LanguageSwitcher />");
    expect(header).toContain("<SessionNav />");
    expect(header).not.toContain("Caribe Admin");
    expect(header).not.toContain("Panel de agencia");
    expect(header).toContain("var(--font-clash-display)");
  });
});
