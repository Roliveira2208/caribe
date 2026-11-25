/**
 * Contrato de errores y serializacion (spec api-errors, T-F1-0c).
 *
 * La tabla de codigos es la unica fuente de verdad del estado HTTP de cada
 * codigo: la API no elige el estado a mano. Los codigos son estables y no se
 * reutilizan para otra causa (spec api-errors, "Codigos estables").
 */

/**
 * Estados de la tabla de codigos. `METHOD_NOT_ALLOWED` y `CONFLICT` son los
 * dos codigos genericos que no vienen de una regla de negocio concreta: 405
 * porque el caso limite de la spec exige Problem Details tambien para ese
 * estado, y 409 para conflictos que no tienen un codigo de dominio propio
 * (p. ej. un slug duplicado en una ruta administrativa).
 */
export const API_ERROR_STATUS = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ACTIVE_ORGANIZATION_REQUIRED: 403,
  TWO_FACTOR_REQUIRED: 403,
  PRODUCT_INACTIVE: 409,
  AVAILABILITY_UNAVAILABLE: 409,
  AVAILABILITY_EXHAUSTED: 409,
  AVAILABILITY_DUPLICATED: 409,
  HOLD_EXPIRED: 410,
  BOOKING_CANCELLED: 409,
  BOOKING_ALREADY_PAID: 409,
  PAYMENT_IN_REVIEW: 409,
  PAYMENT_ALREADY_REVIEWED: 409,
  INVALID_STATE_TRANSITION: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  INVALID_PATH: 400,
  IDEMPOTENCY_KEY_REUSED: 409,
  IDEMPOTENCY_KEY_IN_PROGRESS: 409,
  DUPLICATE_PAYMENT_REFERENCE: 409,
  REFUND_ALREADY_ISSUED: 409,
  RATE_UNAVAILABLE: 503,
  DOCUMENT_PENDING: 409,
  DOCUMENT_UNAVAILABLE: 503,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const;

/** Codigo de aplicacion estable de la tabla. */
export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

/** Titulos cortos de Problem Details; el mensaje largo va en `detail`. */
export const API_ERROR_TITLES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: "Solicitud inválida",
  UNAUTHENTICATED: "No autenticado",
  FORBIDDEN: "Acceso denegado",
  NOT_FOUND: "Recurso no encontrado",
  ACTIVE_ORGANIZATION_REQUIRED: "Agencia activa requerida",
  TWO_FACTOR_REQUIRED: "Segundo factor requerido",
  PRODUCT_INACTIVE: "Producto no disponible",
  AVAILABILITY_UNAVAILABLE: "Disponibilidad no encontrada",
  AVAILABILITY_EXHAUSTED: "Cupo agotado",
  AVAILABILITY_DUPLICATED: "Disponibilidad duplicada",
  HOLD_EXPIRED: "Reserva vencida",
  BOOKING_CANCELLED: "Reserva cancelada",
  BOOKING_ALREADY_PAID: "Reserva ya pagada",
  PAYMENT_IN_REVIEW: "Pago en revisión",
  PAYMENT_ALREADY_REVIEWED: "Pago ya revisado",
  INVALID_STATE_TRANSITION: "Transición no permitida",
  IDEMPOTENCY_KEY_REQUIRED: "Clave de idempotencia requerida",
  INVALID_PATH: "Ruta inválida",
  IDEMPOTENCY_KEY_REUSED: "Clave de idempotencia reutilizada",
  IDEMPOTENCY_KEY_IN_PROGRESS: "Operación en curso",
  DUPLICATE_PAYMENT_REFERENCE: "Referencia de pago duplicada",
  REFUND_ALREADY_ISSUED: "Reembolso ya emitido",
  RATE_UNAVAILABLE: "Tasa no disponible",
  DOCUMENT_PENDING: "Documento en generación",
  DOCUMENT_UNAVAILABLE: "Documento no disponible",
  PAYLOAD_TOO_LARGE: "Cuerpo demasiado grande",
  RATE_LIMITED: "Demasiadas peticiones",
  METHOD_NOT_ALLOWED: "Método no permitido",
  CONFLICT: "Conflicto",
  INTERNAL_ERROR: "Error interno",
};

/** URI estable del tipo de problema (RFC 9457). No se resuelve en F1. */
export const PROBLEM_TYPE_PREFIX = "https://caribe.app/problems/";

/** `type` de Problem Details para un codigo: estable y sin datos del cliente. */
export function problemType(code: ApiErrorCode): string {
  return `${PROBLEM_TYPE_PREFIX}${code.toLowerCase().replaceAll("_", "-")}`;
}

