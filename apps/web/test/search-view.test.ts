import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "@caribe/shared";
import { describe, expect, it } from "vitest";
import { buildCatalogQuery } from "../src/lib/catalog-view";
import {
  catalogInputFromParams,
  extractDestinations,
  parseCatalogPageView,
  type CatalogDestinationView,
  type CatalogPageView,
} from "../src/lib/search-view";
import {
  SearchFormView,
  SearchResultsView,
  type SearchViewLabels,
} from "../src/components/search-view";

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, " ");

const labels: SearchViewLabels = {
  title: "Buscar viajes",
  subtitle: "Encuentra tu próximo viaje por Venezuela.",
  anyDestination: "Todos los destinos",
  destination: "Destino",
  checkIn: "Entrada",
  checkOut: "Salida",
  guests: "Personas",
  type: "Tipo",
  typeTour: "Tour",
  typeHotel: "Hotel",
  typePackage: "Paquete",
  typeFlight: "Vuelo",
  comingSoon: "próximamente",
  minPrice: "Precio mínimo (USD)",
  maxPrice: "Precio máximo (USD)",
  priceError: "Revisa el rango de precio.",
  search: "Buscar",
  results: "resultados",
  loading: "Cargando resultados…",
  error: "No se pudieron cargar los resultados.",
  emptyTitle: "Sin resultados",
  emptyDescription: "Prueba con otros destinos, fechas o precios.",
  viewDetail: "Ver detalle",
  rateLabel: "tasa BCV",
};

const destinations: CatalogDestinationView[] = [
  { id: "dest-roques", name: { es: "Los Roques", en: "Los Roques" }, country: "VE", code: "LRQ" },
  { id: "dest-merida", name: { es: "Mérida", en: "Merida" }, country: "VE", code: "MRD" },
];

function offer(overrides: Partial<CatalogPageView["items"][number]> = {}) {
  return {
    id: "offer-1",
    hotelKey: "hotel-1",
    roomType: "Habitación doble",
    type: "hotel" as const,
    title: { es: "Posada Malvin", en: "Malvin Inn" },
    description: { es: "Frente al mar", en: "Seafront" },
    destination: destinations[0]!,
    attributes: { stars: 3, maxGuests: 2, amenities: [], images: [] },
    basePriceUsd: "120.00",
    basePriceVes: "4320.00",
    totalUsd: null,
    totalVes: null,
    ...overrides,
  };
}

const page: CatalogPageView = {
  items: [
    offer(),
    offer({
      id: "offer-2",
      title: { es: "Costa Azul", en: "Costa Azul" },
      basePriceUsd: "60.00",
      basePriceVes: "2160.00",
    }),
  ],
  nextCursor: null,
};

function renderForm(locale: Locale = "es", priceError = false): string {
  return renderToStaticMarkup(
    createElement(SearchFormView, {
      locale,
      destinations,
      input: { destinationId: "dest-roques", checkIn: "2026-11-20", guests: "2", minPriceUsd: "90" },
      labels,
      priceError,
    }),
  );
}

function renderResults(
  value: CatalogPageView | null,
  status: "loading" | "error" | "ready" = "ready",
  locale: Locale = "es",
  rateDate: string | null = "2026-11-10",
): string {
  return renderToStaticMarkup(
    createElement(SearchResultsView, { page: value, status, locale, labels, rateDate }),
  );
}

describe("catalogInputFromParams", () => {
  it("traduce los parámetros de la URL a la query de la API y fuerza el tipo hotel", () => {
    const params = new URLSearchParams(
      "q=café&destinationId=dest-roques&checkIn=2026-11-20&checkOut=2026-11-23&guests=2&type=tour&minPriceUsd=90&maxPriceUsd=120.50&cursor=opaco",
    );
    const parsed = catalogInputFromParams(params);

    expect(parsed.invalidPrice).toBe(false);
    expect(parsed.input).toMatchObject({
      q: "café",
      destinationId: "dest-roques",
      checkIn: "2026-11-20",
      checkOut: "2026-11-23",
      guests: "2",
      type: "hotel",
      minPriceUsd: "90",
      maxPriceUsd: "120.50",
      cursor: "opaco",
    });
    expect(buildCatalogQuery(parsed.input)).toContain("minPriceUsd=90&maxPriceUsd=120.50");
  });

  it("no envía límites inválidos ni un rango invertido", () => {
    for (const params of [
      new URLSearchParams("minPriceUsd=0&maxPriceUsd=120"),
      new URLSearchParams("minPriceUsd=-5&maxPriceUsd=120"),
      new URLSearchParams("minPriceUsd=90.123&maxPriceUsd=120"),
      new URLSearchParams("minPriceUsd=120&maxPriceUsd=90"),
    ]) {
      const parsed = catalogInputFromParams(params);
      expect(parsed.invalidPrice).toBe(true);
      expect(parsed.input.minPriceUsd).toBeUndefined();
      expect(parsed.input.maxPriceUsd).toBeUndefined();
    }
  });

  it("acepta un solo extremo y omite claves desconocidas", () => {
    const parsed = catalogInputFromParams(
      new URLSearchParams("maxPriceUsd=100&type=flight&fake=1&guests=0"),
    );
    expect(parsed.invalidPrice).toBe(false);
    expect(parsed.input).toEqual({ type: "hotel", maxPriceUsd: "100" });
  });
});

