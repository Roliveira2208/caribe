import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import {
  PLATFORM_GUC,
  TENANT_GUC,
  type SessionTenantInfo,
  type TenantContext,
  tenantContextFromSession,
} from "./tenant-context.js";

/**
 * Todo acceso a datos con tenant_id va por aqui (T-F0-7): la consulta corre
 * dentro de una transaccion interactiva de Prisma con el GUC de tenant fijado
 * por set_config(..., true), y las politicas RLS de PostgreSQL filtran las
 * filas por ese valor. Nadie consulta audit_logs (y en F1, catalogo o
 * reservas) con una conexion fuera de este modulo.
 *
 * La aplicacion conecta como caribe_app (NOBYPASSRLS y no duena de las
 * tablas), de modo que las politicas siempre aplican; los tests lo verifican
 * con SET ROLE caribe_app sin contrasenas en el repositorio.
 */
@Injectable()
export class TenantService {
  /** Resolucion del contexto a partir de la sesion (pura; ver tenant-context.ts). */
  contextFromSession(session: SessionTenantInfo | null | undefined): TenantContext {
    return tenantContextFromSession(session);
  }

  /**
   * Ejecuta fn en una transaccion con el GUC app.tenant_id = tenantId. RLS
   * deja ver y escribir solo las filas de esa agencia; el valor muere con la
   * transaccion (is_local = true).
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!tenantId) {
      throw new ForbiddenException("El identificador de agencia no puede estar vacío");
    }
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config(${TENANT_GUC}, ${tenantId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Contexto de plataforma (Super Admin sin agencia activa): fija
   * app.platform = on. RLS deja ver las filas de todas las agencias y las de
   * plataforma (tenant_id NULL); sin este GUC no se ve ninguna.
   */
  async withPlatform<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      // "on" como bind parameter: con comillas dobles seria un identificador
      // SQL (columna) y no un literal, igual que tenantId en withTenant.
      await tx.$executeRaw`SELECT set_config(${PLATFORM_GUC}, ${"on"}, true)`;
      return fn(tx);
    });
  }

  /**
   * Despacha segun el contexto resuelto de la sesion. "none" (sin agencia y
   * sin rol de plataforma) no ejecuta nada: la operacion requiere uno de los
   * dos contextos y RLS no otorga filas a una sesion sin ellos.
   */
  async withContext<T>(
    context: TenantContext,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (context.kind === "tenant") return this.withTenant(context.tenantId, fn);
    if (context.kind === "platform") return this.withPlatform(fn);
    throw new ForbiddenException("La operación requiere una agencia activa o el rol de plataforma");
  }
}
