import type { CatalogAttributes, LocalizedText } from "./catalog.schemas.js";

/**
 * Mapeos compartidos entre la lectura pública (T-F1-3) y el panel (T-F1-4).
 * El texto i18n cae de `en` a `es` y viceversa; los atributos se proyectan
 * solo con las claves públicas del esquema de hotel.
 */

export function toLocalized(value: unknown): LocalizedText {
  const record = asRecord(value);
  const es = typeof record["es"] === "string" ? record["es"] : "";
  const en = typeof record["en"] === "string" ? record["en"] : "";
  return { es: es || en, en: en || es };
}

export function toAttributes(value: unknown): CatalogAttributes {
  const record = asRecord(value);
  return {
    stars: integerOr(record["stars"], 0),
    maxGuests: integerOr(record["maxGuests"], 0),
    amenities: stringArray(record["amenities"]),
    images: stringArray(record["images"]),
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function integerOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
