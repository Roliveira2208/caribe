import { describe, expect, it } from "vitest";
import {
  CHECK_IN_HOUR,
  checkInInstant,
  hoursUntilCheckIn,
  parsePolicySnapshot,
  refundAmounts,
  refundPercentage,
} from "../src/bookings/cancellation-policy.js";

/**
 * Unitarios de la política de cancelación (T-F1-10, specs/booking
 * "Cancelación" y specs/payments "Reembolso").
 */
describe("cancellation policy", () => {
  const rules = [
    { hours_before: 72, percentage: 100 },
    { hours_before: 24, percentage: 50 },
  ];

  it("ancla el check-in a las 15:00 de America/Caracas (19:00Z)", () => {
    expect(CHECK_IN_HOUR).toBe(15);
    expect(checkInInstant("2026-12-01").toISOString()).toBe("2026-12-01T19:00:00.000Z");
  });

  it("cuenta las horas que faltan para el check-in", () => {
    const now = new Date("2026-11-30T13:00:00.000Z");
    expect(hoursUntilCheckIn("2026-12-01", now)).toBe(30);
  });

  it("aplica la primera regla cuyo umbral ya se cumple", () => {
    const now = new Date("2026-11-30T13:00:00.000Z");
    expect(refundPercentage(rules, "2026-12-01", now)).toBe(50);
  });

  it("aplica la regla más generosa cuando faltan muchas horas", () => {
    const now = new Date("2026-11-27T13:00:00.000Z");
    expect(refundPercentage(rules, "2026-12-01", now)).toBe(100);
  });

  it("no reembolsa si ninguna regla se cumple", () => {
    const now = new Date("2026-12-01T13:00:00.000Z");
    expect(refundPercentage(rules, "2026-12-01", now)).toBe(0);
  });

  it("no reembolsa con el check-in ya pasado", () => {
    const now = new Date("2026-12-02T00:00:00.000Z");
    expect(refundPercentage(rules, "2026-12-01", now)).toBe(0);
  });

  it("trata un snapshot corrupto como sin política", () => {
    expect(refundPercentage([], "2026-12-01", new Date("2026-11-30T13:00:00.000Z"))).toBe(0);
    expect(
      refundPercentage(
        [{ hours_before: 24, percentage: 50 }, { hours_before: 72, percentage: 100 }],
        "2026-12-01",
        new Date("2026-11-30T13:00:00.000Z"),
      ),
    ).toBe(0);
  });

  it("calcula el VES desde el USD reembolsado con la tasa congelada", () => {
    expect(refundAmounts("100.00", 50, "900.0000")).toEqual({
      amountUsd: "50.00",
      amountVes: "45000.00",
    });
  });

  it("redondea a 2 decimales con ROUND_HALF_UP", () => {
    expect(refundAmounts("100.05", 50, "900.0000").amountUsd).toBe("50.03");
    expect(refundAmounts("10.00", 33, "40.0000").amountUsd).toBe("3.30");
  });

  it("lee el snapshot congelado y tolera valores incompletos", () => {
    expect(
      parsePolicySnapshot({ policyId: "p1", name: "Flexible", rules }),
    ).toEqual({ policyId: "p1", name: "Flexible", rules });
    expect(parsePolicySnapshot({ policyId: null, name: null, rules: [] })).toEqual({
      policyId: null,
      name: null,
      rules: [],
    });
    expect(parsePolicySnapshot("no-es-objeto")).toEqual({
      policyId: null,
      name: null,
      rules: [],
    });
  });
});
