import { csvDocument, csvRow, type CsvLocale } from "../csv/csv.js";
import { PAYMENT_CSV_COLUMNS, PAYMENT_CSV_LABELS } from "./payments.messages.js";
import type { PaymentPage } from "./payments.schemas.js";

/**
 * Serialización del CSV de pagos (T-F2-25). Parte de la MISMA `PaymentPage` que
 * ya aplicó filtros, cursor y alcance por tenant en `listAdmin`, así que aquí
 * no se vuelve a filtrar ni a calcular: montos, tasa y fechas salen como las
 * cadenas del servidor. Se omiten `reference` y `rejectionReason` (texto libre)
 * además de `tenantId`: ningún dato de tarjeta ni secreto entra en el archivo.
 */
export function paymentsCsv(page: PaymentPage, locale: CsvLocale): string {
  const labels = PAYMENT_CSV_LABELS[locale];
  const lines = [csvRow(PAYMENT_CSV_COLUMNS.map((column) => labels[column]))];

  for (const payment of page.items) {
    lines.push(csvRow(PAYMENT_CSV_COLUMNS.map((column) => payment[column] ?? "")));
  }
  return csvDocument(lines);
}
