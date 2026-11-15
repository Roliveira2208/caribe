/**
 * Contrato del proveedor de tasas (T-F1-5, design §6 y spec exchange-rates).
 *
 * El proveedor entrega la tasa como texto decimal: nunca se acepta un `number`
 * de punto flotante como fuente de verdad. El servicio valida el texto con
 * `isValidRateText` antes de guardarlo, de modo que un valor inválido se trata
 * como fallo del proveedor y entra el respaldo.
 */
export interface ExchangeRateProvider {
  /**
   * Tasa oficial para una fecha calendario `YYYY-MM-DD` en America/Caracas.
   * Devuelve el texto tal como lo publica la fuente y, si la fuente lo
   * informa, la fecha de publicación (un feriado devuelve la del último día
   * hábil). El llamador valida ambos.
   */
  getRate(date: string): Promise<ProviderRate>;
}

/** Respuesta cruda del proveedor: tasa en texto y fecha de publicación. */
export interface ProviderRate {
  rate: string;
  valueDate?: string;
}

/**
 * Tasa DECIMAL(18,4): hasta 14 dígitos enteros y 0–4 decimales, sin signo y
 * sin notación exponencial. El cero no es una tasa válida.
 */
export const RATE_TEXT_PATTERN = /^\d{1,14}(?:\.\d{1,4})?$/;

const ZERO_RATE_PATTERN = /^0+(?:\.0{1,4})?$/;

/** true si el texto es una tasa válida: > 0 y con ≤ 4 decimales. */
export function isValidRateText(value: string): boolean {
  return RATE_TEXT_PATTERN.test(value) && !ZERO_RATE_PATTERN.test(value);
}

/**
 * Valida y devuelve el texto de la tasa sin normalizarlo. Lanza `RangeError`
 * con un mensaje sin el valor recibido: los mensajes de error no repiten datos
 * del proveedor.
 */
export function parseRateText(value: string): string {
  if (!isValidRateText(value)) {
    throw new RangeError("La tasa recibida no es un decimal válido mayor que cero");
  }
  return value;
}
