import { PAYMENT_STATUSES, type Locale } from "@caribe/shared";
import { TRIP_STATUSES, type TripStatus } from "./trips-view";

/**
 * Contrato estricto del detalle y de la cancelación (T-F1-14a/T-F1-14b).
 * Importes y tasas llegan como texto decimal: la web nunca los calcula ni los
 * envía en una petición.
 */

const AMOUNT_TEXT = /^\d+(?:\.\d{1,2})?$/;
const RATE_TEXT = /^\d+(?:\.\d{1,4})?$/;
const VALUE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isLocalized(value: unknown): value is { es: string; en: string } {
  const row = asRecord(value);
  return !!row && typeof row.es === "string" && typeof row.en === "string";
}

function isTripStatus(value: unknown): value is TripStatus {
  return typeof value === "string" && TRIP_STATUSES.some((status) => status === value);
}

export interface BookingNightPriceView {
  night: string;
  priceUsd: string;
}

export interface PolicyRuleView {
  hoursBefore: number;
  percentage: number;
}

export interface PolicySnapshotView {
  policyId: string | null;
  name: string | null;
  rules: PolicyRuleView[];
}

export interface RefundEstimateView {
  amountUsd: string;
  amountVes: string;
  rate: string;
  valueDate: string;
  percentage: number;
}

export interface BookingItemView {
  productId: string;
  hotelKey: string;
  roomType: string;
  title: { es: string; en: string };
  checkIn: string;
  checkOut: string;
  quantity: number;
  nightlyPrices: BookingNightPriceView[];
  subtotalUsd: string;
  policySnapshot: PolicySnapshotView;
}

export interface BookingDetailView {
  id: string;
  code: string;
  status: TripStatus;
  expiresAt: string;
  totalUsd: string;
  paymentStatus: string | null;
  refundEstimate: RefundEstimateView | null;
  items: BookingItemView[];
}

export interface RefundView {
  id: string;
  amountUsd: string;
  amountVes: string;
  rate: string;
  valueDate: string;
  paymentStatus: string;
}

export interface CancelResultView {
  id: string;
  code: string;
  status: TripStatus;
  refund: RefundView | null;
}

function parseNightPrice(value: unknown): BookingNightPriceView | null {
  const row = asRecord(value);
  if (
    !row ||
    typeof row.night !== "string" ||
    !VALUE_DATE.test(row.night) ||
    typeof row.priceUsd !== "string" ||
    !AMOUNT_TEXT.test(row.priceUsd)
  ) {
    return null;
  }
  return { night: row.night, priceUsd: row.priceUsd };
}

function parsePolicyRule(value: unknown): PolicyRuleView | undefined {
  const row = asRecord(value);
  if (
    !row ||
    typeof row.hours_before !== "number" ||
    !Number.isInteger(row.hours_before) ||
    row.hours_before < 0 ||
    typeof row.percentage !== "number" ||
    !Number.isInteger(row.percentage) ||
    row.percentage < 0 ||
    row.percentage > 100
  ) {
    return undefined;
  }
  return { hoursBefore: row.hours_before, percentage: row.percentage };
}

/** El snapshot congelado es obligatorio: nunca se lee la política actual. */
function parsePolicySnapshot(value: unknown): PolicySnapshotView | undefined {
  const row = asRecord(value);
  if (
    !row ||
    !(
      row.policyId === null ||
      (typeof row.policyId === "string" && row.policyId.length > 0)
    ) ||
    !(row.name === null || typeof row.name === "string") ||
    !Array.isArray(row.rules)
  ) {
    return undefined;
  }
  const rules = row.rules.map(parsePolicyRule);
  if (rules.some((rule) => rule === undefined)) return undefined;
  return {
    policyId: row.policyId as string | null,
    name: row.name as string | null,
    rules: rules as PolicyRuleView[],
  };
}

/** `undefined` significa contrato inválido; `null`, ausencia legítima de pago. */
function parseRefundEstimate(value: unknown): RefundEstimateView | null | undefined {
  if (value === null) return null;
  const row = asRecord(value);
  if (
    !row ||
    typeof row.amountUsd !== "string" ||
    !AMOUNT_TEXT.test(row.amountUsd) ||
    typeof row.amountVes !== "string" ||
    !AMOUNT_TEXT.test(row.amountVes) ||
    typeof row.rate !== "string" ||
    !RATE_TEXT.test(row.rate) ||
    typeof row.valueDate !== "string" ||
    !VALUE_DATE.test(row.valueDate) ||
    typeof row.percentage !== "number" ||
    !Number.isInteger(row.percentage) ||
    row.percentage < 0 ||
    row.percentage > 100
  ) {
    return undefined;
  }
  return {
    amountUsd: row.amountUsd,
    amountVes: row.amountVes,
    rate: row.rate,
    valueDate: row.valueDate,
    percentage: row.percentage,
  };
}

function parsePaymentStatus(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && PAYMENT_STATUSES.some((status) => status === value)) return value;
  return undefined;
}

