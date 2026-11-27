import { csvDocument, csvRow } from "../csv/csv.js";
import { REPORT_CSV_LABELS, type ReportLocale } from "./reports.messages.js";
import type { SalesReport } from "./reports.schemas.js";

/**
 * Serialización del CSV del reporte (T-F2-23). Usa la MISMA respuesta JSON que
 * ya aplicó filtros, validaciones y alcance, así que aquí no se vuelve a filtrar
 * ni a calcular nada. El escape de celdas (comas, comillas, saltos y prefijo
 * contra fórmulas) es la primitiva compartida `src/csv/csv.ts`. No hay secretos
 * ni datos de tarjeta en el contrato de la fila.
 */
export function reportCsv(report: SalesReport, locale: ReportLocale): string {
  const labels = REPORT_CSV_LABELS[locale];
  const lines = [
    csvRow([labels.method, labels.status, labels.count, labels.amountUsd, labels.amountVes]),
  ];

  for (const row of report.breakdown) {
    lines.push(
      csvRow([row.method, row.status, String(row.count), row.amountUsd, row.amountVes]),
    );
  }
  if (report.breakdown.length > 0) {
    lines.push(
      csvRow([
        labels.total,
        "",
        String(report.totals.count),
        report.totals.amountUsd,
        report.totals.amountVes,
      ]),
    );
  }
  return csvDocument(lines);
}
