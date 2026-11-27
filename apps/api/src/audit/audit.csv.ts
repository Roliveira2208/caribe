import { csvDocument, csvRow, type CsvLocale } from "../csv/csv.js";
import {
  AUDIT_CSV_COLUMNS,
  AUDIT_CSV_LABELS,
  AUDIT_STATUS_LABELS,
} from "./audit.messages.js";
import type { AuditLogPage } from "./audit.schemas.js";

/**
 * Serialización del CSV de auditoría (T-F2-25). Serializa la MISMA página que
 * ya resolvió filtros, cursor, rol y tenant en `AuditController.list`. Se
 * exportan solo columnas permitidas: ni `tenantId`, ni los payloads `before` y
 * `after` completos (podrían arrastrar secretos o mensajes internos). De esos
 * payloads se lee únicamente el código de estado de negocio, siempre traducido.
 */
export function auditCsv(page: AuditLogPage, locale: CsvLocale): string {
  const labels = AUDIT_CSV_LABELS[locale];
  const lines = [csvRow(AUDIT_CSV_COLUMNS.map((column) => labels[column]))];

  for (const item of page.items) {
    lines.push(
      csvRow([
        item.id,
        item.at,
        item.actorId ?? labels.empty,
        item.action,
        item.entity,
        item.entityId,
        localizedStatus(statusOf(item.before), locale, labels),
        localizedStatus(statusOf(item.after), locale, labels),
        item.ip ?? labels.empty,
      ]),
    );
  }
  return csvDocument(lines);
}

/** Solo objetos planos con un `status` de texto: nunca se vuelca el payload. */
function statusOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const status = (value as Record<string, unknown>)["status"];
  return typeof status === "string" && status.length > 0 ? status : null;
}

function localizedStatus(
  status: string | null,
  locale: CsvLocale,
  labels: (typeof AUDIT_CSV_LABELS)[CsvLocale],
): string {
  if (status === null) return labels.empty;
  return AUDIT_STATUS_LABELS[locale][status] ?? labels.unknownStatus;
}
