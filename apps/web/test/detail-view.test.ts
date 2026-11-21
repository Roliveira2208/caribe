import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "@caribe/shared";
import { describe, expect, it, vi } from "vitest";
import { ProductDetailView, type DetailViewLabels } from "../src/components/product-detail-view";
import {
  availabilityApiUrl,
  firstBookableNight,
  nextDay,
  parseAvailabilityView,
  parseProductDetailView,
  staySelectionFromParams,
  type CatalogAvailabilityView,
  type CatalogProductDetailView,
} from "../src/lib/detail-view";

// La configuración de remotePatterns de next/image vive en next.config.ts y no
// se carga en este test de render puro.
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }),
}));

const normalize = (value: string): string =>
  value.replace(/[\u00a0\u202f]/g, " ").replace(/&amp;/g, "&");

const labels: DetailViewLabels = {
  loading: "Cargando el detalle…",
  error: "No pudimos cargar el detalle.",
  notFound: "Este alojamiento ya no está disponible.",
  backToSearch: "Volver a la búsqueda",
  noPhotos: "Sin fotos disponibles",
  basePrice: "Precio base por noche",
  vesLabel: "Equivalente BCV",
  amenitiesTitle: "Servicios del alojamiento",
  availabilityTitle: "Disponibilidad por noche",
  availabilityEmpty: "No hay noches disponibles en este rango.",
  remaining: "habitaciones libres",
  cancellationTitle: "Política de cancelación",
  ruleTemplate: (hours, percent) => `${hours} horas antes, ${percent} % de devolución`,
  cancellationNone: "Este alojamiento no publica una política de cancelación.",
  reserve: "Reservar",
  unavailable: "Sin cupo para reservar",
};

const product: CatalogProductDetailView = {
  id: "11111111-1111-4111-8111-111111111111",
  hotelKey: "22222222-2222-4222-8222-222222222222",
  roomType: "standard",
  type: "hotel",
  title: { es: "Posada del Puerto", en: "Harbor Inn" },
  description: { es: "Habitación con vista al malecón.", en: "Room with a seafront view." },
  destination: {
    id: "dest-1",
    name: { es: "Mérida", en: "Mérida" },
    country: "VE",
    code: "MRD",
  },
  attributes: { stars: 3, maxGuests: 2, amenities: ["wifi"], images: [] },
  basePriceUsd: "80.00",
  basePriceVes: null,
  cancellationPolicy: null,
};

const availability: CatalogAvailabilityView = {
  productId: product.id,
  from: "2026-12-01",
  to: "2026-12-04",
  nights: [
    { night: "2026-12-01", remaining: 2, priceUsd: "80.00", priceVes: null },
    { night: "2026-12-02", remaining: 0, priceUsd: "90.00", priceVes: null },
    { night: "2026-12-03", remaining: 1, priceUsd: "100.00", priceVes: null },
  ],
};

function render(
  overrides: Partial<Parameters<typeof ProductDetailView>[0]> = {},
): string {
  return normalize(
    renderToStaticMarkup(
      createElement(ProductDetailView, {
        locale: "es" as Locale,
        productId: product.id,
        product,
        availability,
        selection: { guests: 1 },
        status: "ready",
        labels,
        ...overrides,
      }),
    ),
  );
}

