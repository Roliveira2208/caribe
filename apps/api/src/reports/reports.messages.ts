/**
 * Encabezados del CSV del reporte (T-F2-23, delta reports "Exportación CSV").
 *
 * Son datos con una versión por idioma, como las plantillas de notificaciones:
 * la UI toma sus textos de `messages/es.json` y `messages/en.json`, y la API
 * necesita los suyos para generar el archivo sin depender del admin.
 */

export type ReportLocale = "es" | "en";

export interface ReportCsvLabels {
  method: string;
  status: string;
  count: string;
  amountUsd: string;
  amountVes: string;
  total: string;
}

export const REPORT_CSV_LABELS: Record<ReportLocale, ReportCsvLabels> = {
  es: {
    method: "Método",
    status: "Estado",
    count: "Recuento",
    amountUsd: "Suma USD",
    amountVes: "Suma VES",
    total: "TOTAL",
  },
  en: {
    method: "Method",
    status: "Status",
    count: "Count",
    amountUsd: "Sum USD",
    amountVes: "Sum VES",
    total: "TOTAL",
  },
};

/** Sin preferencia explícita, `es` (decisión aprobada antes de T-F2-23). */
export function reportLocale(value: string | undefined): ReportLocale {
  return value === "en" ? "en" : "es";
}
