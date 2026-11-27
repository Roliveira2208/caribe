import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contrato del visor de auditoría (T-F2-15, spec audit del delta). El panel es
 * un componente de cliente, así que se comprueba sobre el código fuente: tabs,
 * filtros, cursor, matriz de roles resuelta en servidor y textos es/en.
 */
const appRoot = fileURLToPath(new URL("..", import.meta.url));

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
    return typeof value === "object" && value !== null
      ? flatten(value, path)
      : [path];
  });
}

const panel = read("src/components/audit-log-panel.tsx");
const rootPage = read("src/app/[locale]/page.tsx");
const auditPage = read("src/app/[locale]/admin/audit/page.tsx");
const header = read("src/components/site-header.tsx");
const access = read("src/lib/panel-access.ts");

describe('audit › "Exportación CSV de auditoría" (T-F2-25)', () => {
  it("exporta la página filtrada desde un control accesible por teclado", () => {
    expect(panel).toContain("downloadAdminAuditCsv(applied.audit, locale)");
    expect(panel).toContain("saveCsvBlob(");
    expect(panel).toContain('aria-label={t("downloadCsv")}');
    for (const locale of ["es", "en"] as const) {
      const namespace = messages(locale)["audit"] as Record<string, unknown>;
      for (const key of ["downloadCsv", "csvFileName", "csvError"]) {
        expect(namespace[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });
});

describe("visor de auditoría del admin (T-F2-15)", () => {
  it("usa el cliente tipado y dos pestañas de solo lectura", () => {
    expect(panel).toContain('from "@/lib/audit-client"');
    expect(panel).toContain("listAdminAuditLogs");
    expect(panel).toContain("listAuthEvents");
    expect(panel).toContain("<Tabs");
    expect(panel).toContain('key: "audit"');
    expect(panel).toContain('key: "auth"');
    expect(panel).not.toContain("fetchJson(");
  });

  it("los filtros tienen etiqueta e id accesibles", () => {
    for (const id of [
      "audit-action",
      "audit-entity",
      "audit-actor",
      "audit-from",
      "audit-to",
      "auth-route",
      "auth-outcome",
      "auth-from",
      "auth-to",
    ]) {
      expect(panel, `falta la etiqueta de ${id}`).toContain(`htmlFor="${id}"`);
      expect(panel, `falta el control ${id}`).toContain(`id="${id}"`);
    }
  });

  it("el cursor lo emite la API: la UI conserva la pila de páginas", () => {
    expect(panel).toContain("nextCursor");
    expect(panel).toContain("cursorHistory");
    expect(panel).toContain("t(\"previousPage\")");
    expect(panel).toContain("t(\"nextPage\")");
    expect(panel).not.toContain("Buffer.from");
  });

  it("muestra antes/después, IP y ámbito con textos del catálogo", () => {
    for (const key of [
      "colAt",
      "colActor",
      "colActionRoute",
      "colEntity",
      "colChange",
      "colIp",
      "colResult",
      "colScope",
      "ipUnknown",
      "noChange",
      "scopeAgency",
      "scopePlatform",
      "resultOk",
      "empty",
      "loading",
      "forbidden",
      "organizationError",
      "genericError",
    ]) {
      expect(panel, `falta t("${key}")`).toContain(`t("${key}")`);
      for (const locale of ["es", "en"] as const) {
        expect(flatten(messages(locale)), `${locale}: falta audit.${key}`).toContain(
          `audit.${key}`,
        );
      }
    }
    expect(panel).not.toContain('"—"');
  });

  it("la matriz se resuelve en servidor y bloquea resumen y enlaces", () => {
    expect(access).toContain("export async function loadAuditActor");
    for (const file of [rootPage, auditPage]) {
      expect(file).toContain("resolveAuditAccess");
    }
    expect(rootPage).toContain("canRead");
    expect(auditPage).toContain("canRead");
    expect(header).toContain("resolvePanelModules(actor.status, actor.role)");
    expect(header).toContain('href={`/admin/${module}`}');
    expect(rootPage).toContain("loadActiveMemberRole");
    expect(auditPage).toContain("PanelAccessNotice");
    expect(header).toContain("t(module)");
    expect(read("src/lib/panel-navigation.ts")).toContain('"audit"');
  });
});
