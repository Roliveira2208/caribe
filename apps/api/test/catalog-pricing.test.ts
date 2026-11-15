import { describe, expect, it } from "vitest";
import { Prisma } from "../src/generated/prisma/client.js";
import { vesAmount } from "../src/catalog/catalog.pricing.js";

/**
 * Precio VES informativo (T-F1-6, spec catalog "Precios"): el monto se
 * multiplica por la tasa global con decimal.js y se redondea half-up a 2
 * decimales. Sin tasa no hay equivalente.
 */
describe("precio VES informativo", () => {
  it("sin tasa global devuelve null", () => {
    expect(vesAmount("100.00", null)).toBeNull();
  });

  it("multiplica por la tasa y redondea half-up a 2 decimales", () => {
    expect(vesAmount("100.00", "900.0000")).toBe("90000.00");
    expect(vesAmount("310.00", "900.0000")).toBe("279000.00");
    // 1,00 × 0,0050 = 0,005 → 0,01 (mitad hacia arriba).
    expect(vesAmount("1.00", "0.0050")).toBe("0.01");
    // 1,00 × 0,0049 = 0,0049 → 0,00.
    expect(vesAmount("1.00", "0.0049")).toBe("0.00");
    // 0,01 × 0,0050 = 0,00005 → 0,00.
    expect(vesAmount("0.01", "0.0050")).toBe("0.00");
  });

  it("acepta el Decimal de Prisma sin pasar por number", () => {
    expect(vesAmount(new Prisma.Decimal("123.45"), "900.0000")).toBe("111105.00");
  });
});
