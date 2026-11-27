import type { CsvLocale } from "../csv/csv.js";

/**
 * Encabezados y estados del CSV de auditoría (T-F2-25, delta audit
 * "Exportación CSV de auditoría"). La API necesita sus propios textos es/en,
 * igual que el admin toma los suyos de `messages/es.json` y `messages/en.json`.
 */

export interface AuditCsvLabels {
  id: string;
  at: string;
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  beforeStatus: string;
  afterStatus: string;
  ip: string;
  /** Valor para actor/IP ausentes o payloads sin estado de negocio. */
  empty: string;
  /** Código de estado no reconocido: nunca se vuelca texto arbitrario. */
  unknownStatus: string;
}

export const AUDIT_CSV_LABELS: Record<CsvLocale, AuditCsvLabels> = {
  es: {
    id: "ID",
    at: "Fecha",
    actorId: "Actor",
    action: "Acción",
    entity: "Entidad",
    entityId: "ID de entidad",
    beforeStatus: "Estado anterior",
    afterStatus: "Estado nuevo",
    ip: "IP",
    empty: "—",
    unknownStatus: "Otro",
  },
  en: {
    id: "ID",
    at: "Date",
    actorId: "Actor",
    action: "Action",
    entity: "Entity",
    entityId: "Entity ID",
    beforeStatus: "Previous status",
    afterStatus: "New status",
    ip: "IP",
    empty: "—",
    unknownStatus: "Other",
  },
};

/** Orden fijo de columnas: el mismo para encabezados y filas. */
export const AUDIT_CSV_COLUMNS: readonly (keyof AuditCsvLabels)[] = [
  "id",
  "at",
  "actorId",
  "action",
  "entity",
  "entityId",
  "beforeStatus",
  "afterStatus",
  "ip",
];

/**
 * Estados de negocio que aparecen en `before`/`after` de `audit_logs`. Solo se
 * exportan códigos conocidos y traducidos: un valor inesperado se rotula como
 * "Otro"/"Other" para no arrastrar mensajes internos al archivo.
 */
export const AUDIT_STATUS_LABELS: Record<CsvLocale, Record<string, string>> = {
  es: {
    PENDING: "Pendiente",
    IN_REVIEW: "En revisión",
    APPROVED: "Aprobado",
    REJECTED: "Rechazado",
    REFUNDED: "Reembolsado",
    PARTIALLY_REFUNDED: "Reembolsado parcialmente",
    PENDING_PAYMENT: "Pago pendiente",
    CONFIRMED: "Confirmada",
    CANCELLED: "Cancelada",
    EXPIRED: "Vencida",
    DRAFT: "Borrador",
    PUBLISHED: "Publicado",
    ARCHIVED: "Archivado",
    READY: "Listo",
    FAILED: "Fallido",
    COMPLETED: "Completado",
    SENT: "Enviado",
  },
  en: {
    PENDING: "Pending",
    IN_REVIEW: "Under review",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    REFUNDED: "Refunded",
    PARTIALLY_REFUNDED: "Partially refunded",
    PENDING_PAYMENT: "Pending payment",
    CONFIRMED: "Confirmed",
    CANCELLED: "Cancelled",
    EXPIRED: "Expired",
    DRAFT: "Draft",
    PUBLISHED: "Published",
    ARCHIVED: "Archived",
    READY: "Ready",
    FAILED: "Failed",
    COMPLETED: "Completed",
    SENT: "Sent",
  },
};
