import { ForbiddenException, Injectable, InternalServerErrorException } from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { from, firstValueFrom, type Observable } from "rxjs";
import { prisma } from "../prisma.js";
import { tenantContextFromSession, type TenantContext } from "../tenant/tenant-context.js";
import { TenantService } from "../tenant/tenant.service.js";
import { auditStorage, type AuditStorage } from "./audit-storage.js";
import { AuditService } from "./audit.service.js";
import { AUDITABLE_KEY, type AuditableMetadata } from "./auditable.js";

/** Lo minimo que el interceptor necesita de la sesion (estructural). */
interface SessionInfo {
  session: { activeOrganizationId?: string | null };
  user: { id: string; role?: string | string[] | null };
}

interface AuditableRequest {
  ip?: string;
  session?: SessionInfo;
}

/**
 * Interceptor de auditoria (T-F0-9, spec audit "Acceptance"). Es dueño de la
 * transaccion de toda ruta @Auditable: ejecuta el handler DENTRO de
 * prisma.$transaction con el GUC del contexto resuelto de la sesion y escribe
 * la fila de audit_logs en esa MISMA transaccion al terminar. Si la auditoria
 * falla, la transaccion (operacion incluida) se revierte: casos limites de la
 * spec.
 *
 * Actor, IP y fecha salen de la sesion verificada, de la peticion y del reloj
 * del servidor; el handler solo aporta entityId/antes/despues via
 * attachAuditData y nunca datos sensibles (el sanitizador aplica igual).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
    private readonly tenantService: TenantService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const metadata = this.reflector.get<AuditableMetadata | undefined>(
      AUDITABLE_KEY,
      context.getHandler(),
    );
    if (!metadata) return next.handle();

    const request = context.switchToHttp().getRequest<AuditableRequest>();
    const session = request.session;
    if (!session) {
      // El guard global ya exige sesion en rutas no publicas; esto es la
      // red de seguridad si alguien marca @Auditable en una ruta publica.
      throw new ForbiddenException("La acción auditable requiere una sesión");
    }

    const resolved: TenantContext = metadata.platform
      ? { kind: "platform" }
      : tenantContextFromSession(session);
    if (!metadata.platform && resolved.kind !== "tenant") {
      throw new ForbiddenException("La acción auditable de agencia requiere una agencia activa");
    }

    const store: AuditStorage = {};
    return from(
      auditStorage.run(store, () =>
        prisma.$transaction(async (tx) => {
          store.tx = tx;
          await this.tenantService.bindContext(resolved, tx);
          const result = await firstValueFrom(next.handle());
          const attachment = store.attachment;
          if (!attachment) {
            // Fallo cerrado: una accion sensible sin fila de auditoria no se
            // confirma. El handler olvido attachAuditData: es un bug.
            throw new InternalServerErrorException("La ruta auditable no aportó el registro");
          }
          await this.auditService.record(tx, {
            tenantId: resolved.kind === "tenant" ? resolved.tenantId : null,
            actorId: session.user.id,
            action: metadata.action,
            entity: metadata.entity,
            entityId: attachment.entityId,
            before: attachment.before,
            after: attachment.after,
            ip: request.ip,
          });
          return result;
        }),
      ),
    );
  }
}
