import { describe, expect, it } from "vitest";
import {
  buildCatalogQuery,
  formatRate,
  formatUsd,
  formatValueDate,
  formatVes,
  localizedText,
  type CatalogSearchInput,
} from "../src/lib/catalog-view";

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, " ");

describe("buildCatalogQuery", () => {
  it("omite campos vacíos y conserva un orden estable", () => {
    const input: CatalogSearchInput = {
      q: "",
      destinationId: "dest-1",
      checkIn: "2026-11-20",
      checkOut: "2026-11-23",
      guests: 2,
      type: "hotel",
      minPriceUsd: "90",
      maxPriceUsd: "120.50",
    };
    expect(buildCatalogQuery(input)).toBe(
      "destinationId=dest-1&checkIn=2026-11-20&checkOut=2026-11-23&guests=2&type=hotel&minPriceUsd=90&maxPriceUsd=120.50",
    );
  });

  it("codifica el texto y acepta cursor y límite", () => {
    const query = buildCatalogQuery({ q: "café & mar", cursor: "a/b=", limit: 20 });
    expect(query).toBe("q=caf%C3%A9+%26+mar&cursor=a%2Fb%3D&limit=20");
  });

  it("devuelve una cadena vacía sin filtros", () => {
    expect(buildCatalogQuery({})).toBe("");
  });
});

describe("localizedText", () => {
  it("elige el idioma pedido y cae a es y después a en", () => {
    const text = { es: "Mérida", en: "Merida" };
    expect(localizedText(text, "es")).toBe("Mérida");
    expect(localizedText(text, "en")).toBe("Merida");
    expect(localizedText({ es: "Mérida" }, "en")).toBe("Mérida");
    expect(localizedText({ en: "Merida" }, "es")).toBe("Merida");
  });

  it("devuelve una cadena vacía cuando no hay texto", () => {
    expect(localizedText(null, "es")).toBe("");
    expect(localizedText({}, "en")).toBe("");
  });
});

describe("formatos de dinero y tasa", () => {
  it("formatea USD y VES según el locale", () => {
    expect(normalize(formatUsd("100.00", "es"))).toBe("USD 100,00");
    expect(normalize(formatUsd("100.00", "en"))).toBe("$100.00");
    expect(normalize(formatVes("3600.00", "es"))).toBe("Bs.S 3.600,00");
    expect(normalize(formatVes("3600.00", "en"))).toBe("VES 3,600.00");
  });

  it("rechaza texto que no sea un decimal", () => {
    expect(() => formatUsd("abc", "es")).toThrow(RangeError);
  });

  it("formatea la tasa con dos decimales y la fecha valor sin cambiar de día", () => {
    expect(normalize(formatRate("36.0000", "es"))).toBe("36,00");
    expect(normalize(formatRate("36.0000", "en"))).toBe("36.00");
    expect(formatValueDate("2026-11-10", "es")).toBe("10/11/2026");
    expect(formatValueDate("2026-11-10", "en")).toBe("11/10/2026");
  });
});