/** true si el valor es un codigo de la tabla (sin inventar codigos). */
export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && Object.hasOwn(API_ERROR_STATUS, value);
}

/** Un error de validacion: solo la ruta del campo y el mensaje, nunca el valor. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** Cuerpo `application/problem+json` que devuelve la API. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: ApiErrorCode;
  errors?: ValidationIssue[];
  /**
   * Identificador de correlacion del fallo inesperado. Tambien viaja en la
   * cabecera X-Correlation-Id; el detalle interno queda solo en el log.
   */
  correlationId?: string;
}

/**
 * Valor decimal aceptado por los serializadores: cadenas (lo normal: Prisma
 * devuelve DECIMAL como cadena o como Decimal con toString), enteros grandes
 * y objetos con toString. Nunca se hace aritmetica de punto flotante con
 * dinero: el redondeo es sobre los digitos de la cadena.
 */
export type DecimalValue = string | bigint | number | { toString(): string };

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

interface ParsedDecimal {
  negative: boolean;
  integer: string;
  fraction: string;
}

function parseDecimal(value: DecimalValue): ParsedDecimal {
  const raw = (typeof value === "string" ? value : value.toString()).trim();
  const match = DECIMAL_PATTERN.exec(raw);
  if (!match) {
    // Incluye NaN, Infinity y notacion exponencial: no son montos validos.
    throw new RangeError(`Valor decimal inválido: ${raw}`);
  }
  const [, sign = "", integer = "0", fraction = ""] = match;
  return {
    negative: sign === "-",
    integer: integer.replace(/^0+(?=\d)/, ""),
    fraction,
  };
}

/** Suma 1 a una cadena de digitos y devuelve el acarreo final. */
function incrementDigits(digits: string): { digits: string; carry: boolean } {
  const chars = digits.split("");
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const digit = chars[index];
    if (digit !== "9") {
      chars[index] = String(Number(digit) + 1);
      return { digits: chars.join(""), carry: false };
    }
    chars[index] = "0";
  }
  return { digits: chars.join(""), carry: true };
}

/**
 * Redondea (mitad hacia arriba) y fija la escala de un decimal sin pasar por
 * `number`. `formatAmount` y `formatRate` son los unicos usos previstos.
 */
export function formatDecimal(value: DecimalValue, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`Escala decimal inválida: ${scale}`);
  }
  const parsed = parseDecimal(value);
  let integer = parsed.integer;
  let fraction = parsed.fraction.slice(0, scale).padEnd(scale, "0");

  const nextDigit = parsed.fraction.charAt(scale);
  if (nextDigit >= "5" && nextDigit !== "") {
    const rounded = incrementDigits(fraction);
    fraction = rounded.digits;
    if (rounded.carry) {
      const carried = incrementDigits(integer);
      integer = carried.carry ? `1${carried.digits}` : carried.digits;
    }
  }

  const isZero = /^0+$/.test(integer) && /^0*$/.test(fraction);
  const sign = parsed.negative && !isZero ? "-" : "";
  return scale === 0 ? `${sign}${integer}` : `${sign}${integer}.${fraction}`;
}

/** Monto: cadena con dos decimales (spec api-errors, "Serializacion"). */
export function formatAmount(value: DecimalValue): string {
  return formatDecimal(value, 2);
}

/** Tasa: cadena con cuatro decimales. */
export function formatRate(value: DecimalValue): string {
  return formatDecimal(value, 4);
}

const CARACAS_TIME_ZONE = "America/Caracas";
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `value_date` como fecha calendario `YYYY-MM-DD`.
 *
 * Prisma devuelve una columna DATE como `Date` a medianoche UTC: ese valor ya
 * es la fecha calendario y no se convierte de zona (convertirlo en Caracas
 * retrocederia un dia). Una marca de tiempo real si se interpreta en
 * America/Caracas. Las cadenas `YYYY-MM-DD` se devuelven tal cual, validadas.
 */
export function formatValueDate(value: Date | string): string {
  if (typeof value === "string") {
    const dateOnly = DATE_ONLY_PATTERN.exec(value);
    if (dateOnly) {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new RangeError(`Fecha calendario inválida: ${value}`);
      }
      return value;
    }
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Fecha inválida");
  }
  const isUtcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  if (isUtcMidnight) {
    return date.toISOString().slice(0, 10);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CARACAS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Marca de tiempo: ISO 8601 en UTC, siempre terminada en `Z`. */
export function formatTimestamp(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Marca de tiempo inválida");
  }
  return date.toISOString();
}
