import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contrato de la pantalla de reportes del wireframe aprobado
 * `docs/wireframes/panel-reportes.svg` (T-F2-23). El panel es de cliente, así
 * que se comprueba sobre el código fuente: filtros, totales del servidor,
 * desglose, CSV con los mismos filtros, matriz de roles y textos es/en.
 */
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const panelPath = join(appRoot, "src/components/reports-panel.tsx");
const pagePath = join(appRoot, "src/app/[locale]/admin/reports/page.tsx");

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
  "activeAgency",
  "filterFrom",
  "filterTo",
  "filterAgency",
  "allAgencies",
  "apply",
  "downloadCsv",
  "csvFileName",
  "totalsTitle",
  "totalUsd",
  "totalVes",
  "paymentCount",
  "breakdownTitle",
  "colMethod",
  "colStatus",
  "colCount",
  "colAmountUsd",
  "colAmountVes",
  "empty",
  "loading",
  "forbidden",
  "twoFactorRequired",
  "validationError",
  "genericError",
  "csvError",
  "rangeNote",
  "scopeNoteAgency",
  "scopeNotePlatform",
];

describe("reports › panel de reportes (T-F2-23)", () => {
  it("la ruta y el componente existen y usan el cliente de reportes", () => {
    expect(existsSync(panelPath)).toBe(true);
    expect(existsSync(pagePath)).toBe(true);
    const panel = read("src/components/reports-panel.tsx");
    for (const symbol of [
      '"use client"',
      'useTranslations("reports")',
      "getSalesReport",
      "downloadSalesReportCsv",
      "listReportAgencies",
      "resolveReportsAccess",
      'type="date"',
      "<Table",
    ]) {
      expect(panel).toContain(symbol);
    }
  });

  it("muestra rango, agencia, totales del servidor y desglose sin calcular nada", () => {
    const panel = read("src/components/reports-panel.tsx");
    for (const id of ["report-from", "report-to", "report-agency"]) {
      expect(panel).toContain(`htmlFor="${id}"`);
      expect(panel).toContain(`id="${id}"`);
    }
    for (const key of [
      "filterFrom",
      "filterTo",
      "filterAgency",
      "apply",
      "totalsTitle",
      "totalUsd",
      "totalVes",
      "paymentCount",
      "breakdownTitle",
      "colMethod",
      "colStatus",
      "colCount",
      "colAmountUsd",
      "colAmountVes",
      "empty",
    ]) {
      expect(panel).toContain(`t("${key}"`);
    }
    expect(panel).toMatch(/totals\.amountUsd/);
    expect(panel).toMatch(/totals\.amountVes/);
    expect(panel).toContain("row.amountUsd");
    expect(panel).toContain("row.amountVes");
    expect(panel).not.toMatch(/toFixed|parseFloat|Number\(|type="number"/);
  });

  it("descarga el CSV con los mismos filtros y el idioma activo", () => {
    const panel = read("src/components/reports-panel.tsx");
    expect(panel).toContain("downloadSalesReportCsv(applied, locale)");
    expect(panel).toContain('t("downloadCsv")');
    expect(panel).toContain('t("csvError")');
    expect(panel).toContain("tPayments(\"methodMobile\")");
    expect(panel).toContain("locale");
  });

  it("oculta el reporte a los roles sin permiso y avisa con tipo de error", () => {
    const panel = read("src/components/reports-panel.tsx");
    expect(panel).toContain("access.visible");
    expect(panel).toContain('t("forbidden")');
    expect(panel).toContain("type={notice.kind}");
    expect(panel).not.toContain('<Alert type="info"');
  });

  it("la página resuelve acceso y rol en servidor antes de renderizar", () => {
    const page = read("src/app/[locale]/admin/reports/page.tsx");
    for (const symbol of [
      "loadPanelAccess",
      "loadActiveMemberRole",
      "PanelAccessNotice",
      "<ReportsPanel",
      "generateMetadata",
      "alternateLinks",
    ]) {
      expect(page).toContain(symbol);
    }
    expect(page).toContain("/admin/reports");

    const header = read("src/components/site-header.tsx");
    expect(header).toContain('href="/admin/reports"');
    expect(header).toContain('t("reports")');
  });

  it("todos los textos del panel existen en es y en", () => {
    for (const locale of ["es", "en"] as const) {
      const keys = flatten(messages(locale));
      for (const key of panelKeys) {
        expect(keys).toContain(`reports.${key}`);
      }
      expect(keys).toContain("nav.reports");
    }
    expect(flatten(messages("es")).sort()).toEqual(flatten(messages("en")).sort());
  });
});
