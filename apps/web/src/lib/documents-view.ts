/**
 * Contrato puro del listado de documentos (T-F1-13e). La web no construye rutas
 * de descarga: solo acepta la que devuelve la API para documentos `READY`. Así
 * nunca aparece un enlace a un PDF que aún no existe.
 */

export type BookingDocumentType = "VOUCHER" | "RECEIPT" | "REFUND_NOTE";
export type BookingDocumentStatus = "PENDING" | "READY" | "FAILED";

export interface BookingDocumentView {
  id: string;
  type: BookingDocumentType;
  number: number;
  status: BookingDocumentStatus;
  issuedAt: string | null;
  downloadPath: string | null;
}

const DOCUMENT_TYPES: readonly BookingDocumentType[] = ["VOUCHER", "RECEIPT", "REFUND_NOTE"];
const DOCUMENT_STATUSES: readonly BookingDocumentStatus[] = ["PENDING", "READY", "FAILED"];
const DOWNLOAD_PATH = /^\/api\/v1\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/download$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseDocument(value: unknown): BookingDocumentView | null {
  const row = asRecord(value);
  if (!row) return null;
  const { id, type, number, status, issuedAt, downloadPath } = row;
  if (typeof id !== "string" || !DOCUMENT_TYPES.includes(type as BookingDocumentType)) return null;
  if (!DOCUMENT_STATUSES.includes(status as BookingDocumentStatus)) return null;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1) return null;
  if (issuedAt !== null && (typeof issuedAt !== "string" || !Number.isFinite(Date.parse(issuedAt)))) {
    return null;
  }
  if (
    downloadPath !== null &&
    (typeof downloadPath !== "string" || !DOWNLOAD_PATH.test(downloadPath))
  ) {
    return null;
  }
  if (status === "READY" && typeof downloadPath !== "string") return null;
  if (status !== "READY" && downloadPath !== null) return null;
  return {
    id,
    type: type as BookingDocumentType,
    number,
    status: status as BookingDocumentStatus,
    issuedAt: issuedAt as string | null,
    downloadPath: downloadPath as string | null,
  };
}

/** Devuelve `null` si la respuesta no respeta el contrato; nunca estima rutas. */
export function parseBookingDocuments(body: unknown): BookingDocumentView[] | null {
  const root = asRecord(body);
  if (!root || !Array.isArray(root.items)) return null;
  const items = root.items.map(parseDocument);
  return items.every((item) => item !== null) ? (items as BookingDocumentView[]) : null;
}

export function documentsApiUrl(bookingId: string): string {
  return `/api/v1/bookings/${encodeURIComponent(bookingId)}/documents`;
}
