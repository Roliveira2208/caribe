import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import {
  PLATFORM_GUC,
  PUBLIC_GUC,
  RATES_GLOBAL_GUC,
  TENANT_GUC,
  USER_GUC,
  type SessionTenantInfo,
  type TenantContext,
  tenantContextFromSession,
} from "./tenant-context.js";

/** Contextos que abren una transaccion (todo menos "none"). */
type ActiveTenantContext = Exclude<TenantContext, { kind: "none" }>;

/**
 * Todo acceso a datos de negocio va por aqui (T-F0-7, ampliado en T-F1-0d):
 * la consulta corre dentro de una transaccion interactiva de Prisma con los
 * GUC del contexto fijados por set_config(..., true), y las politicas RLS de
 * PostgreSQL filtran las filas. Nadie consulta catalogo, reservas, pagos ni
 * auditoria con una conexion fuera de este modulo.
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
    return this.run({ kind: "tenant", tenantId }, fn);
  }

  /**
   * Contexto `owner` (spec tenant-isolation, "Politica combinada por agencia
   * o propietario"): fija app.user_id y nada mas. Sirve a un cliente sin
   * organizacion activa para leer, cancelar o descargar sus propias filas;
   * RLS devuelve solo las del usuario y rechaza escribir las de otro.
   */
  async withOwner<T>(
    userId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!userId) {
      throw new ForbiddenException("El identificador de usuario no puede estar vacío");
    }
    return this.run({ kind: "owner", userId }, fn);
  }

  /**
   * Contexto `tenant`+`owner`: fija ambos GUC y las politicas combinan con
   * OR. Lo usa el pago de una reserva propia: lee la tasa de la agencia y
   * escribe el pago sin abrir el resto de la agencia.
   */
  async withOwnerTenant<T>(
    userId: string,
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!userId || !tenantId) {
      throw new ForbiddenException(
        "El pago de una reserva requiere el usuario y la agencia de la reserva",
      );
    }
    return this.run({ kind: "tenant+owner", tenantId, userId }, fn);
  }

  /**
   * Contexto `public`: catalogo anonimo, solo lectura de productos
   * publicados, su disponibilidad y los destinos que referencian. Las
   * politicas de escritura no miran este GUC: con el, toda escritura se
   * rechaza.
   */
  async withPublic<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.run({ kind: "public" }, fn);
  }

  /**
   * Contexto de plataforma (Super Admin sin agencia activa): fija
   * app.platform = on. RLS deja ver las filas de todas las agencias y las de
   * plataforma (tenant_id NULL); sin este GUC no se ve ninguna.
   */
  async withPlatform<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.run({ kind: "platform" }, fn);
  }

  /**
   * Contexto `rates_global` del trabajo diario de la tasa BCV: solo escribe
   * filas globales de exchange_rates (tenant_id NULL) y no lee ni escribe
   * ninguna otra tabla.
   */
  async withRatesGlobal<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.run({ kind: "rates_global" }, fn);
  }

  /**
   * Fija los GUC del contexto en una transaccion ya abierta. Lo usa el
   * interceptor de auditoria (T-F0-9) para que la fila de audit_logs pase
   * las politicas RLS dentro de la MISMA transaccion de la operacion; los
   * metodos with* delegan aqui para no duplicar la logica.
   */
  async bindContext(context: TenantContext, tx: Prisma.TransactionClient): Promise<void> {
    // Bind parameters: con comillas dobles serian identificadores SQL
    // (columnas) y no literales.
    switch (context.kind) {
      case "tenant":
        await this.setGuc(tx, TENANT_GUC, context.tenantId);
        return;
      case "owner":
        await this.setGuc(tx, USER_GUC, context.userId);
        return;
      case "tenant+owner":
        await this.setGuc(tx, TENANT_GUC, context.tenantId);
        await this.setGuc(tx, USER_GUC, context.userId);
        return;
      case "public":
        await this.setGuc(tx, PUBLIC_GUC, "on");
        return;
      case "platform":
        await this.setGuc(tx, PLATFORM_GUC, "on");
        return;
      case "rates_global":
        await this.setGuc(tx, RATES_GLOBAL_GUC, "on");
        return;
      case "none":
        throw new ForbiddenException(
          "La operación requiere una agencia activa o el rol de plataforma",
        );
    }
  }

  /**
   * Despacha segun el contexto resuelto. "none" (sin agencia y sin rol de
   * plataforma) no ejecuta nada: la operacion requiere un contexto explicito
   * y RLS no otorga filas a una sesion sin el.
   */
  async withContext<T>(
    context: TenantContext,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    switch (context.kind) {
      case "tenant":
        return this.withTenant(context.tenantId, fn);
      case "owner":
        return this.withOwner(context.userId, fn);
      case "tenant+owner":
        return this.withOwnerTenant(context.userId, context.tenantId, fn);
      case "public":
        return this.withPublic(fn);
      case "platform":
        return this.withPlatform(fn);
      case "rates_global":
        return this.withRatesGlobal(fn);
      case "none":
        throw new ForbiddenException(
          "La operación requiere una agencia activa o el rol de plataforma",
        );
    }
  }

  /** Abre la transaccion y fija los GUC del contexto activo. */
  private async run<T>(
    context: ActiveTenantContext,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await this.bindContext(context, tx);
      return fn(tx);
    });
  }

  /** set_config con is_local = true: el valor muere con la transaccion. */
  private async setGuc(
    tx: Prisma.TransactionClient,
    name: string,
    value: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT set_config(${name}, ${value}, true)`;
  }
}
