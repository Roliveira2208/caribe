import { randomInt } from "node:crypto";

/**
 * Codigo de reserva (T-F1-7, specs/booking "Codigo de reserva").
 *
 * `CRB-` seguido de 8 caracteres del alfabeto Crockford Base32, que excluye
 * `I`, `L`, `O` y `U` para que el codigo no se confunda al leerlo o dictarlo.
 * El codigo lo genera siempre el servidor: un `code` en el cuerpo responde 422.
 */

export const BOOKING_CODE_PREFIX = "CRB-";
export const BOOKING_CODE_LENGTH = 8;
export const BOOKING_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Mismo patron que el CHECK de la base (`bookings_code_check`). */
export const BOOKING_CODE_PATTERN = /^CRB-[0-9A-HJKMNP-TV-Z]{8}$/;

/** Cuantos codigos se prueban antes de rendirse con una colision. */
export const BOOKING_CODE_MAX_ATTEMPTS = 5;

/**
 * Genera un codigo `CRB-XXXXXXXX`. `pick` se inyecta en los tests para que el
 * resultado sea determinista; en produccion es `crypto.randomInt`, sin
 * `Math.random`.
 */
export function generateBookingCode(
  pick: (maxExclusive: number) => number = randomInt,
): string {
  let suffix = "";
  for (let index = 0; index < BOOKING_CODE_LENGTH; index += 1) {
    suffix += BOOKING_CODE_ALPHABET.charAt(pick(BOOKING_CODE_ALPHABET.length));
  }
  return `${BOOKING_CODE_PREFIX}${suffix}`;
}

/** true si el codigo cumple el formato publico `CRB-[0-9A-HJKMNP-TV-Z]{8}`. */
export function isBookingCode(value: string): boolean {
  return BOOKING_CODE_PATTERN.test(value);
}

/**
 * Reintenta la creacion cuando el codigo generado ya existe (spec booking,
 * "Colision de codigo"). `attempt` devuelve `null` para indicar colision; el
 * llamador repite con un codigo nuevo. Cualquier otro fallo se propaga.
 */
export async function withCodeRetry<T>(
  generate: () => string,
  attempt: (code: string) => Promise<T | null>,
  maxAttempts: number = BOOKING_CODE_MAX_ATTEMPTS,
): Promise<T> {
  for (let index = 0; index < maxAttempts; index += 1) {
    const result = await attempt(generate());
    if (result !== null) return result;
  }
  throw new Error(
    `No se pudo generar un codigo de reserva unico tras ${maxAttempts} intentos`,
  );
}
