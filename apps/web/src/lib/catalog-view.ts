import type { Locale } from "@caribe/shared";

/**
 * Helpers puros de presentación del catálogo (change
 * public-rate-and-price-filters). No consultan la API ni el DOM: la página
 * cliente construye la query con `buildCatalogQuery` y formatea lo que ya vino
 * del servidor, donde se calcularon los importes y el equivalente en VES.
 */

/** Filtros enviados por el buscador; todos llegan como texto desde la URL. */
export interface CatalogSearchInput {
  q?: string;
  destinationId?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: string | number;
  type?: string;
  minPriceUsd?: string;
  maxPriceUsd?: string;
  cursor?: string;
  limit?: number;
}

const QUERY_FIELDS = [
  "destinationId",
  "checkIn",
  "checkOut",
  "guests",
  "type",
  "q",
  "minPriceUsd",
  "maxPriceUsd",
  "cursor",
  "limit",
] as const satisfies ReadonlyArray<keyof CatalogSearchInput>;

/**
 * Construye la query de `GET /products` con un orden estable. Los campos vacíos
 * se omiten; los valores no válidos se envían tal cual para que la API responda
 * 422 con el campo responsable, en vez de esconder un error del formulario.
 */
export function buildCatalogQuery(input: CatalogSearchInput): string {
  const params = new URLSearchParams();
  for (const field of QUERY_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null || value === "") continue;
    params.set(field, String(value));
  }
  return params.toString();
}

/** Texto i18n de la API: prioriza el locale, cae a es y después a en. */
export type LocalizedTextView = Partial<Record<Locale, string>> | null | undefined;

export function localizedText(value: LocalizedTextView, locale: Locale): string {
  return value?.[locale]?.trim() || value?.es?.trim() || value?.en?.trim() || "";
}

const INTL_LOCALE: Record<Locale, string> = { es: "es-VE", en: "en-US" };
const DECIMAL_TEXT = /^-?\d+(?:\.\d+)?$/;

/**
 * `Intl.NumberFormat` acepta decimales en texto sin pasar por `number`, lo que
 * evita introducir coma flotante en importes que vienen como texto desde la API.
 * El tipo de TS exige el cast después de validar el formato.
 */
function numericLiteral(value: string): Intl.StringNumericLiteral {
  if (!DECIMAL_TEXT.test(value)) throw new RangeError("Importe decimal inválido");
  return value as Intl.StringNumericLiteral;
}

/** Importe USD ya calculado por la API; solo se formatea para mostrar. */
export function formatUsd(value: string, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "currency",
    currency: "USD",
  }).format(numericLiteral(value));
}

/** Equivalente VES informativo ya calculado con la tasa global. */
export function formatVes(value: string, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "currency",
    currency: "VES",
  }).format(numericLiteral(value));
}

/** Tasa BCV para el badge del header: dos decimales, sin símbolo de moneda. */
export function formatRate(value: string, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericLiteral(value));
}

/**
 * Fecha valor `YYYY-MM-DD` en formato local. Se interpreta en UTC para que un
 * cambio de zona del navegador no retroceda el día.
 */
export function formatValueDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
