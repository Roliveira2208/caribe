import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiProblemException } from "../src/errors/api-problem.exception.js";
import {
  decodeProductsAdminCursor,
  encodeProductsAdminCursor,
} from "../src/catalog/products-admin.cursor.js";
import {
  PRODUCTS_ADMIN_MAX_LIMIT,
  createProductSchema,
  normalizeLocalized,
  productsAdminQuerySchema,
  updateProductSchema,
} from "../src/catalog/products-admin.schemas.js";

/**
 * Unitarios del contrato del panel de productos (T-F1-4, delta de catalog
 * "Atributos de hotel" y "Estados"): validación del alta y la edición, filtros
 * del listado y cursor keyset. Los escenarios que exigen base de datos y
 * sesiones viven en products-admin.e2e.ts.
 */
describe("alta de producto", () => {
  const valid = {
    roomType: "standard",
    title: { es: "Hotel Sol", en: "Sun Hotel" },
    description: { es: "Habitación con vista", en: "Room with a view" },
    destinationId: randomUUID(),
    basePriceUsd: "120.50",
    attributes: {
      stars: 4,
      maxGuests: 2,
      amenities: ["wifi", "pool"],
      images: ["https://images.caribe.test/hotel.jpg"],
    },
  };

  it("acepta un tipo de habitación válido y aplica los defaults de atributos", () => {
    const parsed = createProductSchema.parse({
      ...valid,
      attributes: { stars: 4, maxGuests: 2 },
    });
    expect(parsed.attributes.amenities).toEqual([]);
    expect(parsed.attributes.images).toEqual([]);
    expect(parsed.hotelKey).toBeUndefined();
    expect(parsed.providerId).toBeUndefined();
  });

  it("acepta hotelKey, proveedor y política de cancelación", () => {
    const parsed = createProductSchema.parse({
      ...valid,
      hotelKey: randomUUID(),
      providerId: randomUUID(),
      cancellationPolicyId: randomUUID(),
    });
    expect(parsed.hotelKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rechaza atributos sin stars con el campo en falta", () => {
    const result = createProductSchema.safeParse({
      ...valid,
      attributes: { maxGuests: 2 },
    });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("attributes.stars");
  });

  it("rechaza una clave desconocida en los atributos", () => {
    const result = createProductSchema.safeParse({
      ...valid,
      attributes: { ...valid.attributes, view: "sea" },
    });
    expect(result.success).toBe(false);
    expect(issuePaths(result).some((path) => path.startsWith("attributes"))).toBe(true);
  });

  it("rechaza más de diez imágenes", () => {
    const images = Array.from(
      { length: 11 },
      (_, index) => `https://images.caribe.test/${index}.jpg`,
    );
    const result = createProductSchema.safeParse({
      ...valid,
      attributes: { ...valid.attributes, images },
    });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("attributes.images");
  });

  it("rechaza imágenes con esquema no permitido o ruta relativa", () => {
    for (const image of [
      "http://images.caribe.test/a.jpg",
      "data:image/png;base64,abc",
      "/images/a.jpg",
    ]) {
      const result = createProductSchema.safeParse({
        ...valid,
        attributes: { ...valid.attributes, images: [image] },
      });
      expect(result.success, image).toBe(false);
      expect(issuePaths(result).some((path) => path.startsWith("attributes.images"))).toBe(true);
    }
  });

  it("rechaza una imagen de un dominio no permitido", () => {
    const result = createProductSchema.safeParse({
      ...valid,
      attributes: { ...valid.attributes, images: ["https://evil.example.com/a.jpg"] },
    });
    expect(result.success).toBe(false);
    expect(issuePaths(result).some((path) => path.startsWith("attributes.images"))).toBe(true);
  });

  it("rechaza estrellas u ocupación fuera de rango", () => {
    for (const attributes of [
      { ...valid.attributes, stars: 0 },
      { ...valid.attributes, stars: 6 },
      { ...valid.attributes, maxGuests: 0 },
      { ...valid.attributes, maxGuests: 21 },
    ]) {
      const result = createProductSchema.safeParse({ ...valid, attributes });
      expect(result.success).toBe(false);
    }
  });

  it("rechaza montos que no son decimales positivos de 14,2", () => {
    for (const basePriceUsd of ["0", "0.00", "-1.00", "1e3", "12.345", 120]) {
      expect(createProductSchema.safeParse({ ...valid, basePriceUsd }).success, String(basePriceUsd)).toBe(
        false,
      );
    }
  });

  it("rechaza un roomType que no es código en minúsculas", () => {
    for (const roomType of ["Standard", "1standard", "standard room", ""]) {
      expect(createProductSchema.safeParse({ ...valid, roomType }).success, roomType).toBe(false);
    }
  });

  it("rechaza claves desconocidas en el cuerpo", () => {
    expect(createProductSchema.safeParse({ ...valid, status: "PUBLISHED" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, tenantId: randomUUID() }).success).toBe(false);
  });
});

describe("edición de producto", () => {
  it("acepta una edición parcial y rechaza el cuerpo vacío", () => {
    expect(updateProductSchema.safeParse({ basePriceUsd: "99.99" }).success).toBe(true);
    expect(updateProductSchema.safeParse({}).success).toBe(false);
  });

  it("no permite cambiar hotelKey, providerId ni status por el PUT", () => {
    for (const body of [
      { hotelKey: randomUUID() },
      { providerId: randomUUID() },
      { status: "PUBLISHED" },
    ]) {
      expect(updateProductSchema.safeParse(body).success).toBe(false);
    }
  });

  it("valida los atributos con el mismo esquema estricto", () => {
    expect(
      updateProductSchema.safeParse({
        attributes: { stars: 5, maxGuests: 3, amenities: [], images: [] },
      }).success,
    ).toBe(true);
    expect(updateProductSchema.safeParse({ attributes: { stars: 5 } }).success).toBe(false);
  });
});

describe("listado de panel", () => {
  it("acepta los filtros y convierte el límite", () => {
    const parsed = productsAdminQuerySchema.parse({
      status: "DRAFT",
      providerId: randomUUID(),
      hotelKey: randomUUID(),
      destinationId: randomUUID(),
      q: "  Sol  ",
      limit: "50",
    });
    expect(parsed).toMatchObject({ status: "DRAFT", q: "Sol", limit: 50 });
  });

  it("rechaza un límite fuera de rango, un estado desconocido o claves de más", () => {
    expect(productsAdminQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(
      productsAdminQuerySchema.safeParse({ limit: String(PRODUCTS_ADMIN_MAX_LIMIT + 1) }).success,
    ).toBe(false);
    expect(productsAdminQuerySchema.safeParse({ status: "DELETED" }).success).toBe(false);
    expect(productsAdminQuerySchema.safeParse({ deletedAt: "x" }).success).toBe(false);
  });
});

describe("cursor del panel", () => {
  const cursor = { updatedAt: "2026-11-13T10:20:30.400Z", id: randomUUID() };

  it("codifica y decodifica sin pérdida", () => {
    const encoded = encodeProductsAdminCursor(cursor);
    expect(encoded).not.toContain("{");
    expect(decodeProductsAdminCursor(encoded)).toEqual({ order: "panel", ...cursor });
  });

  it("rechaza un cursor ilegible o con forma inesperada con 422", () => {
    const cases = [
      "%%%",
      Buffer.from("no es json", "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ order: "panel", id: cursor.id }), "utf8").toString("base64url"),
      Buffer.from(
        JSON.stringify({ order: "otro", updatedAt: cursor.updatedAt, id: cursor.id }),
        "utf8",
      ).toString("base64url"),
      Buffer.from(
        JSON.stringify({ order: "panel", updatedAt: "ayer", id: cursor.id }),
        "utf8",
      ).toString("base64url"),
      Buffer.from(
        JSON.stringify({ order: "panel", updatedAt: cursor.updatedAt, id: "" }),
        "utf8",
      ).toString("base64url"),
    ];
    for (const raw of cases) expectValidationError(() => decodeProductsAdminCursor(raw));
  });
});

describe("texto i18n", () => {
  it("cae a es cuando falta en y conserva ambos cuando están", () => {
    expect(normalizeLocalized({ es: "Hotel" })).toEqual({ es: "Hotel", en: "Hotel" });
    expect(normalizeLocalized({ es: "Hotel", en: "Hotel" })).toEqual({
      es: "Hotel",
      en: "Hotel",
    });
  });
});

function issuePaths(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) {
  if (result.success || !result.error) return [];
  return result.error.issues.map((issue) => issue.path.map(String).join("."));
}

function expectValidationError(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiProblemException);
    const problem = error as ApiProblemException;
    expect(problem.code).toBe("VALIDATION_ERROR");
    expect(problem.issues?.[0]?.path).toBe("cursor");
    return;
  }
  throw new Error("se esperaba ApiProblemException");
}