function parseItem(value: unknown): BookingItemView | null {
  const row = asRecord(value);
  if (!row || !isLocalized(row.title)) return null;
  if (
    typeof row.productId !== "string" ||
    row.productId.length === 0 ||
    typeof row.hotelKey !== "string" ||
    typeof row.roomType !== "string" ||
    typeof row.checkIn !== "string" ||
    !VALUE_DATE.test(row.checkIn) ||
    typeof row.checkOut !== "string" ||
    !VALUE_DATE.test(row.checkOut) ||
    typeof row.quantity !== "number" ||
    !Number.isInteger(row.quantity) ||
    row.quantity < 1 ||
    typeof row.subtotalUsd !== "string" ||
    !AMOUNT_TEXT.test(row.subtotalUsd) ||
    !Array.isArray(row.nightlyPrices)
  ) {
    return null;
  }
  const nightlyPrices = row.nightlyPrices.map(parseNightPrice);
  if (nightlyPrices.some((night) => night === null) || nightlyPrices.length === 0) return null;
  const policySnapshot = parsePolicySnapshot(row.policySnapshot);
  if (policySnapshot === undefined) return null;
  return {
    productId: row.productId,
    hotelKey: row.hotelKey,
    roomType: row.roomType,
    title: row.title,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    quantity: row.quantity,
    nightlyPrices: nightlyPrices as BookingNightPriceView[],
    subtotalUsd: row.subtotalUsd,
    policySnapshot,
  };
}

/** Devuelve `null` si el detalle no respeta el contrato; nunca rellena huecos. */
export function parseBookingDetail(body: unknown): BookingDetailView | null {
  const row = asRecord(body);
  if (
    !row ||
    typeof row.id !== "string" ||
    row.id.length === 0 ||
    typeof row.code !== "string" ||
    row.code.length === 0 ||
    !isTripStatus(row.status) ||
    typeof row.expiresAt !== "string" ||
    Number.isNaN(Date.parse(row.expiresAt)) ||
    typeof row.totalUsd !== "string" ||
    !AMOUNT_TEXT.test(row.totalUsd) ||
    !Array.isArray(row.items) ||
    row.items.length === 0
  ) {
    return null;
  }
  const items = row.items.map(parseItem);
  if (items.some((item) => item === null)) return null;
  const paymentStatus = parsePaymentStatus(row.paymentStatus);
  const refundEstimate = parseRefundEstimate(row.refundEstimate);
  if (paymentStatus === undefined || refundEstimate === undefined) return null;
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    expiresAt: row.expiresAt,
    totalUsd: row.totalUsd,
    paymentStatus,
    refundEstimate,
    items: items as BookingItemView[],
  };
}

function parseRefund(value: unknown): RefundView | null | undefined {
  if (value === null) return null;
  const row = asRecord(value);
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.amountUsd !== "string" ||
    !AMOUNT_TEXT.test(row.amountUsd) ||
    typeof row.amountVes !== "string" ||
    !AMOUNT_TEXT.test(row.amountVes) ||
    typeof row.rate !== "string" ||
    !RATE_TEXT.test(row.rate) ||
    typeof row.valueDate !== "string" ||
    !VALUE_DATE.test(row.valueDate) ||
    typeof row.paymentStatus !== "string"
  ) {
    return undefined;
  }
  return {
    id: row.id,
    amountUsd: row.amountUsd,
    amountVes: row.amountVes,
    rate: row.rate,
    valueDate: row.valueDate,
    paymentStatus: row.paymentStatus,
  };
}

/** Devuelve `null` si la cancelación no respeta el contrato. */
export function parseCancelResult(body: unknown): CancelResultView | null {
  const row = asRecord(body);
  if (!row || typeof row.id !== "string" || typeof row.code !== "string" || !isTripStatus(row.status)) {
    return null;
  }
  const refund = parseRefund(row.refund);
  if (refund === undefined) return null;
  return { id: row.id, code: row.code, status: row.status, refund };
}

export function bookingDetailApiUrl(bookingId: string): string {
  return `/api/v1/bookings/${encodeURIComponent(bookingId)}`;
}

export function bookingCancelApiUrl(bookingId: string): string {
  return `/api/v1/bookings/${encodeURIComponent(bookingId)}/cancel`;
}

export type CancelErrorKind = "paymentInReview" | "notFound" | "invalidState" | "generic";

/** Traduce un Problem Details de la cancelación a un mensaje de la UI. */
export function cancelErrorKind(status: number, body: unknown): CancelErrorKind {
  const problem = asRecord(body);
  const code = typeof problem?.code === "string" ? problem.code : "";
  if (code === "PAYMENT_IN_REVIEW") return "paymentInReview";
  if (code === "INVALID_STATE_TRANSITION") return "invalidState";
  if (status === 404) return "notFound";
  return "generic";
}

/** Un solo clic nunca cancela: estos son los únicos estados accionables. */
export function canCancelBooking(status: TripStatus): boolean {
  return status === "CONFIRMED" || status === "PENDING_PAYMENT";
}

/** Fechas valor del producto (YYYY-MM-DD) sin inventar una zona horaria. */
export function formatValueDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-VE" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
