import { REPORT_CSV_LABELS, type ReportLocale } from "./reports.messages.js";
import type { SalesReport } from "./reports.schemas.js";

/**
 * Serialización del CSV del reporte (T-F2-23). Usa la MISMA respuesta JSON que
 * ya aplicó filtros, validaciones y alcance, así que aquí no se vuelve a filtrar
 * ni a calcular nada. Solo se formatean las celdas y se escapan las comas, las
 * comillas y los saltos de línea. No hay secretos ni datos de tarjeta en el
 * contrato de la fila.
 */
function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function reportCsv(report: SalesReport, locale: ReportLocale): string {
  const labels = REPORT_CSV_LABELS[locale];
  const lines = [
    [
      labels.method,
      labels.status,
      labels.count,
      labels.amountUsd,
      labels.amountVes,
    ]
      .map(cell)
      .join(","),
  ];

  for (const row of report.breakdown) {
    lines.push(
      [row.method, row.status, String(row.count), row.amountUsd, row.amountVes]
        .map(cell)
        .join(","),
    );
  }
  if (report.breakdown.length > 0) {
    lines.push(
      [
        labels.total,
        "",
        String(report.totals.count),
        report.totals.amountUsd,
        report.totals.amountVes,
      ]
        .map(cell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
