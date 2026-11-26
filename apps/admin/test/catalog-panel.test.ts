import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contrato de la pantalla de catálogo (T-F2-18) sobre el código fuente: usa los
 * endpoints existentes, no calcula importes, esconde las acciones que la API
 * rechazaría y saca todas las etiquetas de los catálogos es/en.
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
    return typeof value === "object" && value !== null ? flatten(value, path) : [path];
  });
}

describe("catalog › pantalla del panel (T-F2-18)", () => {
  it("existe la página y el componente del catálogo", () => {
    expect(existsSync(join(appRoot, "src/app/[locale]/admin/catalog/page.tsx"))).toBe(true);
    expect(existsSync(join(appRoot, "src/components/catalog-panel.tsx"))).toBe(true);
  });

  it("la página resuelve acceso, idioma, metadata alternativa y aviso de acceso", () => {
    const page = read("src/app/[locale]/admin/catalog/page.tsx");
    for (const fragment of [
      'namespace: "catalog"',
      'alternateLinks(locale, "/admin/catalog")',
      "setRequestLocale(locale)",
      "loadPanelAccess(request)",
      "loadActiveMemberRole(request)",
      "resolveCatalogPanelAccess(",
      "<PanelAccessNotice",
      "<CatalogPanel",
    ]) {
      expect(page, `falta "${fragment}" en la página`).toContain(fragment);
    }
  });

  it("el panel usa la matriz antes de ofrecer alta, edición o cambio de estado", () => {
    const panel = read("src/components/catalog-panel.tsx");
    for (const fragment of [
      "access.canRead",
      "access.canCreate",
      "access.canEdit(",
      "access.canChangeStatus(",
      "listCatalogProducts(",
      "createCatalogProduct(",
      "updateCatalogProduct(",
      "publishCatalogProduct(",
      "archiveCatalogProduct(",
      "listCatalogAvailability(",
      "writeCatalogAvailability(",
      "access.canManageAvailability(",
      "nextCursor",
    ]) {
      expect(panel, `falta "${fragment}" en el panel`).toContain(fragment);
    }
    expect(panel).not.toMatch(/<Link[^>]*>[\s\S]*?<Button/);
  });

  it("el precio es texto y el formulario no ofrece campos calculados ni tenantId", () => {
    const panel = read("src/components/catalog-panel.tsx");
    expect(panel).toContain('name="basePriceUsd"');
    expect(panel).not.toContain('type="number"');
    for (const field of ["totalUsd", "totalVes", "exchangeRate", "tenantId", "actorId"]) {
      expect(panel, `el panel no debe enviar "${field}"`).not.toContain(`name="${field}"`);
    }
  });

  it("el proveedor no puede elegir un proveedor ajeno al crear", () => {
    const panel = read("src/components/catalog-panel.tsx");
    expect(panel).toContain('access.role === "provider"');
    expect(panel).toContain('id="catalog-providerId"');
    // La API deriva el proveedor de la sesión; sin este guard la UI ofrecería un 403.
    expect(panel).toContain('disabled={modal?.mode === "edit" || access.role === "provider"}');
  });

  it("el modal de disponibilidad permite dar de alta noches nuevas", () => {
    const panel = read("src/components/catalog-panel.tsx");
    for (const fragment of [
      't("newNight")',
      't("addNight")',
      "newAvailabilityNight(",
      "setAvailabilityNights(",
      "catalog-new-night-night",
      "catalog-new-night-capacity",
      "catalog-new-night-price",
    ]) {
      expect(panel, `falta "${fragment}" en el panel`).toContain(fragment);
    }
    // El cliente construye la fila nueva con reserved=0; el panel no lo calcula.
    expect(panel).not.toContain("reserved: 0");
  });

  it("el rango y la noche nueva tienen etiqueta asociada y son navegables por teclado", () => {
    const panel = read("src/components/catalog-panel.tsx");
    for (const id of [
      "catalog-availability-from",
      "catalog-availability-to",
      "catalog-new-night-night",
      "catalog-new-night-capacity",
      "catalog-new-night-price",
    ]) {
      expect(panel, `falta htmlFor="${id}"`).toContain(`htmlFor="${id}"`);
      expect(panel, `falta id="${id}"`).toContain(`id="${id}"`);
    }
    // Los controles son Button/Input de antd, que exponen foco nativo.
    expect(panel).not.toMatch(/<div[^>]+onClick=/);
  });

  it("todas las etiquetas usadas por la pantalla salen de es y en", () => {
    const keys = [
      "nav.catalog",
      "catalog.title",
      "catalog.description",
      "catalog.activeAgency",
      "catalog.newProduct",
      "catalog.editProduct",
      "catalog.filterQ",
      "catalog.filterStatus",
      "catalog.all",
      "catalog.colProduct",
      "catalog.colRoomType",
      "catalog.colProvider",
      "catalog.colStatus",
      "catalog.colPrice",
      "catalog.colActions",
      "catalog.statusDraft",
      "catalog.statusPublished",
      "catalog.statusArchived",
      "catalog.publish",
      "catalog.archive",
      "catalog.save",
      "catalog.cancel",
      "catalog.roomType",
      "catalog.destinationId",
      "catalog.providerId",
      "catalog.basePriceUsd",
      "catalog.titleEs",
      "catalog.titleEn",
      "catalog.descriptionEs",
      "catalog.descriptionEn",
      "catalog.required",
      "catalog.manageAvailability",
      "catalog.availabilityTitle",
      "catalog.from",
      "catalog.to",
      "catalog.apply",
      "catalog.newNight",
      "catalog.addNight",
      "catalog.colNight",
      "catalog.colCapacity",
      "catalog.colReserved",
      "catalog.colNightPrice",
      "catalog.saveAvailability",
      "catalog.duplicatedNight",
      "catalog.availabilitySaved",
      "catalog.noNights",
      "catalog.previousPage",
      "catalog.nextPage",
      "catalog.empty",
      "catalog.readOnly",
      "catalog.forbidden",
      "catalog.notFound",
      "catalog.validationError",
      "catalog.genericError",
      "catalog.savedNotice",
      "catalog.loading",
      "catalog.noActions",
    ];
    for (const locale of ["es", "en"] as const) {
      const flat = flatten(messages(locale));
      for (const key of keys) {
        expect(flat, `${locale} falta "${key}"`).toContain(key);
      }
    }

    const panel = read("src/components/catalog-panel.tsx");
    for (const key of keys.filter((entry) => entry.startsWith("catalog."))) {
      expect(panel, `el panel no usa "${key}"`).toContain(`t("${key.slice("catalog.".length)}"`);
    }
    expect(read("src/lib/panel-navigation.ts")).toContain('"catalog"');
    expect(read("src/components/site-header.tsx")).toContain("PANEL_MODULES.map(navLink)");
  });
});
