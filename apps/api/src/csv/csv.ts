/**
 * Primitivas compartidas de los CSV administrativos (reports, payments, audit).
 *
 * Las celdas cuyo primer carácter no blanco ni BOM es `=`, `+`, `-` o `@` se
 * prefijan con `'` para que Excel/Sheets las abran como texto: sin esto, un
 * valor controlado por el dato de negocio se ejecutaría como fórmula al abrir
 * el archivo. Los espacios y el BOM iniciales solo se ignoran para decidir el
 * prefijo; se conservan en el valor escrito. El escape de comas, comillas y
 * saltos de línea vive aquí para que las tres exportaciones no puedan divergir
 * en una regla de seguridad.
 */

export type CsvLocale = "es" | "en";

/** Sin preferencia explícita, `es` (decisión aprobada antes de T-F2-23). */
export function csvLocale(value: string | undefined): CsvLocale {
  return value === "en" ? "en" : "es";
}

export function csvCell(value: string): string {
  const significant = value.replace(/^[\s\uFEFF]+/u, "");
  const safe = /^[=+\-@]/.test(significant) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvRow(values: readonly string[]): string {
  return values.map(csvCell).join(",");
}

/** Una fila por línea, con CRLF y salto final, como el CSV de reportes. */
export function csvDocument(lines: readonly string[]): string {
  return `${lines.join("\r\n")}\r\n`;
}

/** Lo mínimo de la respuesta Express que usan los handlers con CSV. */
export interface CsvResponse {
  type(value: string): CsvResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
}
