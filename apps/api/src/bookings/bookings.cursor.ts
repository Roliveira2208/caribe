import { ApiProblemException } from "../errors/api-problem.exception.js";

/**
 * Cursor de "Mis reservas" (T-F1-7b). El orden es fijo y estable:
 * `created_at DESC, id DESC`. El cursor codifica la última fila devuelta y un
 * marcador de orden para que un cursor de otro listado responda 422.
 */

export interface BookingsCursor {
  order: "bookings";
  createdAt: string;
  id: string;
}

const ORDER = "bookings";
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function encodeBookingsCursor(cursor: Omit<BookingsCursor, "order">): string {
  return Buffer.from(
    JSON.stringify({ order: ORDER, createdAt: cursor.createdAt, id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

/**
 * Decodifica y valida el cursor. Un cursor ilegible, con forma inesperada o de
 * otro orden responde 422 con `VALIDATION_ERROR`; nunca se ignora.
 */
export function decodeBookingsCursor(raw: string): BookingsCursor {
  const decoded = parseCursor(raw);
  if (decoded === null || decoded.order !== ORDER) {
    throw invalidCursor("cursor inválido");
  }
  if (!ISO_PATTERN.test(decoded.createdAt) || decoded.id.length === 0) {
    throw invalidCursor("cursor inválido");
  }
  const timestamp = new Date(decoded.createdAt);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== decoded.createdAt) {
    throw invalidCursor("cursor inválido");
  }
  return decoded;
}

function parseCursor(raw: string): BookingsCursor | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const order = record["order"];
  const createdAt = record["createdAt"];
  const id = record["id"];
  if (order !== ORDER || typeof createdAt !== "string" || typeof id !== "string") {
    return null;
  }
  return { order: ORDER, createdAt, id };
}

function invalidCursor(message: string): ApiProblemException {
  return new ApiProblemException("VALIDATION_ERROR", "La solicitud no es válida.", [
    { path: "cursor", message },
  ]);
}