describe("lectura del detalle público", () => {
  it("acepta un detalle válido con política y rechaza importes numéricos", () => {
    const withPolicy = {
      ...product,
      basePriceVes: "3600.00",
      cancellationPolicy: {
        name: "Cancelación flexible",
        rules: [{ hoursBefore: 48, percentage: 100 }],
      },
    };
    expect(parseProductDetailView(withPolicy)).not.toBeNull();
    const withoutKey = { ...product };
    Reflect.deleteProperty(withoutKey, "cancellationPolicy");
    expect(parseProductDetailView(withoutKey)?.cancellationPolicy).toBeNull();
    expect(parseProductDetailView({ ...product, basePriceUsd: 80 })).toBeNull();
    expect(
      parseProductDetailView({
        ...product,
        cancellationPolicy: { name: "Rota", rules: [{ hoursBefore: 1, percentage: 150 }] },
      }),
    ).toBeNull();
  });

  it("valida la disponibilidad sin cupo exacto", () => {
    expect(parseAvailabilityView(availability)).not.toBeNull();
    expect(parseAvailabilityView({ ...availability, nights: [{ ...availability.nights[0], priceUsd: 80 }] })).toBeNull();
    expect(parseAvailabilityView({ ...availability, from: "no-fecha" })).toBeNull();
  });

  it("sanea el rango de la URL y construye las URLs de la API", () => {
    const params = new URLSearchParams({
      checkIn: "2026-12-01",
      checkOut: "2026-12-03",
      guests: "2",
    });
    expect(staySelectionFromParams(params)).toEqual({
      checkIn: "2026-12-01",
      checkOut: "2026-12-03",
      guests: 2,
    });
    expect(staySelectionFromParams(new URLSearchParams({ checkIn: "2026-12-03", checkOut: "2026-12-01", guests: "99" }))).toEqual({ guests: 1 });
    expect(availabilityApiUrl(product.id, { checkIn: "2026-12-01", checkOut: "2026-12-03", guests: 1 })).toBe(
      `/api/v1/products/${product.id}/availability?from=2026-12-01&to=2026-12-03`,
    );
  });

  it("elige la primera noche con cupo y calcula la salida", () => {
    expect(firstBookableNight(availability)).toBe("2026-12-01");
    expect(nextDay("2026-12-01")).toBe("2026-12-02");
    expect(firstBookableNight({ ...availability, nights: [] })).toBeNull();
  });
});

describe("vista de detalle", () => {
  it("muestra título, descripción, USD, fotos vacías, disponibilidad y CTA con fechas", () => {
    const html = render({
      selection: { checkIn: "2026-12-01", checkOut: "2026-12-03", guests: 2 },
    });
    expect(html).toContain('data-detail-status="ready"');
    expect(html).toContain("Posada del Puerto");
    expect(html).toContain("Habitación con vista al malecón.");
    expect(html).toContain("USD 80,00");
    expect(html).toContain("Sin fotos disponibles");
    expect(html).toContain("2 habitaciones libres");
    expect(html).toContain(">Reservar</a>");
    expect(html.match(/href="[^"]*checkout[^"]*"/)?.[0]).toBe(
      `href="/es/checkout/${product.id}?checkIn=2026-12-01&checkOut=2026-12-03&guests=2"`,
    );
    expect(html).not.toContain("·");
    expect(html).not.toContain("→");
  });

  it("oculta el VES sin tasa y muestra el estado sin política", () => {
    const html = render();
    expect(html).not.toContain("Equivalente BCV");
    expect(html).toContain("Este alojamiento no publica una política de cancelación.");
  });

  it("muestra la política y el equivalente VES cuando la API los envía", () => {
    const html = render({
      product: {
        ...product,
        basePriceVes: "3600.00",
        cancellationPolicy: {
          name: "Cancelación flexible",
          rules: [{ hoursBefore: 48, percentage: 100 }],
        },
        attributes: { ...product.attributes, images: ["https://images.caribe.test/hotel.jpg"] },
      },
    });
    expect(html).toContain("Equivalente BCV");
    expect(html).toContain("Cancelación flexible");
    expect(html).toContain("48 horas antes, 100 % de devolución");
    expect(html).toContain('src="https://images.caribe.test/hotel.jpg"');
    expect(html).toContain('alt="Posada del Puerto"');
  });

  it("no ofrece reservar cuando no hay cupo", () => {
    const html = render({
      availability: {
        ...availability,
        nights: availability.nights.map((night) => ({ ...night, remaining: 0 })),
      },
    });
    expect(html).toContain("Sin cupo para reservar");
    expect(html).not.toContain(">Reservar</a>");
  });

  it("anuncia carga, error y producto no público", () => {
    const loading = render({ status: "loading", product: null, availability: null });
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Cargando el detalle…");

    const error = render({ status: "error", product: null, availability: null });
    expect(error).toContain('role="alert"');
    expect(error).toContain("No pudimos cargar el detalle.");

    const missing = render({ status: "not-found", product: null, availability: null });
    expect(missing).toContain("Este alojamiento ya no está disponible.");
    expect(missing).toContain("/es/buscar");
  });
});
