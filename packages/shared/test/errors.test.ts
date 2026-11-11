import { describe, expect, it } from "vitest";
import {
  API_ERROR_STATUS,
  API_ERROR_TITLES,
  formatAmount,
  formatRate,
  formatTimestamp,
  formatValueDate,
  isApiErrorCode,
  problemType,
} from "../src/index";

describe("tabla de códigos de error", () => {
  it("cada código tiene estado, título y tipo de problema", () => {
    for (const code of Object.keys(API_ERROR_STATUS)) {
      expect(isApiErrorCode(code)).toBe(true);
      expect(API_ERROR_TITLES[code as keyof typeof API_ERROR_TITLES]).toBeTruthy();
      expect(problemType(code as keyof typeof API_ERROR_STATUS)).toMatch(
        /^https:\/\/caribe\.app\/problems\/[a-z0-9-]+$/,
      );
    }
  });

  it("no acepta códigos inventados", () => {
    expect(isApiErrorCode("TWO_FACTOR_REQUIRED")).toBe(true);
    expect(isApiErrorCode("CUPO_AGOTADO")).toBe(false);
    expect(isApiErrorCode("")).toBe(false);
    expect(isApiErrorCode(undefined)).toBe(false);
  });

  it("el tipo de problema no depende de datos del cliente", () => {
    expect(problemType("AVAILABILITY_EXHAUSTED")).toBe(
      "https://caribe.app/problems/availability-exhausted",
    );
  });
});

describe("serialización de dinero", () => {
  it("un monto lleva siempre dos decimales", () => {
    expect(formatAmount("100")).toBe("100.00");
    expect(formatAmount("90000")).toBe("90000.00");
    expect(formatAmount("0.1")).toBe("0.10");
    expect(formatAmount("-15.5")).toBe("-15.50");
    expect(formatAmount(100n)).toBe("100.00");
    expect(formatAmount({ toString: () => "1234.5" })).toBe("1234.50");
  });

  it("redondea sobre los dígitos, sin aritmética de punto flotante", () => {
    expect(formatAmount("100.005")).toBe("100.01");
    expect(formatAmount("0.999")).toBe("1.00");
    expect(formatAmount("99.995")).toBe("100.00");
    expect(formatAmount(1.005)).toBe("1.01");
    expect(formatAmount("0.004")).toBe("0.00");
  });

  it("normaliza el cero negativo", () => {
    expect(formatAmount("-0.00")).toBe("0.00");
    expect(formatAmount("-0")).toBe("0.00");
  });

  it("rechaza valores que no son decimales", () => {
    expect(() => formatAmount("abc")).toThrow(/decimal/i);
    expect(() => formatAmount(Number.NaN)).toThrow(/decimal/i);
    expect(() => formatAmount(Number.POSITIVE_INFINITY)).toThrow(/decimal/i);
    expect(() => formatAmount("1e3")).toThrow(/decimal/i);
  });

  it("una tasa lleva siempre cuatro decimales", () => {
    expect(formatRate("900")).toBe("900.0000");
    expect(formatRate("900.5")).toBe("900.5000");
    expect(formatRate("123.45675")).toBe("123.4568");
    expect(formatRate("0.00005")).toBe("0.0001");
  });
});

describe("serialización de fechas", () => {
  it("una columna DATE de Prisma (medianoche UTC) es la fecha calendario", () => {
    expect(formatValueDate(new Date("2026-11-10T00:00:00.000Z"))).toBe("2026-11-10");
    expect(formatValueDate(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
  });

  it("una marca de tiempo se interpreta en America/Caracas", () => {
    // 02:00 UTC del 11 es 22:00 del 10 en Caracas (UTC-4).
    expect(formatValueDate(new Date("2026-11-11T02:00:00.000Z"))).toBe("2026-11-10");
    expect(formatValueDate("2026-11-11T02:00:00.000Z")).toBe("2026-11-10");
  });

  it("acepta y valida una fecha calendario en texto", () => {
    expect(formatValueDate("2026-11-10")).toBe("2026-11-10");
    expect(() => formatValueDate("2026-02-30")).toThrow(/fecha/i);
    expect(() => formatValueDate("no-es-fecha")).toThrow(/fecha/i);
  });

  it("una marca de tiempo sale en ISO 8601 UTC terminada en Z", () => {
    expect(formatTimestamp(new Date("2026-11-10T15:04:05.000Z"))).toBe(
      "2026-11-10T15:04:05.000Z",
    );
    expect(formatTimestamp("2026-11-10T10:04:05-04:00")).toBe("2026-11-10T14:04:05.000Z");
    expect(formatTimestamp(new Date("2026-11-10T00:00:00.000Z"))).toMatch(/Z$/);
  });
});
