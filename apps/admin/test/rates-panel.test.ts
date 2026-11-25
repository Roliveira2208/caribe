import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contrato de la pantalla de tasas (T-F2-8/T-F2-9) sobre el código fuente:
 * modal antes/después con confirmación explícita, cancelar sin escritura,
 * matriz de roles, historial desde audit_logs y textos es/en.
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
  "source",
  "valueDate",
  "scope",
  "scopeAgency",
  "scopePlatform",
  "isOverride",
  "yes",
  "no",
  "edit",
  "rateLabel",
  "reasonLabel",
  "valueDateLabel",
  "before",
  "after",
  "beforeValue",
  "afterValue",
  "confirmTitle",
  "confirmDescription",
  "confirmStep",
  "confirmOverride",
  "continue",
  "cancel",
  "cancelHint",
  "historyTitle",
  "historyDescription",
  "colValueDate",
  "colRate",
  "colSource",
  "colScope",
  "colOverride",
  "colReason",
  "colActor",
  "actorUnknown",
  "pending",
  "emptyHistory",
  "forbidden",
  "twoFactorRequired",
  "rateUnavailable",
  "validationError",
  "invalidRate",
  "genericError",
  "savedNotice",
  "loading",
];

describe('exchange-rates › panel de tasas (T-F2-8/T-F2-9)', () => {
  it("la ruta y el componente existen y usan el cliente de tasas", () => {
    expect(existsSync(panelPath)).toBe(true);
    expect(existsSync(pagePath)).toBe(true);
    const panel = read("src/components/rates-panel.tsx");
    for (const symbol of [
      'useTranslations("rates")',
      "getCurrentRate",
      "setRateOverride",
      "listRateAudits",
      "resolveRateAccess",
      "isValidRateText",
      "<Modal",
      "<Table",
    ]) {
      expect(panel).toContain(symbol);
    }
    expect(panel).not.toMatch(/amountUsd|amountVes|amount_ves|exchange_rate_id|type="number"/);
  });

  it("el modal muestra antes → después y exige confirmación explícita", () => {
    const panel = read("src/components/rates-panel.tsx");
    for (const key of [
      "beforeValue",
      "afterValue",
      "reasonLabel",
      "confirmTitle",
      "confirmDescription",
      "confirmOverride",
      "cancel",
      "cancelHint",
    ]) {
      expect(panel).toContain(`t("${key}"`);
    }
    expect(panel).toContain('stage === "confirm"');
    expect(panel).toContain('setRateOverride(');
    expect(panel).toMatch(/onCancel=\{closeModal\}/);
    const closeModal = panel.match(/function closeModal\(\): void \{[\s\S]*?\n {2}\}/)?.[0] ?? "";
    expect(closeModal).not.toContain("setRateOverride");
  });

  it("oculta historial y acciones a quien no puede verlos", () => {
    const panel = read("src/components/rates-panel.tsx");
    expect(panel).toContain("access.canOverride");
    expect(panel).toContain("access.canViewHistory");
    expect(panel).toContain("access.visible");
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
