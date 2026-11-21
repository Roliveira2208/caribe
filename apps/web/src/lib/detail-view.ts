/**
 * Lectura y validación de las respuestas públicas del detalle (change
 * f1-visual-identity). La web solo formatea lo que ya calculó la API: los
 * importes llegan como texto decimal y nunca se recalculan aquí.
 */

/** Interfaz mínima compartida por `URLSearchParams` y `ReadonlyURLSearchParams`. */
export interface ParamSource {
  get(name: string): string | null;
}

export interface LocalizedTextView {
  es: string;
  en: string;
}

export interface CancellationRuleView {
  hoursBefore: number;
  percentage: number;
}

export interface CancellationPolicyView {
  name: string;
  rules: CancellationRuleView[];
}

/** Réplica pública de `GET /products/:id`, sin totales de estancia. */
export interface CatalogProductDetailView {
  id: string;
  hotelKey: string;
  roomType: string;
  type: "hotel";
  title: LocalizedTextView;
  description: LocalizedTextView;
  destination: { id: string; name: LocalizedTextView; country: string; code: string };
  attributes: { stars: number; maxGuests: number; amenities: string[]; images: string[] };
  basePriceUsd: string;
  basePriceVes: string | null;
  cancellationPolicy: CancellationPolicyView | null;
}

/** Réplica pública de `GET /products/:id/availability`: nunca `capacity` ni `reserved`. */
export interface AvailabilityNightView {
  night: string;
  remaining: number;
  priceUsd: string;
  priceVes: string | null;
}

export interface CatalogAvailabilityView {
  productId: string;
  from: string;
  to: string;
  nights: AvailabilityNightView[];
}

/** Rango opcional que llega desde la búsqueda o se elige en el detalle. */
export interface StaySelection {
  checkIn?: string;
  checkOut?: string;
  guests: number;
}

const DECIMAL_TEXT = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

/** Valida la forma del detalle antes de pasarlo a `Intl.NumberFormat`. */
export function parseProductDetailView(value: unknown): CatalogProductDetailView | null {
  const root = asRecord(value);
  if (!root) return null;
  const destination = asRecord(root.destination);
  const attributes = asRecord(root.attributes);
  if (
    typeof root.id !== "string" ||
    typeof root.hotelKey !== "string" ||
    typeof root.roomType !== "string" ||
    root.type !== "hotel" ||
    !isLocalized(root.title) ||
    !isLocalized(root.description) ||
    !destination ||
    typeof destination.id !== "string" ||
    !isLocalized(destination.name) ||
    typeof destination.country !== "string" ||
    typeof destination.code !== "string" ||
    !attributes ||
    !Number.isInteger(attributes.stars) ||
    !Number.isInteger(attributes.maxGuests) ||
    !Array.isArray(attributes.amenities) ||
    !attributes.amenities.every((item) => typeof item === "string") ||
    !Array.isArray(attributes.images) ||
    !attributes.images.every((item) => typeof item === "string") ||
    !isDecimal(root.basePriceUsd) ||
    !isNullableDecimal(root.basePriceVes)
  ) {
    return null;
  }

  let cancellationPolicy: CancellationPolicyView | null = null;
  // Un despliegue anterior puede omitir la clave; eso equivale a "sin política".
  if (root.cancellationPolicy !== undefined && root.cancellationPolicy !== null) {
    const policy = asRecord(root.cancellationPolicy);
    if (
      !policy ||
      typeof policy.name !== "string" ||
      !Array.isArray(policy.rules) ||
      !policy.rules.every((raw) => {
        const rule = asRecord(raw);
        return (
          rule !== null &&
          Number.isInteger(rule.hoursBefore) &&
          (rule.hoursBefore as number) >= 0 &&
          Number.isInteger(rule.percentage) &&
          (rule.percentage as number) >= 0 &&
          (rule.percentage as number) <= 100
        );
      })
    ) {
      return null;
    }
    cancellationPolicy = {
      name: policy.name,
      rules: (policy.rules as Array<Record<string, unknown>>).map((rule) => ({
        hoursBefore: rule.hoursBefore as number,
        percentage: rule.percentage as number,
      })),
    };
  }

  // Se reconstruye el objeto para no dejar pasar campos internos del payload.
  return {
    id: root.id as string,
    hotelKey: root.hotelKey as string,
    roomType: root.roomType as string,
    type: "hotel",
    title: root.title as LocalizedTextView,
    description: root.description as LocalizedTextView,
    destination: {
      id: destination.id as string,
      name: destination.name as LocalizedTextView,
      country: destination.country as string,
      code: destination.code as string,
    },
    attributes: {
      stars: attributes.stars as number,
      maxGuests: attributes.maxGuests as number,
      amenities: attributes.amenities as string[],
      images: attributes.images as string[],
    },
    basePriceUsd: root.basePriceUsd,
    basePriceVes: root.basePriceVes as string | null,
    cancellationPolicy,
  };
}

/** Valida la disponibilidad sin exponer cupo exacto ni reservas. */
export function parseAvailabilityView(value: unknown): CatalogAvailabilityView | null {
  const root = asRecord(value);
  if (
    !root ||
    typeof root.productId !== "string" ||
    !isIsoDate(root.from) ||
    !isIsoDate(root.to) ||
    !Array.isArray(root.nights) ||
    !root.nights.every((raw) => {
      const night = asRecord(raw);
      return (
        night !== null &&
        isIsoDate(night.night) &&
        Number.isInteger(night.remaining) &&
        (night.remaining as number) >= 0 &&
        isDecimal(night.priceUsd) &&
        isNullableDecimal(night.priceVes)
      );
    })
  ) {
    return null;
  }
  return value as CatalogAvailabilityView;
}

/** Sanea el rango de la URL; un valor manipulado se ignora, no se envía. */
export function staySelectionFromParams(params: ParamSource): StaySelection {
  const rawIn = params.get("checkIn");
  const rawOut = params.get("checkOut");
  const rawGuests = params.get("guests");
  const guests =
    rawGuests && /^\d+$/.test(rawGuests) && Number(rawGuests) >= 1 && Number(rawGuests) <= 20
      ? Number(rawGuests)
      : 1;

  if (!isIsoDate(rawIn) || !isIsoDate(rawOut) || rawOut <= rawIn) return { guests };
  return { checkIn: rawIn, checkOut: rawOut, guests };
}

/** Primera noche con cupo, para proponer una estancia de una noche. */
export function firstBookableNight(availability: CatalogAvailabilityView | null): string | null {
  return availability?.nights.find((night) => night.remaining > 0)?.night ?? null;
}

/** Día siguiente a una noche `YYYY-MM-DD`, interpretado en UTC. */
export function nextDay(night: string): string {
  const date = new Date(`${night}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function detailApiUrl(productId: string): string {
  return `/api/v1/products/${encodeURIComponent(productId)}`;
}

export function availabilityApiUrl(
  productId: string,
  selection: StaySelection = { guests: 1 },
): string {
  const base = `/api/v1/products/${encodeURIComponent(productId)}/availability`;
  if (!selection.checkIn || !selection.checkOut) return base;
  const params = new URLSearchParams({ from: selection.checkIn, to: selection.checkOut });
  return `${base}?${params.toString()}`;
}
