/**
 * Contrato puro del checkout (change f1-visual-identity). La web valida la
 * forma de lo que envía y de lo que recibe, pero nunca calcula montos ni tasas:
 * el servidor congela precios al crear la reserva.
 */

import { staySelectionFromParams, type ParamSource } from "./detail-view";

export const MAX_TRAVELERS = 9;

export interface CheckoutStay {
  checkIn: string;
  checkOut: string;
  guests: number;
}

export interface CheckoutTraveler {
  fullName: string;
  documentType: string;
  documentNumber: string;
  phone?: string;
  email?: string;
}

/** Cuerpo estricto de `POST /bookings`: solo identificadores y datos de viaje. */
export interface CreateBookingRequestView {
  productId: string;
  checkIn: string;
  checkOut: string;
  quantity: number;
  travelers: CheckoutTraveler[];
}

export interface BookingCreatedView {
  id: string;
  code: string;
  status: "PENDING_PAYMENT";
  expiresAt: string;
  totalUsd: string;
}

export type CheckoutErrorKind =
  | "generic"
  | "not-found"
  | "invalid-dates"
  | "unauthenticated"
  | "availability"
  | "validation";

const DECIMAL_TEXT = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
const EMAIL_TEXT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Lee la estancia de la URL y limita viajeros al máximo del contrato. */
export function checkoutStayFromParams(params: ParamSource): CheckoutStay | null {
  const selection = staySelectionFromParams(params);
  if (!selection.checkIn || !selection.checkOut) return null;
  const rawGuests = params.get("guests");
  const requested = rawGuests && /^\d+$/.test(rawGuests) ? Number(rawGuests) : selection.guests;
  const guests = Math.min(MAX_TRAVELERS, Math.max(1, requested));
  return { checkIn: selection.checkIn, checkOut: selection.checkOut, guests };
}

/** Construye los bloques iniciales a partir del número de personas de la URL. */
export function initialTravelers(count: number): CheckoutTraveler[] {
  const size = Math.min(MAX_TRAVELERS, Math.max(1, Math.trunc(count)));
  return Array.from({ length: size }, () => ({
    fullName: "",
    documentType: "DNI",
    documentNumber: "",
  }));
}

/**
 * Devuelve `null` cuando faltan datos del viajero. El objeto resultado no
 * incluye monto, tasa, moneda, tenant ni usuario: esos los resuelve la API.
 */
export function buildBookingRequest(
  productId: string,
  stay: CheckoutStay | null,
  travelers: CheckoutTraveler[],
): CreateBookingRequestView | null {
  if (!productId || !stay || travelers.length < 1 || travelers.length > MAX_TRAVELERS) {
    return null;
  }

  const clean = travelers.map((traveler): CheckoutTraveler | null => {
    const fullName = trimmed(traveler.fullName);
    const documentType = trimmed(traveler.documentType);
    const documentNumber = trimmed(traveler.documentNumber);
    const phone = trimmed(traveler.phone);
    const email = trimmed(traveler.email);
    if (!fullName || !documentType || !documentNumber) return null;
    if (email && !EMAIL_TEXT.test(email)) return null;

    const result: CheckoutTraveler = { fullName, documentType, documentNumber };
    if (phone) result.phone = phone;
    if (email) result.email = email;
    return result;
  });

  if (clean.some((traveler) => traveler === null)) return null;

  return {
    productId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    quantity: travelers.length,
    travelers: clean as CheckoutTraveler[],
  };
}

/** Acepta solo la respuesta de reserva creada que esta pantalla sabe mostrar. */
export function parseBookingCreated(value: unknown): BookingCreatedView | null {
  const root = asRecord(value);
  if (
    !root ||
    typeof root.id !== "string" ||
    typeof root.code !== "string" ||
    root.status !== "PENDING_PAYMENT" ||
    typeof root.expiresAt !== "string" ||
    typeof root.totalUsd !== "string" ||
    !DECIMAL_TEXT.test(root.totalUsd)
  ) {
    return null;
  }
  return {
    id: root.id,
    code: root.code,
    status: "PENDING_PAYMENT",
    expiresAt: root.expiresAt,
    totalUsd: root.totalUsd,
  };
}

/** Traduce un Problem Details a una acción comprensible, sin mostrar raw JSON. */
export function checkoutErrorKind(status: number, body: unknown): CheckoutErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 404) return "not-found";
  if (status === 409) return "availability";
  const problem = asRecord(body);
  if (problem?.code === "AVAILABILITY_EXHAUSTED") return "availability";
  if (status === 422 || problem?.code === "VALIDATION_ERROR") return "validation";
  return "generic";
}

export function bookingApiUrl(): string {
  return "/api/v1/bookings";
}
