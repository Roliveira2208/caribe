import { isAbsolute, relative, resolve, sep } from "node:path";
import { ApiProblemException } from "../errors/api-problem.exception.js";

/** Detalle estable del Problem Details de 400 `INVALID_PATH`. */
export const INVALID_PATH_DETAIL = "Ruta de documento inválida.";

function invalidPath(): never {
  throw new ApiProblemException("INVALID_PATH", INVALID_PATH_DETAIL);
}

/**
 * Valida la ruta relativa guardada en `documents.file_url` (T-F1-11a, spec
 * documents "Ruta manipulada"). La generan los servidores con un UUID, pero se
 * vuelve a comprobar antes de leer: un valor manipulado en la BD o en un
 * parámetro nunca debe llegar al disco.
 *
 * Se rechazan esquemas de URL (`http:`, `file:`, `C:`), rutas absolutas, barras
 * invertidas, segmentos vacíos y los segmentos `.` y `..`. No se normaliza: una
 * ruta generada por el servidor no necesita normalización y normalizar podría
 * convertir una entrada maliciosa en una válida.
 */
export function validateDocumentFileUrl(fileUrl: string): void {
  if (typeof fileUrl !== "string" || fileUrl.length === 0 || fileUrl.includes("\0")) {
    invalidPath();
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(fileUrl)) invalidPath();
  if (fileUrl.startsWith("/") || fileUrl.includes("\\")) invalidPath();

  for (const segment of fileUrl.split("/")) {
    if (segment === "" || segment === "." || segment === "..") invalidPath();
  }
}

/**
 * Resuelve `fileUrl` dentro de `dir` y verifica que el resultado siga ahí, como
 * defensa en profundidad aunque cambie la validación anterior.
 */
export function resolveDocumentPath(dir: string, fileUrl: string): string {
  validateDocumentFileUrl(fileUrl);
  const root = resolve(dir);
  const target = resolve(root, fileUrl);
  const inside = relative(root, target);
  if (!inside || inside.startsWith("..") || isAbsolute(inside) || inside.startsWith(sep)) {
    invalidPath();
  }
  return target;
}
