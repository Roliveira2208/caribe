import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { featuredApiUrl, FEATURED_LIMIT } from "../src/lib/featured-view";
import type { CatalogOfferView } from "../src/lib/search-view";
import { FeaturedStaysView, type FeaturedLabels } from "../src/components/featured-stays";

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, " ");

const labels: FeaturedLabels = {
  title: "Alojamientos destacados",
  subtitle: "Publicados por agencias venezolanas.",
  loading: "Cargando…",
  empty: "Todavía no hay alojamientos publicados.",
  viewDetail: "Ver alojamiento",
  rateLabel: "Equivalente BCV",
  tour: "Tours",
  package: "Paquetes",
  flight: "Vuelos",
  comingSoon: "Próximamente",
  scrollToClosing: "Ir al cierre",
};

function offer(overrides: Partial<CatalogOfferView> = {}): CatalogOfferView {
  return {
    id: "offer-1",
    hotelKey: "hotel-1",
    roomType: "Habitación doble",
    type: "hotel",
    title: { es: "Posada Malvin", en: "Malvin Inn" },
    description: { es: "Frente al mar", en: "Seafront" },
    destination: {
      id: "dest-roques",
      name: { es: "Los Roques", en: "Los Roques" },
      country: "VE",
      code: "LRQ",
    },
    attributes: { stars: 3, maxGuests: 2, amenities: [], images: [] },
    basePriceUsd: "120.00",
    basePriceVes: "4320.00",
    totalUsd: null,
    totalVes: null,
    ...overrides,
  };
}

describe("alojamientos destacados", () => {
  it("pide tres hoteles publicados a la API", () => {
    expect(featuredApiUrl()).toBe(`/api/v1/products?limit=${FEATURED_LIMIT}&type=hotel`);
    expect(FEATURED_LIMIT).toBe(3);
  });

  it("muestra títulos y precios que vienen de la API", () => {
    const html = normalize(
      renderToStaticMarkup(
        createElement(FeaturedStaysView, {
          items: [offer(), offer({ id: "offer-2", title: { es: "Hotel Sol", en: "Sun Hotel" } })],
          status: "ready",
          locale: "es",
          labels,
        }),
      ),
    );
    expect(html).toContain('id="destacados"');
    expect(html).toContain('min-h-dvh');
    expect(html).toContain('href="#cierre"');
    expect(html).toContain("Posada Malvin");
    expect(html).toContain("Hotel Sol");
    expect(html).toContain("120,00");
    expect(html).toContain('/es/hotels/offer-1');
    expect(html).not.toContain("Cargando");
  });

  it("muestra un estado vacío traducido, nunca una tarjeta falsa", () => {
    const html = renderToStaticMarkup(
      createElement(FeaturedStaysView, { items: [], status: "ready", locale: "es", labels }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain(labels.empty);
    expect(html).not.toContain("<article");
  });

  it("marca Tours, Paquetes y Vuelos como próximamente sin datos de ejemplo", () => {
    const html = renderToStaticMarkup(
      createElement(FeaturedStaysView, { items: [], status: "ready", locale: "en", labels }),
    );
    for (const label of [labels.tour, labels.package, labels.flight]) {
      expect(html).toContain(label);
    }
    expect(html.match(new RegExp(labels.comingSoon, "g"))?.length).toBe(3);
  });
});
