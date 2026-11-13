import { describe, expect, it } from "vitest";
import {
  cancellationRulesSchema,
  hotelAttributesSchema,
  stayRangeSchema,
  todayInCaracas,
} from "../src/catalog";

const allowedHosts = ["images.caribe.test", "cdn.caribe.test"];

describe("atributos de hotel", () => {
  const schema = hotelAttributesSchema(allowedHosts);

  it("acepta estrellas, ocupación, amenidades e imágenes https permitidas", () => {
    const parsed = schema.parse({
      stars: 4,
      maxGuests: 2,
      amenities: ["wifi", "pool"],
      images: ["https://images.caribe.test/hotel/1.jpg"],
    });
    expect(parsed).toEqual({
      stars: 4,
      maxGuests: 2,
      amenities: ["wifi", "pool"],
      images: ["https://images.caribe.test/hotel/1.jpg"],
    });
  });

  it("completa amenidades e imágenes vacías cuando no se envían", () => {
    expect(schema.parse({ stars: 3, maxGuests: 1 })).toEqual({
      stars: 3,
      maxGuests: 1,
      amenities: [],
      images: [],
    });
  });

  it("rechaza claves desconocidas", () => {
    const result = schema.safeParse({ stars: 3, maxGuests: 2, hotelName: "X" });
    expect(result.success).toBe(false);
  });

  it("rechaza estrellas y ocupación fuera de rango", () => {
    for (const stars of [0, 6]) {
      expect(schema.safeParse({ stars, maxGuests: 2 }).success).toBe(false);
    }
    for (const maxGuests of [0, 21]) {
      expect(schema.safeParse({ stars: 3, maxGuests }).success).toBe(false);
    }
  });

  it("rechaza valores no enteros", () => {
    expect(schema.safeParse({ stars: 4.5, maxGuests: 2 }).success).toBe(false);
    expect(schema.safeParse({ stars: 4, maxGuests: 2.5 }).success).toBe(false);
  });

  it("rechaza más de diez imágenes", () => {
    const images = Array.from(
      { length: 11 },
      (_, index) => `https://images.caribe.test/hotel/${index}.jpg`,
    );
    expect(schema.safeParse({ stars: 3, maxGuests: 2, images }).success).toBe(false);
  });

  it("rechaza esquemas no https, rutas relativas y data urls", () => {
    for (const image of [
      "http://images.caribe.test/hotel.jpg",
      "/images/hotel.jpg",
      "data:image/png;base64,AAAA",
    ]) {
      expect(schema.safeParse({ stars: 3, maxGuests: 2, images: [image] }).success).toBe(false);
    }
  });

  it("rechaza dominios fuera de la lista permitida", () => {
    expect(
      schema.safeParse({
        stars: 3,
        maxGuests: 2,
        images: ["https://evil.test/hotel.jpg"],
      }).success,
    ).toBe(false);
  });

  it("rechaza credenciales embebidas en la URL", () => {
    expect(
      schema.safeParse({
        stars: 3,
        maxGuests: 2,
        images: ["https://user:pass@images.caribe.test/hotel.jpg"],
      }).success,
    ).toBe(false);
  });

  it("acepta cualquier host permitido y lo compara sin distinguir mayúsculas", () => {
    expect(
      schema.safeParse({
        stars: 3,
        maxGuests: 2,
        images: ["https://CDN.CARIBE.TEST/hotel.jpg"],
      }).success,
    ).toBe(true);
  });
});

describe("reglas de cancelación", () => {
  it("acepta reglas con horas estrictamente descendentes y porcentajes 0–100", () => {
    const rules = [
      { hours_before: 72, percentage: 100 },
      { hours_before: 24, percentage: 50 },
      { hours_before: 0, percentage: 0 },
    ];
    expect(cancellationRulesSchema.parse(rules)).toEqual(rules);
  });

  it("rechaza una lista vacía o con más de diez reglas", () => {
    expect(cancellationRulesSchema.safeParse([]).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, index) => ({
      hours_before: 100 - index,
      percentage: 10,
    }));
    expect(cancellationRulesSchema.safeParse(eleven).success).toBe(false);
  });

  it("rechaza horas no descendentes", () => {
    expect(
      cancellationRulesSchema.safeParse([
        { hours_before: 24, percentage: 50 },
        { hours_before: 24, percentage: 25 },
      ]).success,
    ).toBe(false);
    expect(
      cancellationRulesSchema.safeParse([
        { hours_before: 24, percentage: 50 },
        { hours_before: 48, percentage: 25 },
      ]).success,
    ).toBe(false);
  });

  it("rechaza horas negativas o no enteras", () => {
    expect(cancellationRulesSchema.safeParse([{ hours_before: -1, percentage: 10 }]).success).toBe(
      false,
    );
    expect(cancellationRulesSchema.safeParse([{ hours_before: 1.5, percentage: 10 }]).success).toBe(
      false,
    );
  });

  it("rechaza porcentajes fuera de 0–100 o no enteros", () => {
    for (const percentage of [-1, 101, 12.5]) {
      expect(
        cancellationRulesSchema.safeParse([{ hours_before: 24, percentage }]).success,
      ).toBe(false);
    }
  });

  it("rechaza claves desconocidas en una regla", () => {
    expect(
      cancellationRulesSchema.safeParse([{ hours_before: 24, percentage: 50, extra: true }]).success,
    ).toBe(false);
  });
});

describe("rango de estancia", () => {
  it("acepta una estancia de una noche con checkOut posterior a checkIn", () => {
    const schema = stayRangeSchema({ today: "2026-11-12" });
    expect(schema.parse({ checkIn: "2026-11-12", checkOut: "2026-11-13" })).toEqual({
      checkIn: "2026-11-12",
      checkOut: "2026-11-13",
    });
  });

  it("acepta exactamente 30 noches", () => {
    const schema = stayRangeSchema({ today: "2026-11-12" });
    expect(schema.safeParse({ checkIn: "2026-11-12", checkOut: "2026-12-12" }).success).toBe(true);
  });

  it("rechaza 31 noches", () => {
    const schema = stayRangeSchema({ today: "2026-11-12" });
    expect(schema.safeParse({ checkIn: "2026-11-12", checkOut: "2026-12-13" }).success).toBe(false);
  });

  it("rechaza checkOut igual o anterior a checkIn", () => {
    const schema = stayRangeSchema({ today: "2026-11-12" });
    expect(schema.safeParse({ checkIn: "2026-11-12", checkOut: "2026-11-12" }).success).toBe(false);
    expect(schema.safeParse({ checkIn: "2026-11-13", checkOut: "2026-11-12" }).success).toBe(false);
  });

  it("rechaza fechas pasadas", () => {
    const schema = stayRangeSchema({ today: "2026-11-12" });
    expect(schema.safeParse({ checkIn: "2026-11-11", checkOut: "2026-11-13" }).success).toBe(false);
  });

  it("rechaza formatos que no son fecha calendario", () => {
    const schema = stayRangeSchema({ today: "2026-11-12" });
    for (const checkIn of ["2026-11-12T00:00:00Z", "12/11/2026", "2026-13-01"]) {
      expect(schema.safeParse({ checkIn, checkOut: "2026-12-12" }).success).toBe(false);
    }
  });

  it("calcula hoy en la zona America/Caracas", () => {
    // 2026-11-12T03:30:00Z todavía es 2026-11-11 en Caracas (UTC-4).
    expect(todayInCaracas(new Date("2026-11-12T03:30:00Z"))).toBe("2026-11-11");
    expect(todayInCaracas(new Date("2026-11-12T04:30:00Z"))).toBe("2026-11-12");
  });
});
