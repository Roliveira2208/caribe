import type { CsvLocale } from "../csv/csv.js";

/**
 * Encabezados del CSV de pagos (T-F2-25, spec payments "Exportación CSV").
 * La API los necesita para generar el archivo sin depender del admin, igual
 * que las plantillas de notificaciones tienen su versión es/en.
 */

export interface PaymentCsvLabels {
  id: string;
  bookingId: string;
  method: string;
  status: string;
  amountUsd: string;
  amountVes: string;
  rate: string;
  exchangeRateId: string;
  valueDate: string;
  reportedBy: string;
  reviewedBy: string;
  reviewedAt: string;
  paidAt: string;
  createdAt: string;
}

export const PAYMENT_CSV_LABELS: Record<CsvLocale, PaymentCsvLabels> = {
  es: {
    id: "ID",
    bookingId: "Reserva",
    method: "Método",
    status: "Estado",
    amountUsd: "Monto USD",
    amountVes: "Monto VES",
    rate: "Tasa",
    exchangeRateId: "ID de tasa",
    valueDate: "Fecha valor",
    reportedBy: "Reportado por",
    reviewedBy: "Revisado por",
    reviewedAt: "Revisado el",
    paidAt: "Pagado el",
    createdAt: "Creado el",
  },
  en: {
    id: "ID",
    bookingId: "Booking",
    method: "Method",
    status: "Status",
    amountUsd: "Amount USD",
    amountVes: "Amount VES",
    rate: "Rate",
    exchangeRateId: "Rate ID",
    valueDate: "Value date",
    reportedBy: "Reported by",
    reviewedBy: "Reviewed by",
    reviewedAt: "Reviewed at",
    paidAt: "Paid at",
    createdAt: "Created at",
  },
};

/** Orden fijo de columnas: el mismo para encabezados y filas. */
export const PAYMENT_CSV_COLUMNS: readonly (keyof PaymentCsvLabels)[] = [
  "id",
  "bookingId",
  "method",
  "status",
  "amountUsd",
  "amountVes",
  "rate",
  "exchangeRateId",
  "valueDate",
  "reportedBy",
  "reviewedBy",
  "reviewedAt",
  "paidAt",
  "createdAt",
];
