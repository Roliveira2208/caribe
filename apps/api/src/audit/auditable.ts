import { SetMetadata } from "@nestjs/common";

/** Clave de metadata del decorador @Auditable. */
export const AUDITABLE_KEY = "caribe:auditable";

/**
 * Lo que declara una ruta auditable: la accion y entidad que iran a
 * audit_logs. entityId, before y after los aporta el handler en ejecucion
 * (attachAuditData); actor, IP y fecha los toma el interceptor de la sesion
 * verificada, nunca del body.
 */
export interface AuditableMetadata {
  /** Nombre canonico de la accion (p. ej. "exchange-rate.override"). */
  action: string;
  /** Entidad afectada (p. ej. "exchange-rate"). */
  entity: string;
  /**
   * Accion de plataforma (delta de audit de f0): audita con tenant_id NULL
   * bajo app.platform, sin organizacion activa. Por defecto (falso) la
   * accion es de agencia y exige contexto tenant.
   */
  platform?: boolean;
}

/** Marca una ruta para el AuditInterceptor. */
export const Auditable = (metadata: AuditableMetadata) => SetMetadata(AUDITABLE_KEY, metadata);
