/**
 * Primitivas compartidas de los CSV administrativos (reports, payments, audit).
 *
 * Las celdas que empiezan por `=`, `+`, `-` o `@` se prefijan con `'` para que
 * Excel/Sheets las abran como texto: sin esto, un valor controlado por el dato
 * de negocio se ejecutaría como fórmula al abrir el archivo. El escape de
 * comas, comillas y saltos de línea vive aquí para que las tres exportaciones
 * no puedan divergir en una regla de seguridad.
 */

export type CsvLocale = "es" | "en";

/** Sin preferencia explícita, `es` (decisión aprobada antes de T-F2-23). */
export function csvLocale(value: string | undefined): CsvLocale {
  return value === "en" ? "en" : "es";
}

export function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
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
