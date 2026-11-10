/**
 * Sanitizador de payloads de auditoria (T-F0-9, spec audit): las columnas
 * before/after de audit_logs registran el estado de la entidad antes y
 * despues de la accion sensible, y ese estado nunca debe arrastrar
 * contrasenas, tokens, secretos TOTP ni datos de tarjeta.
 *
 * Denylist por clave normalizada (minusculas sin separadores) con
 * coincidencia por subcadena: redactar de mas es un falso positivo inocuo;
 * redactar de menos es una fuga. Los valores sensibles se sustituyen por
 * "[redacted]" para conservar la forma del payload.
 */

/** Valor con el que se sustituye cualquier dato sensible. */
export const REDACTED = "[redacted]";

/** Subcadenas (sobre la clave normalizada) que nunca llegan a audit_logs. */
const SENSITIVE_KEY_FRAGMENTS: readonly string[] = [
  "password",
  "passwd",
  "token",
  "secret",
  "cvv",
  "cvc",
  "cardnumber",
  "cardnum",
  "cardno",
  "creditcard",
  "card",
];

/** minusculas y sin separadores: "cardNumber" y "card_number" -> "cardnumber". */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Devuelve una copia redactada del payload. Objetos y arreglos se recorren
 * recursivamente (con proteccion de ciclos); primitivos pasan tal cual. No
 * muta el original: la respuesta HTTP puede compartir estructura con lo que
 * el handler le paso.
 */
export function sanitizeAuditPayload(value: unknown): unknown {
  return sanitize(value, new WeakSet<object>());
}

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return REDACTED;
    seen.add(value);
    return value.map((item) => sanitize(item, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return REDACTED;
    seen.add(value);
    const copy: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      copy[key] = isSensitiveKey(key) ? REDACTED : sanitize(inner, seen);
    }
    return copy;
  }
  return value;
}
