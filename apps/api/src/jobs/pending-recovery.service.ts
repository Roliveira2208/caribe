import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import { TenantService } from "../tenant/tenant.service.js";
import {
  pendingRecoveryMinutes,
  type NotificationPayload,
  type RenderDocumentPayload,
} from "./jobs.constants.js";

/** Resultado de una pasada del barrido (útil para logs y pruebas). */
export interface RecoverySummary {
  organizations: number;
  documents: number;
  notifications: number;
  failed: number;
}

/** Colas mínimas para re-encolar; el planificador inyecta las reales. */
export interface RecoveryQueues {
  document(payload: RenderDocumentPayload): Promise<void>;
  notification(payload: NotificationPayload): Promise<void>;
}

/**
 * Barrido de documentos y avisos `PENDING` huérfanos (T-F1-12b, spec documents
 * "Fila huérfana tras una caída" y notifications del mismo nombre).
 *
 * El proceso puede caer entre el commit que reservó la fila y el encolado del
 * trabajo: sin este barrido el PDF o el correo nunca se producen. Una pasada
 * recorre las agencias una por una con `withTenant` (RLS) y re-encola solo las
 * filas `PENDING` con más de N minutos desde su creación. Un fallo en una
 * agencia se registra y no detiene a las demás.
 *
 * La consulta se ejecuta DENTRO de `withTenant`, pero el encolado ocurre
 * después de leer: las colas no tocan la base y así no se retiene la conexión
 * ni se encola desde una transacción que podría revertirse.
 */
@Injectable()
export class PendingRecoveryService {
  private readonly logger = new Logger(PendingRecoveryService.name);

  constructor(private readonly tenants: TenantService) {}

  async recoverStalePending(
    queues: RecoveryQueues,
    now: Date = new Date(),
    organizationIds?: readonly string[],
    minutes: number = pendingRecoveryMinutes(),
  ): Promise<RecoverySummary> {
    const organizations = organizationIds
      ? organizationIds.map((id) => ({ id }))
      : await prisma.organization.findMany({
          select: { id: true },
          orderBy: { createdAt: "asc" },
        });

    const summary: RecoverySummary = {
      organizations: organizations.length,
      documents: 0,
      notifications: 0,
      failed: 0,
    };
    const cutoff = new Date(now.getTime() - minutes * 60_000);

    for (const organization of organizations) {
      try {
        const stale = await this.tenants.withTenant(organization.id, async (tx) => {
          // `created_at` es timestamp without time zone y Prisma guarda el
          // reloj UTC; se compara con ese mismo reloj (igual que la
          // expiración) para no depender del TimeZone de la sesión.
          const cutoffSql = Prisma.sql`(${cutoff.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
          const [documents, notifications] = await Promise.all([
            tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              SELECT "id" FROM "documents"
               WHERE "tenant_id" = ${organization.id}
                 AND "status" = 'PENDING'
                 AND "created_at" <= ${cutoffSql}
               ORDER BY "created_at" ASC
            `),
            tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              SELECT "id" FROM "notification_logs"
               WHERE "tenant_id" = ${organization.id}
                 AND "status" = 'PENDING'
                 AND "created_at" <= ${cutoffSql}
               ORDER BY "created_at" ASC
            `),
          ]);
          return { documents, notifications };
        });

        for (const document of stale.documents) {
          await queues.document({ documentId: document.id, tenantId: organization.id });
          summary.documents += 1;
        }
        for (const notification of stale.notifications) {
          await queues.notification({
            notificationId: notification.id,
            tenantId: organization.id,
          });
          summary.notifications += 1;
        }
      } catch (error) {
        summary.failed += 1;
        this.logger.error(
          `El barrido falló para la agencia ${organization.id}; se continúa con la siguiente: ${
            error instanceof Error ? error.message : "error desconocido"
          }`,
        );
      }
    }

    return summary;
  }
}
