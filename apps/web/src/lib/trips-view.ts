import type { Locale } from "@caribe/shared";

/** Estados del enum de reservas de la API (sin depender del paquete de la API). */
export const TRIP_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

export interface TripSummaryView {
  id: string;
  code: string;
  status: TripStatus;
  expiresAt: string;
  totalUsd: string;
  createdAt: string;
}

export interface TripsPageView {
  items: TripSummaryView[];
  nextCursor: string | null;
}

export type TripsErrorKind = "unauthenticated" | "generic";

const AMOUNT_TEXT = /^\d+(?:\.\d{1,2})?$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

/**
 * Valida `GET /api/v1/bookings` antes de pintarlo. Los importes llegan como
 * texto decimal: nunca se convierten a float en la web.
 */
export function parseTripsPage(body: unknown): TripsPageView | null {
  const root = asRecord(body);
  if (!root || !Array.isArray(root.items)) return null;
  if (root.nextCursor !== null && typeof root.nextCursor !== "string") return null;

  const items: TripSummaryView[] = [];
  for (const value of root.items) {
    const row = asRecord(value);
    if (
      !row ||
      typeof row.id !== "string" ||
      row.id.length === 0 ||
      typeof row.code !== "string" ||
      row.code.length === 0 ||
      typeof row.status !== "string" ||
      !TRIP_STATUSES.some((status) => status === row.status) ||
      !isTimestamp(row.expiresAt) ||
      !isTimestamp(row.createdAt) ||
      typeof row.totalUsd !== "string" ||
      !AMOUNT_TEXT.test(row.totalUsd)
    ) {
      return null;
    }
    items.push({
      id: row.id,
      code: row.code,
      status: row.status as TripStatus,
      expiresAt: row.expiresAt,
      totalUsd: row.totalUsd,
      createdAt: row.createdAt,
    });
  }
  return { items, nextCursor: root.nextCursor ?? null };
}

/** El rewrite de primera parte de Next sirve esta ruta sin CORS. */
export function tripsApiUrl(): string {
  return "/api/v1/bookings";
}

export function tripsErrorKind(status: number): TripsErrorKind {
  return status === 401 ? "unauthenticated" : "generic";
}

/** Fecha visible en el listado; UTC para que el test no dependa del huso. */
export function formatTripDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-VE" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso));
}
