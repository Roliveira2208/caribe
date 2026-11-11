import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import { TenantService } from "../tenant/tenant.service.js";

/** Forma estable del error guardado en una fila de resultado (sin mensaje). */
export interface AuthEventError {
  code: string;
  status: number;
  name: string;
}

/** Fila de intento: se escribe en el hook before, antes de ejecutar. */
export interface AuthEventAttempt {
  correlationId: string;
  tenantId: string | null;
  actorId: string;
  route: string;
  method: string;
  ip: string | null;
}

/** Fila de resultado: exito o error, con el mismo correlation_id. */
export interface AuthEventResult {
  correlationId: string;
  tenantId: string | null;
  actorId: string | null;
  route: string;
  method: string;
  ip: string | null;
  outcome: "success" | "error";
  error: AuthEventError | null;
  entity: string | null;
  entityId: string | null;
}

/**
 * Escritura de auth_events (T-F1-0b, delta de audit). Cada fila abre su
 * propia transaccion con el GUC RLS del tenant (o de plataforma si el evento
 * no tiene agencia), porque los hooks de Better Auth no pueden unirse a la
 * transaccion interna de la lib. La decision de fallar cerrada (intento) o
 * best-effort (resultado) es del llamador: este servicio solo escribe.
 */
@Injectable()
export class AuthEventService {
  private readonly tenantService = new TenantService();

  async recordAttempt(entry: AuthEventAttempt): Promise<void> {
    await this.write(entry.tenantId, {
      id: randomUUID(),
      tenantId: entry.tenantId,
      correlationId: entry.correlationId,
      phase: "attempt",
      actorId: entry.actorId,
      route: entry.route,
      method: entry.method,
      ip: entry.ip,
      outcome: null,
      errorCode: null,
      errorStatus: null,
      errorName: null,
      entity: null,
      entityId: null,
      at: new Date(),
    });
  }

  async recordResult(entry: AuthEventResult): Promise<void> {
    await this.write(entry.tenantId, {
      id: randomUUID(),
      tenantId: entry.tenantId,
      correlationId: entry.correlationId,
      phase: "result",
      actorId: entry.actorId,
      route: entry.route,
      method: entry.method,
      ip: entry.ip,
      outcome: entry.outcome,
      errorCode: entry.error?.code ?? null,
      errorStatus: entry.error?.status ?? null,
      errorName: entry.error?.name ?? null,
      entity: entry.entity,
      entityId: entry.entityId,
      at: new Date(),
    });
  }

  private async write(
    tenantId: string | null,
    data: Prisma.AuthEventCreateInput,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await this.tenantService.bindContext(
        tenantId === null ? { kind: "platform" } : { kind: "tenant", tenantId },
        tx,
      );
      await tx.authEvent.create({ data });
    });
  }
}

/**
 * Instancia unica para los hooks de Better Auth (fuera de Nest) y para los
 * tests: espiar esta referencia permite simular fallos de escritura sin tocar
 * la base.
 */
export const authEventService = new AuthEventService();
