import { buildCatalogQuery, type CatalogSearchInput } from "./catalog-view";

/**
 * Lectura y validación de la URL de `/[locale]/search` (change
 * public-rate-and-price-filters). La web no inventa valores: los parámetros que
 * no respetan el contrato de `GET /products` se descartan y se anuncian, en vez
 * de enviarse para provocar un 422.
 */

/** Interfaz mínima compartida por `URLSearchParams` y `ReadonlyURLSearchParams`. */
export interface ParamSource {
  get(name: string): string | null;
}

/** Tipos que el buscador sabe preseleccionar; solo `hotel` tiene catálogo en F1. */
export const SEARCH_TYPES = ["hotel", "tour", "package", "flight"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export interface ParsedSearchInput {
  /** Filtros seguros para `GET /products` (siempre `type=hotel`). */
  input: CatalogSearchInput;
  /** Tipo elegido en el formulario, incluidas las categorías próximamente. */
  selectedType: SearchType;
  /** true cuando la categoría elegida todavía no tiene datos. */
  comingSoon: boolean;
  invalidPrice: boolean;
}

export interface LocalizedTextView {
  es: string;
  en: string;
}

export interface CatalogDestinationView {
  id: string;
  name: LocalizedTextView;
  country: string;
  code: string;
}

/** Réplica pública de la oferta que devuelve `GET /products`. */
export interface CatalogOfferView {
  id: string;
  hotelKey: string;
  roomType: string;
  type: "hotel";
  title: LocalizedTextView;
  description: LocalizedTextView;
  destination: CatalogDestinationView;
  attributes: { stars: number; maxGuests: number; amenities: string[]; images: string[] };
  basePriceUsd: string;
  basePriceVes: string | null;
  totalUsd: string | null;
  totalVes: string | null;
}

export interface CatalogPageView {
  items: CatalogOfferView[];
  nextCursor: string | null;
}

const DECIMAL_TEXT = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
const GUESTS_TEXT = /^\d+$/;

function text(params: ParamSource, name: string): string | undefined {
  const value = params.get(name)?.trim();
  return value ? value : undefined;
}

function priceCents(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function validPrice(value: string | undefined): boolean {
  return value === undefined || (DECIMAL_TEXT.test(value) && priceCents(value) > 0n);
}

/**
 * Construye la query de la API desde la URL. `input.type` siempre es `hotel`
 * porque el esquema de la API solo acepta ese valor; `selectedType` conserva la
 * categoría elegida en el formulario para preseleccionarla sin provocar un 422.
 */
export function catalogInputFromParams(params: ParamSource): ParsedSearchInput {
  const guests = text(params, "guests");
  const validGuests =
    guests !== undefined && GUESTS_TEXT.test(guests) && Number(guests) >= 1 && Number(guests) <= 20;

  const input: CatalogSearchInput = { type: "hotel" };
  const requestedType = text(params, "type");
  const selectedType: SearchType = SEARCH_TYPES.find((type) => type === requestedType) ?? "hotel";
  const comingSoon = selectedType !== "hotel";
  const q = text(params, "q");
  const destinationId = text(params, "destinationId");
  const checkIn = text(params, "checkIn");
  const checkOut = text(params, "checkOut");
  const cursor = text(params, "cursor");
  if (q) input.q = q.slice(0, 100);
  if (destinationId) input.destinationId = destinationId;
  if (checkIn) input.checkIn = checkIn;
  if (checkOut) input.checkOut = checkOut;
  if (validGuests && guests) input.guests = guests;
  if (cursor) input.cursor = cursor;

  const min = text(params, "minPriceUsd");
  const max = text(params, "maxPriceUsd");
  const provided = min !== undefined || max !== undefined;
  const inverted =
    min !== undefined &&
    max !== undefined &&
    DECIMAL_TEXT.test(min) &&
    DECIMAL_TEXT.test(max) &&
    priceCents(min) > priceCents(max);
  const invalidPrice =
    provided && (!validPrice(min) || !validPrice(max) || inverted);

  if (!invalidPrice) {
    if (min !== undefined) input.minPriceUsd = min;
    if (max !== undefined) input.maxPriceUsd = max;
  }

  return { input, selectedType, comingSoon, invalidPrice };
}

/** Construye la URL de la API para una búsqueda concreta. */
export function searchApiUrl(input: CatalogSearchInput, limit = 20): string {
  const query = buildCatalogQuery({ ...input, limit });
  return query ? `/api/v1/products?${query}` : "/api/v1/products";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_TEXT.test(value);
}

function isNullableDecimal(value: unknown): boolean {
  return value === null || isDecimal(value);
}

function isLocalized(value: unknown): value is LocalizedTextView {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.es === "string" &&
    typeof record.en === "string" &&
    (record.es.length > 0 || record.en.length > 0)
  );
}

/** Valida la forma del cuerpo antes de formatearlo con `Intl`. */
export function parseCatalogPageView(value: unknown): CatalogPageView | null {
  const root = asRecord(value);
  if (!root || !Array.isArray(root.items)) return null;
  if (root.nextCursor !== null && typeof root.nextCursor !== "string") return null;

  for (const raw of root.items) {
    const item = asRecord(raw);
    if (!item) return null;
    const destination = asRecord(item.destination);
    if (
      typeof item.id !== "string" ||
      typeof item.hotelKey !== "string" ||
      typeof item.roomType !== "string" ||
      item.type !== "hotel" ||
      !isLocalized(item.title) ||
      !isLocalized(item.description) ||
      !destination ||
      typeof destination.id !== "string" ||
      !isLocalized(destination.name) ||
      typeof destination.country !== "string" ||
      typeof destination.code !== "string" ||
      !isDecimal(item.basePriceUsd) ||
      !isNullableDecimal(item.basePriceVes) ||
      !isNullableDecimal(item.totalUsd) ||
      !isNullableDecimal(item.totalVes)
    ) {
      return null;
    }
  }
  return value as CatalogPageView;
}

/** Destinos únicos del catálogo, en el orden en que aparecen. */
export function extractDestinations(items: CatalogOfferView[]): CatalogDestinationView[] {
  const seen = new Set<string>();
  const destinations: CatalogDestinationView[] = [];
  for (const item of items) {
    const destination = item.destination;
    if (seen.has(destination.id)) continue;
    seen.add(destination.id);
    destinations.push(destination);
  }
  return destinations;
}
