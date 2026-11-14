import { describe, expect, it } from "vitest";
import { todayInCaracas } from "@caribe/shared";
import { ApiProblemException } from "../src/errors/api-problem.exception.js";
import {
  catalogOrderKey,
  decodeCatalogCursor,
  encodeCatalogCursor,
  type CatalogCursor,
} from "../src/catalog/catalog.cursor.js";
import {
  AVAILABILITY_DEFAULT_NIGHTS,
  CATALOG_MAX_LIMIT,
  addDays,
  availabilityQuerySchema,
  catalogQuerySchema,
} from "../src/catalog/catalog.schemas.js";

/**
 * Unitarios del contrato de lectura del catálogo (T-F1-3): cursor opaco y
 * validación de las queries. Los escenarios de 422 del delta de catalog
 * ("Cursor inválido" y "Límite fuera de rango") se prueban aquí sin base de
 * datos; el resto de la búsqueda y el detalle viven en catalog-api.e2e.ts.
 */
describe("cursor del catálogo", () => {
  const cursor: CatalogCursor = { order: "base", price: "100.00", id: "prod-1" };

  it("codifica y decodifica sin pérdida para el mismo orden", () => {
    const encoded = encodeCatalogCursor(cursor);
    expect(encoded).not.toContain("{");
    expect(decodeCatalogCursor(encoded, "base")).toEqual(cursor);
  });

  it("el cursor de una estancia lleva las fechas en el orden", () => {
    const stay = catalogOrderKey({ checkIn: "2026-12-01", checkOut: "2026-12-04" });
    expect(stay).toBe("stay:2026-12-01:2026-12-04");
    const encoded = encodeCatalogCursor({ ...cursor, order: stay });
    expect(decodeCatalogCursor(encoded, stay)).toEqual({ ...cursor, order: stay });
  });

  it("rechaza un cursor que no es base64url de JSON con 422", () => {
    expectValidationError(() => decodeCatalogCursor("%%%", "base"));
    expectValidationError(() =>
      decodeCatalogCursor(Buffer.from("no es json", "utf8").toString("base64url"), "base"),
    );
  });

  it("rechaza un cursor con forma inesperada con 422", () => {
    const missingId = Buffer.from(
      JSON.stringify({ order: "base", price: "100.00" }),
      "utf8",
    ).toString("base64url");
    expectValidationError(() => decodeCatalogCursor(missingId, "base"));
  });

  it("rechaza un precio que no es decimal de dos cifras con 422", () => {
    for (const price of ["100", "100.0", "1e3", "-1.00", "100.000"]) {
      const encoded = encodeCatalogCursor({ ...cursor, price });
      expectValidationError(() => decodeCatalogCursor(encoded, "base"));
    }
  });

  it("rechaza un identificador vacío con 422", () => {
    const encoded = encodeCatalogCursor({ ...cursor, id: "" });
    expectValidationError(() => decodeCatalogCursor(encoded, "base"));
  });

  it("rechaza un cursor generado para otro orden con 422", () => {
    const encoded = encodeCatalogCursor(cursor);
    expectValidationError(() =>
      decodeCatalogCursor(encoded, "stay:2026-12-01:2026-12-04"),
    );
  });
});

describe("query de la búsqueda", () => {
  const today = todayInCaracas();

  it("acepta los filtros completos y aplica el límite por defecto", () => {
    const parsed = catalogQuerySchema.parse({
      destinationId: "dest-1",
      checkIn: addDays(today, 1),
      checkOut: addDays(today, 3),
      guests: "2",
      type: "hotel",
      q: "  Hotel Sol  ",
      limit: String(CATALOG_MAX_LIMIT),
    });
    expect(parsed).toMatchObject({
      destinationId: "dest-1",
      guests: 2,
      type: "hotel",
      q: "Hotel Sol",
      limit: CATALOG_MAX_LIMIT,
    });
  });

  it("rechaza un límite fuera de rango", () => {
    expect(catalogQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(catalogQuerySchema.safeParse({ limit: String(CATALOG_MAX_LIMIT + 1) }).success).toBe(
      false,
    );
  });

  it("exige que checkIn y checkOut vayan juntos", () => {
    expect(catalogQuerySchema.safeParse({ checkIn: addDays(today, 1) }).success).toBe(false);
    expect(catalogQuerySchema.safeParse({ checkOut: addDays(today, 2) }).success).toBe(false);
  });

  it("aplica el rango de estancia de la reserva", () => {
    const ok = catalogQuerySchema.safeParse({
      checkIn: addDays(today, 1),
      checkOut: addDays(today, 31),
    });
    expect(ok.success).toBe(true);

    expect(
      catalogQuerySchema.safeParse({ checkIn: today, checkOut: today }).success,
    ).toBe(false);
    expect(
      catalogQuerySchema.safeParse({
        checkIn: addDays(today, -1),
        checkOut: addDays(today, 1),
      }).success,
    ).toBe(false);
    expect(
      catalogQuerySchema.safeParse({
        checkIn: addDays(today, 1),
        checkOut: addDays(today, 32),
      }).success,
    ).toBe(false);
  });

  it("limita las personas y el tipo, y rechaza claves desconocidas", () => {
    expect(catalogQuerySchema.safeParse({ guests: "0" }).success).toBe(false);
    expect(catalogQuerySchema.safeParse({ guests: "21" }).success).toBe(false);
    expect(catalogQuerySchema.safeParse({ type: "tour" }).success).toBe(false);
    expect(catalogQuerySchema.safeParse({ priceUsd: "1.00" }).success).toBe(false);
  });
});

describe("query de la disponibilidad", () => {
  const today = todayInCaracas();

  it("sin fechas usa 31 noches desde hoy y no altera el cuerpo", () => {
    expect(availabilityQuerySchema.parse({})).toEqual({});
    expect(AVAILABILITY_DEFAULT_NIGHTS).toBe(31);
  });

  it("acepta un rango explícito y un extremo ausente", () => {
    expect(
      availabilityQuerySchema.safeParse({
        from: today,
        to: addDays(today, 3),
      }).success,
    ).toBe(true);
    expect(availabilityQuerySchema.safeParse({ from: addDays(today, 2) }).success).toBe(true);
  });

  it("rechaza un rango vacío o invertido", () => {
    expect(availabilityQuerySchema.safeParse({ from: today, to: today }).success).toBe(false);
    expect(
      availabilityQuerySchema.safeParse({
        from: addDays(today, 3),
        to: addDays(today, 1),
      }).success,
    ).toBe(false);
    // `to` sin `from` se compara con el hoy por defecto.
    expect(availabilityQuerySchema.safeParse({ to: today }).success).toBe(false);
  });
});

function expectValidationError(fn: () => unknown): void {
  const error = capture(fn);
  expect(error.code).toBe("VALIDATION_ERROR");
  expect(error.issues?.[0]?.path).toBe("cursor");
}

function capture(fn: () => unknown): ApiProblemException {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiProblemException) return error;
    throw error;
  }
  throw new Error("se esperaba ApiProblemException");
}
