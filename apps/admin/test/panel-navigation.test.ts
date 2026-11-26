import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AuthApiError } from "@caribe/shared";
import { deniedStatusOf } from "../src/lib/denied-data";
import { PANEL_MODULES, resolvePanelModules } from "../src/lib/panel-navigation";

/**
 * Contrato de la spec `admin-ui` para T-F2-24: la navegación deriva de la
 * matriz F1 y un 403/404 del servidor no deja datos del recurso denegado.
 */
const appRoot = fileURLToPath(new URL("..", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

function navMessages(locale: "es" | "en"): Record<string, unknown> {
  const body = JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
  return body["nav"] && typeof body["nav"] === "object"
    ? (body["nav"] as Record<string, unknown>)
    : {};
}

describe("admin-ui › matriz de permisos F1 en la UI", () => {
  const all = [...PANEL_MODULES];

  it("el inventario de módulos del panel no incluye reservas", () => {
    expect(PANEL_MODULES).toEqual(["catalog", "payments", "rates", "audit", "users", "reports"]);
    expect(PANEL_MODULES).not.toContain("bookings");
    expect(PANEL_MODULES.join(" ")).not.toMatch(/reserv/i);
  });

  it("owner y admin de agencia ven los seis módulos permitidos", () => {
    for (const role of ["owner", "admin"]) {
      expect(resolvePanelModules("ready", role)).toEqual(all);
    }
  });

  it("el agente ve catálogo, pagos y tasas, sin auditoría, usuarios ni reportes", () => {
    expect(resolvePanelModules("ready", "agent")).toEqual(["catalog", "payments", "rates"]);
  });

  it("el proveedor ve su inventario y las tasas, sin pagos, auditoría ni reportes", () => {
    expect(resolvePanelModules("ready", "provider")).toEqual(["catalog", "rates"]);
  });

  it("un member sin booking:read no ve módulo, enlace ni resumen de reservas", () => {
    expect(resolvePanelModules("ready", "member")).toEqual([]);
  });

  it("el Super Admin en modo plataforma ve los módulos en modo de solo lectura", () => {
    expect(resolvePanelModules("platform", null)).toEqual(all);
    expect(resolvePanelModules("platform", "member")).toEqual(all);
  });

  it("sin sesión, sin rol o con un rol desconocido falla cerrado", () => {
    expect(resolvePanelModules("login", "owner")).toEqual([]);
    expect(resolvePanelModules("ready", null)).toEqual([]);
    expect(resolvePanelModules("ready", "otro")).toEqual([]);
  });

  it("la cabecera solo enlaza los módulos resueltos y no ofrece reservas", () => {
    const header = read("src/components/site-header.tsx");
    expect(header).toContain("resolvePanelModules(actor.status, actor.role)");
    expect(header).toContain("PANEL_MODULES.map(");
    expect(header).toContain('href={`/admin/${module}`}');
    expect(header).not.toContain("/admin/bookings");
    expect(header).not.toContain('t("bookings")');
    for (const locale of ["es", "en"] as const) {
      const messages = navMessages(locale);
      for (const module of PANEL_MODULES) {
        expect(messages[module], `${locale} falta nav.${module}`).toBeTruthy();
      }
    }
  });
});

describe("admin-ui › sin datos negados por la API", () => {
  it("clasifica 403 y 404 y no clasifica otros estados ni errores locales", () => {
    expect(deniedStatusOf(new AuthApiError(403, "denegado", "FORBIDDEN"))).toBe("forbidden");
    expect(deniedStatusOf(new AuthApiError(404, "ausente", "NOT_FOUND"))).toBe("not-found");
    expect(deniedStatusOf(new AuthApiError(401, "sin sesión", "UNAUTHENTICATED"))).toBeNull();
    expect(deniedStatusOf(new AuthApiError(503, "sin tasa", "RATE_UNAVAILABLE"))).toBeNull();
    expect(deniedStatusOf(new Error("boom"))).toBeNull();
  });

  it("cada panel descarta filas, importes y resúmenes antes de mostrar el aviso localizado", () => {
    const panels: Array<[string, string[]]> = [
      [
        "catalog-panel.tsx",
        [
          "deniedStatusOf(",
          "setPages([])",
          "setViewerProviderId(null)",
          't("forbidden")',
          't("notFound")',
          "token === generation.current",
        ],
      ],
      ["payments-panel.tsx", ["deniedStatusOf(", "setPages([])", 't("forbidden")', "token === generation.current"]],
      [
        "rates-panel.tsx",
        ["deniedStatusOf(", "setCurrent(null)", "setHistory([])", 't("forbidden")', 't("rateUnavailable")'],
      ],
      ["reports-panel.tsx", ["deniedStatusOf(", "setReport(null)", 't("forbidden")']],
      [
        "users-panel.tsx",
        [
          "deniedStatusOf(",
          "setOrganizations([])",
          "setMembers([])",
          "setSessions([])",
          't("forbidden")',
          't("notFound")',
        ],
      ],
    ];
    for (const [file, fragments] of panels) {
      const panel = read(`src/components/${file}`);
      for (const fragment of fragments) {
        expect(panel, `${file} falta "${fragment}"`).toContain(fragment);
      }
    }
  });

  it("el inventario del proveedor viene de la API y se descarta con el 403", () => {
    const panel = read("src/components/catalog-panel.tsx");
    expect(panel).toContain("setViewerProviderId(page.viewerProviderId)");
    expect(panel).toContain("providerId: viewerProviderId");
    expect(panel).toContain("resolveCatalogPanelAccess(");
    expect(panel).toContain("access.canRead");
  });
});
