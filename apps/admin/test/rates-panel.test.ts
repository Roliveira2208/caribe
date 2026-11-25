import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contrato de la pantalla de tasas de T-F2-8 sobre el código fuente: tasa
 * vigente, override con motivo, matriz de roles, validación en el cliente y
 * textos es/en. El modal antes/después y el historial llegan en T-F2-9.
 */
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const panelPath = join(appRoot, "src/components/rates-panel.tsx");
const pagePath = join(appRoot, "src/app/[locale]/admin/rates/page.tsx");

function read(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

function messages(locale: "es" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
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

const panelKeys = [
  "title",
  "description",
  "currentTitle",
  "activeAgency",
  "sourceValue",
  "valueDateValue",
  "scopeValue",
  "scopePlatform",
  "scopeAgency",
  "overrideValue",
  "yes",
  "no",
  "edit",
  "rateLabel",
  "reasonLabel",
  "valueDateLabel",
  "valueDatePlaceholder",
  "confirmTitle",
  "confirmOverride",
  "cancel",
  "forbidden",
  "twoFactorRequired",
  "rateUnavailable",
  "validationError",
  "invalidRate",
  "genericError",
  "savedNotice",
  "loading",
];

describe('exchange-rates › panel de tasas (T-F2-8)', () => {
  it("la ruta y el componente existen y usan el cliente de tasas", () => {
    expect(existsSync(panelPath)).toBe(true);
    expect(existsSync(pagePath)).toBe(true);
    const panel = read("src/components/rates-panel.tsx");
    for (const symbol of [
      'useTranslations("rates")',
      "getCurrentRate",
      "setRateOverride",
      "resolveRateAccess",
      "isValidRateText",
      "<Modal",
    ]) {
      expect(panel).toContain(symbol);
    }
    expect(panel).not.toMatch(/amountUsd|amountVes|amount_ves|exchange_rate_id|type="number"/);
  });

  it("el formulario envía texto decimal y motivo, sin campos calculados", () => {
    const panel = read("src/components/rates-panel.tsx");
    expect(panel).toContain('t("rateLabel")');
    expect(panel).toContain('t("reasonLabel")');
    expect(panel).toContain("setRateOverride(");
    expect(panel).toContain("isValidRateText(rateInput)");
    expect(panel).toContain("reason.trim() === \"\"");
    expect(panel).toContain("onCancel={closeModal}");
    const closeModal = panel.match(/function closeModal\(\): void \{[\s\S]*?\n {2}\}/)?.[0] ?? "";
    expect(closeModal).not.toContain("setRateOverride");
  });

  it("oculta la tasa y la acción a quien no tiene permiso", () => {
    const panel = read("src/components/rates-panel.tsx");
    expect(panel).toContain("access.visible");
    expect(panel).toContain("access.canOverride");
    expect(panel).toContain('t("forbidden")');
    expect(panel).toContain('t("twoFactorRequired")');
  });

  it("la página resuelve acceso y rol en servidor antes de renderizar", () => {
    const page = read("src/app/[locale]/admin/rates/page.tsx");
    for (const symbol of [
      "loadPanelAccess",
      "loadRateRole",
      "PanelAccessNotice",
      "<RatesPanel",
      "generateMetadata",
      "alternateLinks",
    ]) {
      expect(page).toContain(symbol);
    }
    expect(page).toContain("/admin/rates");

    const header = read("src/components/site-header.tsx");
    expect(header).toContain('href="/admin/rates"');
    expect(header).toContain('t("rates")');
  });

  it("todos los textos del panel existen en es y en", () => {
    for (const locale of ["es", "en"] as const) {
      const keys = flatten(messages(locale));
      for (const key of panelKeys) {
        expect(keys).toContain(`rates.${key}`);
      }
      expect(keys).toContain("nav.rates");
    }
    expect(flatten(messages("es")).sort()).toEqual(flatten(messages("en")).sort());
  });
});
