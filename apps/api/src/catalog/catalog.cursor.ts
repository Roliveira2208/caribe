import { ApiProblemException } from "../errors/api-problem.exception.js";

/**
 * Cursor de la búsqueda de catálogo (T-F1-3, spec catalog "Búsqueda y
 * filtros"): opaco para el cliente, codifica la última fila devuelta
 * `(precio, id)` y el orden con el que se generó.
 *
 * El orden depende de si la búsqueda lleva fechas: sin fechas se ordena por
 * `base_price_usd`; con fechas, por el total de la estancia. Un cursor
 * generado para un orden no sirve para otro: usarlo responde 422.
 */

export interface CatalogCursor {
  /** `base` o `stay:<checkIn>:<checkOut>`. */
  order: string;
  /** Precio de orden como decimal con dos decimales. */
  price: string;
  id: string;
}

const PRICE_PATTERN = /^\d+\.\d{2}$/;

/** Clave de orden de la búsqueda actual. */
export function catalogOrderKey(range?: { checkIn: string; checkOut: string }): string {
  return range ? `stay:${range.checkIn}:${range.checkOut}` : "base";
}

export function encodeCatalogCursor(cursor: CatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Decodifica y valida el cursor. Un cursor ilegible, con forma inesperada, con
 * un precio que no es decimal o generado para otro orden responde 422 con
 * `VALIDATION_ERROR` (nunca se ignora).
 */
export function decodeCatalogCursor(raw: string, expectedOrder: string): CatalogCursor {
  const decoded = parseCursor(raw);
  if (decoded === null) {
    throw invalidCursor("cursor inválido");
  }
  if (decoded.order !== expectedOrder) {
    throw invalidCursor("cursor no corresponde al orden solicitado");
  }
  if (!PRICE_PATTERN.test(decoded.price) || decoded.id.length === 0) {
    throw invalidCursor("cursor inválido");
  }
  return decoded;
}

function parseCursor(raw: string): CatalogCursor | null {
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
  const price = record["price"];
  const id = record["id"];
  if (typeof order !== "string" || typeof price !== "string" || typeof id !== "string") {
    return null;
  }
  return { order, price, id };
}

function invalidCursor(message: string): ApiProblemException {
  return new ApiProblemException("VALIDATION_ERROR", "La solicitud no es válida.", [
    { path: "cursor", message },
  ]);
}