describe("parseCatalogPageView", () => {
  it("acepta la respuesta pública con importes en texto", () => {
    expect(parseCatalogPageView(page)).toEqual(page);
  });

  it("rechaza importes numéricos y respuestas sin la forma esperada", () => {
    for (const value of [
      null,
      [],
      { items: "no", nextCursor: null },
      { items: [{ ...offer(), basePriceUsd: 120 }], nextCursor: null },
      { items: [{ ...offer(), id: 7 }], nextCursor: null },
    ]) {
      expect(parseCatalogPageView(value)).toBeNull();
    }
  });
});

describe("extractDestinations", () => {
  it("dedupe por id y mantiene el texto localizado", () => {
    const extracted = extractDestinations([
      offer({ id: "a", destination: destinations[0]! }),
      offer({ id: "b", destination: destinations[0]! }),
      offer({ id: "c", destination: destinations[1]! }),
    ]);
    expect(extracted).toEqual(destinations);
  });
});

describe("SearchFormView", () => {
  it("asocia etiquetas, envía la búsqueda por GET al locale y respeta los valores iniciales", () => {
    const html = renderForm();
    expect(html).toContain('action="/es/buscar"');
    expect(html).toContain('method="get"');
    expect(html).toContain('for="search-destination"');
    expect(html).toMatch(/<option(?=[^>]*value="dest-roques")[^>]*selected/);
    expect(html).toContain('name="checkIn"');
    expect(html).toContain('value="2026-11-20"');
    expect(html).toContain('name="guests"');
    expect(html).toContain('name="minPriceUsd"');
    expect(html).toContain('value="90"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('focus-visible');
  });

  it("muestra los cuatro tipos y deshabilita solo los que llegan en F2", () => {
    const html = renderForm("en");
    const optionFor = (type: string): string =>
      html.match(new RegExp(`<option(?=[^>]*value="${type}")[^>]*>[^<]*</option>`))?.[0] ?? "";
    for (const type of ["tour", "hotel", "package", "flight"]) {
      expect(optionFor(type)).not.toBe("");
    }
    expect(optionFor("hotel")).not.toContain("disabled");
    for (const type of ["tour", "package", "flight"]) {
      expect(optionFor(type)).toContain("disabled");
      expect(optionFor(type)).toContain(labels.comingSoon);
    }
  });

  it("anuncia el rango de precio inválido", () => {
    expect(renderForm("es", true)).toContain('role="alert"');
    expect(renderForm("es", true)).toContain(labels.priceError);
    expect(renderForm("es", false)).not.toContain('role="alert"');
  });
});

describe("SearchResultsView", () => {
  it("muestra el total con fechas, el equivalente VES y la fecha de la tasa", () => {
    const html = renderResults({
      items: [offer({ basePriceUsd: "300.00", basePriceVes: "10800.00", totalUsd: "300.00", totalVes: "10800.00" })],
      nextCursor: null,
    });
    expect(normalize(html)).toContain("USD 300,00");
    expect(normalize(html)).toContain("Bs.S 10.800,00");
    expect(html).toContain("10/11/2026");
    expect(html).toContain(labels.rateLabel);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(`href="/es/hoteles/offer-1"`);
  });

  it("sin fechas usa el precio base y sin VES no inventa un equivalente", () => {
    const withoutRate: CatalogPageView = {
      ...page,
      items: page.items.map((item) => ({ ...item, basePriceVes: null, totalVes: null })),
    };
    const html = renderResults(withoutRate, "ready", "en", null);
    expect(html).toContain("$120.00");
    expect(html).toContain("$60.00");
    expect(html).not.toContain("VES");
  });

  it("el estado vacío es anunciable y no renderiza tarjetas", () => {
    const html = renderResults({ items: [], nextCursor: null });
    expect(html).toContain(labels.emptyTitle);
    expect(html).toContain(labels.emptyDescription);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Ver detalle");
  });

  it("carga y error tienen estado accesible", () => {
    expect(renderResults(null, "loading")).toContain(labels.loading);
    expect(renderResults(null, "error")).toContain('role="alert"');
    expect(renderResults(null, "error")).toContain(labels.error);
  });
});
