import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { sanitizeAuditPayload } from "./audit-sanitize.js";

/**
 * Entrada de auditoria que escribe el servicio. tenantId y actorId los
 * resuelve el interceptor desde la sesion; el handler solo aporta la parte
 * de negocio (entityId, before, after).
 */
export interface AuditEntry {
  tenantId: string | null;
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Escritura del rastro de auditoria (T-F0-9, specs/audit). No abre su
 * propia transaccion: recibe la del llamador, porque la spec exige que
 * operacion y auditoria se confirmen juntas o ninguna (casos limites). Todo
 * before/after pasa por el sanitizador antes de tocar la base de datos.
 */
@Injectable()
export class AuditService {
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: entry.tenantId,
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: sanitizeJson(entry.before),
        after: sanitizeJson(entry.after),
        ip: entry.ip ?? null,
        at: new Date(),
      },
    });
  }
}

/** undefined -> JsonNull (columna JSONB nulleable); lo demas, redactado. */
function sanitizeJson(value: unknown): Prisma.AuditLogCreateInput["before"] {
  const sanitized = sanitizeAuditPayload(value);
  if (sanitized === undefined || sanitized === null) return Prisma.JsonNull;
  return sanitized as Prisma.InputJsonValue;
}
