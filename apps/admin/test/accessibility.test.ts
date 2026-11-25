import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Escenarios `admin-ui › "Textos es y en"` y `"Accesibilidad básica"` (T-F2-7).
 * Como el panel todavía no tiene tests de componente, se comprueba el contrato
 * sobre el código fuente: ninguna cadena visible escrita a mano, catálogo es/en
 * completo (incluidos los textos que genera antd) y semántica de teclado.
 */
const appRoot = fileURLToPath(new URL("..", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

function messages(locale: "es" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`));
}

function flatten(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? flatten(value, path)
      : [path];
  });
}

function tsxFiles(dir = join(appRoot, "src")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return /\.tsx$/.test(entry.name) ? [full] : [];
  });
}

describe('admin-ui › "Textos es y en" (T-F2-7)', () => {
  it("no hay cadenas visibles fijas en los componentes", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      const text = readFileSync(file, "utf8");
      const relative = file.slice(appRoot.length + 1).replace(/\\/g, "/");
      for (const match of text.matchAll(/>([^<>{}]*[A-Za-zÀ-ÿ][^<>{}]*)</g)) {
        const value = match[1]?.trim() ?? "";
        // Descarta ruido de tipos genéricos (`Promise<...>`) y expresiones JS.
        if (!value || value.length > 80 || /[;{}=()?]/.test(value)) continue;
        offenders.push(`${relative}: "${value}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("métodos de pago, acciones y 2FA salen del catálogo", () => {
    const payments = read("src/components/payments-panel.tsx");
    expect(payments).not.toContain('"Zelle"');
    expect(payments).not.toContain('"Binance Pay"');
    expect(payments).not.toContain('"—"');
    for (const key of ["methodZelle", "methodBinance", "noActions"]) {
      expect(payments).toContain(`t("${key}")`);
      for (const locale of ["es", "en"] as const) {
        expect(flatten(messages(locale))).toContain(`payments.${key}`);
      }
    }

    const twoFactor = read("src/components/two-factor-form.tsx");
    expect(twoFactor).not.toContain('{t("accountLabel")}:');
    expect(twoFactor).not.toContain('{t("issuerLabel")}:');
    expect(twoFactor).toContain('t("accountLabelValue", { value: parsed.account })');
    expect(twoFactor).toContain('t("issuerLabelValue", { value: parsed.issuer })');
  });

  it("los textos generados por antd salen del catálogo", () => {
    const providers = read("src/components/providers.tsx");
    expect(providers).toContain('useTranslations("antd")');
    for (const key of [
      "global.placeholder",
      "table.emptyText",
      "modal.okText",
      "popconfirm.cancelText",
      "pagination.prevPage",
      "emptyDescription",
      "form.required",
      "form.patternMismatch",
    ]) {
      expect(providers).toContain(`t("${key}"`);
      for (const locale of ["es", "en"] as const) {
        expect(flatten(messages(locale))).toContain(`antd.${key}`);
      }
    }
    expect(providers).toContain("defaultValidateMessages");
  });

  it("todas las claves tOrg existen en es y en", () => {
    const known = new Set(flatten(messages("es")));
    const problems: string[] = [];
    for (const file of tsxFiles()) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\btOrg\(\s*"([^"]+)"\s*[,)]/g)) {
        const key = `organization.${match[1]}`;
        if (!known.has(key)) problems.push(`${file}: falta "${key}"`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('admin-ui › "Accesibilidad básica" (T-F2-7)', () => {
  it("foco visible con contraste y enlace de salto al contenido", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain(":focus-visible");
    expect(css).toMatch(/outline:\s*2px solid var\(--caribe-ink\)/);
    expect(css).toContain(".skip-link");

    const layout = read("src/app/[locale]/layout.tsx");
    expect(layout).toContain('tNav("skipToContent")');
    expect(layout).toContain('id="contenido-principal"');
    for (const locale of ["es", "en"] as const) {
      expect(flatten(messages(locale))).toContain("nav.skipToContent");
    }
  });

  it("controles etiquetados, QR con alternativa y sin botones anidados en enlaces", () => {
    const session = read("src/components/session-nav.tsx");
    expect(session).not.toMatch(/<Link[^>]*>[\s\S]*?<Button/);

    const payments = read("src/components/payments-panel.tsx");
    for (const id of ["payments-status", "payments-method", "rejection-reason"]) {
      expect(payments).toContain(`htmlFor="${id}"`);
      expect(payments).toContain(`id="${id}"`);
    }

    const language = read("src/components/language-switcher.tsx");
    expect(language).toContain('aria-label={t("language")}');

    const twoFactor = read("src/components/two-factor-form.tsx");
    expect(twoFactor).toContain('aria-label={t("qrAlt")}');
    for (const locale of ["es", "en"] as const) {
      expect(flatten(messages(locale))).toContain("twoFactor.qrAlt");
    }
  });

  it("tablas con encabezados traducidos y avisos con tipo de error", () => {
    for (const file of [
      "src/components/audit-log-panel.tsx",
      "src/components/payments-panel.tsx",
    ]) {
      expect(read(file)).not.toMatch(/title:\s*"/);
    }
    const payments = read("src/components/payments-panel.tsx");
    expect(payments).toContain("type={notice.kind}");
    expect(payments).not.toContain('<Alert type="info"');
  });
});
