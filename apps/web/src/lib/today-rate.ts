/**
 * Contrato de la lectura pública de la tasa (change
 * public-rate-and-price-filters). Es el mismo cuerpo que responde
 * `GET /api/v1/rates/today`: solo `available`, `rate` y `valueDate`, sin ámbito,
 * procedencia ni overrides de agencia.
 *
 * La validación de negocio ya ocurrió en la API; aquí solo se comprueba la forma
 * para que un payload inesperado no llegue a `Intl.NumberFormat` ni pinte una
 * fecha inventada en la cabecera.
 */
export interface TodayRateView {
  available: boolean;
  rate: string | null;
  valueDate: string | null;
}

/** Estado cuando no hay tasa global o la lectura falló. */
export const UNAVAILABLE_RATE: TodayRateView = {
  available: false,
  rate: null,
  valueDate: null,
};

const RATE_TEXT_PATTERN = /^\d{1,14}(?:\.\d{1,4})?$/;
const ZERO_RATE_PATTERN = /^0+(?:\.0{1,4})?$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Devuelve la vista o `null` si el cuerpo no respeta el contrato. */
export function parseTodayRateView(value: unknown): TodayRateView | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.available !== "boolean") return null;
  if (!record.available) return { ...UNAVAILABLE_RATE };
  if (typeof record.rate !== "string" || typeof record.valueDate !== "string") return null;
  if (!RATE_TEXT_PATTERN.test(record.rate) || ZERO_RATE_PATTERN.test(record.rate)) return null;
  if (!DATE_ONLY_PATTERN.test(record.valueDate)) return null;
  return { available: true, rate: record.rate, valueDate: record.valueDate };
}
