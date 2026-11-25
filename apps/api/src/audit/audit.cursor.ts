import { ApiProblemException } from "../errors/api-problem.exception.js";

/**
 * Cursor del visor de auditoría (T-F2-15). El orden es fijo y estable:
 * `at DESC, id DESC`. El marcador evita que un cursor de otro listado (pagos,
 * eventos de autenticación) se acepte en este endpoint.
 */

export interface AuditCursor {
  order: "audit-logs";
  at: string;
  id: string;
}

const ORDER = "audit-logs";
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function encodeAuditCursor(cursor: Omit<AuditCursor, "order">): string {
  return Buffer.from(
    JSON.stringify({ order: ORDER, at: cursor.at, id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

/** Un cursor ilegible o de otro orden responde 422; nunca se ignora. */
export function decodeAuditCursor(raw: string): AuditCursor {
  const decoded = parseCursor(raw);
  if (decoded === null || decoded.order !== ORDER) {
    throw invalidCursor();
  }
  if (!ISO_PATTERN.test(decoded.at) || decoded.id.length === 0) {
    throw invalidCursor();
  }
  const timestamp = new Date(decoded.at);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== decoded.at) {
    throw invalidCursor();
  }
  return decoded;
}

function parseCursor(raw: string): AuditCursor | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const order = record["order"];
  const at = record["at"];
  const id = record["id"];
  if (order !== ORDER || typeof at !== "string" || typeof id !== "string") return null;
  return { order: ORDER, at, id };
}

function invalidCursor(): ApiProblemException {
  return new ApiProblemException("VALIDATION_ERROR", "La solicitud no es válida.", [
    { path: "cursor", message: "cursor inválido" },
  ]);
}
