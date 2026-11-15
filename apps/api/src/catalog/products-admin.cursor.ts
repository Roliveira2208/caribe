import { ApiProblemException } from "../errors/api-problem.exception.js";

/**
 * Cursor del listado de panel (T-F1-4). El orden es fijo y estable:
 * `updated_at DESC, id DESC`. El cursor codifica la última fila devuelta y el
 * marcador de orden para que un cursor de otro listado responda 422.
 */

export interface ProductsAdminCursor {
  order: "panel";
  updatedAt: string;
  id: string;
}

const ORDER = "panel";
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function encodeProductsAdminCursor(cursor: Omit<ProductsAdminCursor, "order">): string {
  return Buffer.from(
    JSON.stringify({ order: ORDER, updatedAt: cursor.updatedAt, id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

/**
 * Decodifica y valida el cursor. Un cursor ilegible, con forma inesperada o
 * de otro orden responde 422 con `VALIDATION_ERROR`; nunca se ignora.
 */
export function decodeProductsAdminCursor(raw: string): ProductsAdminCursor {
  const decoded = parseCursor(raw);
  if (decoded === null || decoded.order !== ORDER) {
    throw invalidCursor("cursor inválido");
  }
  if (!ISO_PATTERN.test(decoded.updatedAt) || decoded.id.length === 0) {
    throw invalidCursor("cursor inválido");
  }
  const timestamp = new Date(decoded.updatedAt);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== decoded.updatedAt) {
    throw invalidCursor("cursor inválido");
  }
  return decoded;
}

function parseCursor(raw: string): ProductsAdminCursor | null {
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
  const updatedAt = record["updatedAt"];
  const id = record["id"];
  if (order !== ORDER || typeof updatedAt !== "string" || typeof id !== "string") {
    return null;
  }
  return { order: ORDER, updatedAt, id };
}

function invalidCursor(message: string): ApiProblemException {
  return new ApiProblemException("VALIDATION_ERROR", "La solicitud no es válida.", [
    { path: "cursor", message },
  ]);
}
