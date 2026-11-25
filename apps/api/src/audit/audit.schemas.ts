import { z } from "@caribe/shared";

/** Tamaño de página del visor de auditoría (spec audit, "Filtros y cursor"). */
export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 100;

/**
 * Consulta del visor: esquema estricto para que una clave desconocida o un
 * parámetro repetido respondan 422 en lugar de ignorarse. El cursor se valida
 * en `audit.cursor.ts` y es opaco para la interfaz.
 */
export const listAuditLogsQuerySchema = z
  .strictObject({
    action: z.string().min(1).optional(),
    entity: z.string().min(1).optional(),
    actor: z.string().min(1).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_MAX_LIMIT).optional(),
    cursor: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: "from no puede ser posterior a to",
      });
    }
  });

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

/** Fila del visor: solo campos de negocio, estados redactados y fecha ISO. */
export interface AuditLogItem {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  at: string;
}

export interface AuditLogPage {
  items: AuditLogItem[];
  nextCursor: string | null;
}
