import { describe, expect, it } from "vitest";
import { catalogQuerySchema } from "../src/catalog/catalog.schemas.js";

/**
 * Contrato de `minPriceUsd`/`maxPriceUsd` (change
 * public-rate-and-price-filters, spec catalog "Filtro de precio en USD").
 * Los límites son texto decimal positivo con hasta 14 enteros y 2 decimales;
 * un rango invertido se rechaza con el campo responsable.
 */
describe("catalogQuerySchema (filtro de precio)", () => {
  it("acepta límites positivos con hasta dos decimales", () => {
    const parsed = catalogQuerySchema.parse({
      minPriceUsd: "90",
      maxPriceUsd: "120.50",
      type: "hotel",
    });
    expect(parsed.minPriceUsd).toBe("90");
    expect(parsed.maxPriceUsd).toBe("120.50");
  });

  it("acepta un solo extremo y ninguno", () => {
    expect(catalogQuerySchema.parse({ maxPriceUsd: "100" }).maxPriceUsd).toBe("100");
    expect(catalogQuerySchema.parse({ minPriceUsd: "0.01" }).minPriceUsd).toBe("0.01");
    const none = catalogQuerySchema.parse({});
    expect(none.minPriceUsd).toBeUndefined();
    expect(none.maxPriceUsd).toBeUndefined();
  });

  it("rechaza un rango invertido señalando maxPriceUsd", () => {
    const result = catalogQuerySchema.safeParse({ minPriceUsd: "120", maxPriceUsd: "90" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.includes("maxPriceUsd")),
      ).toBe(true);
    }
  });

  it("rechaza cero, negativos, más de dos decimales y más de 14 enteros", () => {
    const invalid = ["0", "-1", "1.234", "abc", "123456789012345", "1e3"];
    for (const value of invalid) {
      const result = catalogQuerySchema.safeParse({ minPriceUsd: value });
      expect(result.success, value).toBe(false);
    }
  });

  it("rechaza claves desconocidas", () => {
    expect(catalogQuerySchema.safeParse({ minPrice: "90" }).success).toBe(false);
  });
});
