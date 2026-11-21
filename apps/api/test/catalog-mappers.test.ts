import { describe, expect, it } from "vitest";
import { toPublicCancellationPolicy } from "../src/catalog/catalog.mappers.js";

/**
 * Defensa en profundidad del detalle público (catalog-public-cancellation-policy).
 * El trigger de la base valida las reglas, pero la API no confía en que el JSONB
 * sea correcto: si está corrupto debe devolver una lista vacía, nunca el crudo.
 */
describe("toPublicCancellationPolicy", () => {
  it("convierte reglas válidas a camelCase", () => {
    expect(
      toPublicCancellationPolicy({
        name: "Flexible",
        rules: [
          { hours_before: 48, percentage: 100 },
          { hours_before: 24, percentage: 50 },
        ],
      }),
    ).toEqual({
      name: "Flexible",
      rules: [
        { hoursBefore: 48, percentage: 100 },
        { hoursBefore: 24, percentage: 50 },
      ],
    });
  });

  it("devuelve reglas vacías ante JSONB corrupto sin filtrar el contenido", () => {
    const corrupted = {
      name: "Rota",
      rules: [
        { hours_before: 24, percentage: 50, extra: "secreto" },
        { hours_before: 1, percentage: 150 },
      ],
    };
    const result = toPublicCancellationPolicy(corrupted);
    expect(result.name).toBe("Rota");
    expect(result.rules).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("secreto");
    expect(JSON.stringify(result)).not.toContain("hours_before");
  });

  it("devuelve reglas vacías si el JSONB no es un arreglo", () => {
    expect(toPublicCancellationPolicy({ name: "Rota", rules: { hours_before: 24 } }).rules).toEqual(
      [],
    );
    expect(toPublicCancellationPolicy({ name: "Rota", rules: null }).rules).toEqual([]);
  });
});
