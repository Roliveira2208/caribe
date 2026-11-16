import { Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import { TenantService } from "../tenant/tenant.service.js";

/** Reserva vencida bloqueada con `FOR UPDATE SKIP LOCKED`. */
interface ExpiredBookingRow {
  id: string;
  code: string;
}

/** Resumen de una pasada del trabajo (útil para logs y pruebas). */
export interface ExpirationSummary {
  organizations: number;
  expired: number;
  failed: number;
}

/**
 * Expiración de retenciones (T-F1-8, spec booking "Vencimiento de la
 * retención" y design §3.3).
 *
 * Recorre las agencias una por una en su propio contexto `withTenant`: un
 * fallo en una se registra y no detiene a las demás. Dentro de cada agencia
 * bloquea las reservas vencidas con `FOR UPDATE SKIP LOCKED` (dos pasadas
 * simultáneas no procesan la misma fila), omite las que tienen un pago
 * `IN_REVIEW` o `APPROVED`, marca `EXPIRED` y decrementa `reserved` en cada
 * noche de sus líneas exactamente una vez, en la misma transacción que la
 * auditoría con actor NULL.
 *
 * La carrera entre un pago y la expiración se resuelve en T-F1-9: allí el
 * pago bloquea la reserva y responde 410 `HOLD_EXPIRED` si ya venció.
 */
@Injectable()
export class BookingExpirationService {
  private readonly logger = new Logger(BookingExpirationService.name);

  constructor(
    private readonly tenantService: TenantService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Ejecuta una pasada completa. `now` permite a las pruebas fijar el
   * instante sin esperar minutos reales. `organizationIds` acota la pasada a
   * unas agencias concretas (reproceso manual de una agencia o una prueba con
   * una base que acumula agencias de corridas anteriores).
   */
  async expireDueBookings(
    now: Date = new Date(),
    organizationIds?: readonly string[],
  ): Promise<ExpirationSummary> {
    const organizations = organizationIds
      ? organizationIds.map((id) => ({ id }))
      : await prisma.organization.findMany({
          select: { id: true },
          orderBy: { createdAt: "asc" },
        });

    const summary: ExpirationSummary = {
      organizations: organizations.length,
      expired: 0,
      failed: 0,
    };

    for (const organization of organizations) {
      try {
        summary.expired += await this.expireTenant(organization.id, now);
      } catch (error) {
        summary.failed += 1;
        this.logger.error(
          `La expiración falló para la agencia ${organization.id}; se continúa con la siguiente: ${
            error instanceof Error ? error.message : "error desconocido"
          }`,
        );
      }
    }

    return summary;
  }

  /** Una agencia: bloqueo, expiración, liberación de cupo y auditoría. */
  private async expireTenant(tenantId: string, now: Date): Promise<number> {
    return this.tenantService.withTenant(tenantId, async (tx) => {
      // `expires_at` es `timestamp without time zone` y Prisma guarda el
      // reloj UTC; se compara con ese mismo reloj sin depender del TimeZone
      // de la sesión de PostgreSQL.
      const bookings = await tx.$queryRaw<ExpiredBookingRow[]>(Prisma.sql`
        SELECT b."id" AS id,
               b."code" AS code
          FROM "bookings" b
         WHERE b."tenant_id" = ${tenantId}
           AND b."status" = 'PENDING_PAYMENT'
           AND b."expires_at" <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
           AND NOT EXISTS (
             SELECT 1
               FROM "payments" p
              WHERE p."booking_id" = b."id"
                AND p."tenant_id" = b."tenant_id"
                AND p."status" IN ('IN_REVIEW', 'APPROVED')
           )
         ORDER BY b."id" ASC
         FOR UPDATE OF b SKIP LOCKED
      `);

      let expired = 0;

      for (const booking of bookings) {
        // El bloqueo ya garantiza que nadie más la toca; el filtro por estado
        // hace la operación idempotente si una pasada futura revisara filas
        // que dejaron de estar pendientes.
        const updated = await tx.booking.updateMany({
          where: { id: booking.id, tenantId, status: "PENDING_PAYMENT" },
          data: { status: "EXPIRED" },
        });
        if (updated.count === 0) continue;
        expired += 1;

        await tx.$executeRaw(Prisma.sql`
          UPDATE "availability" AS a
             SET "reserved" = a."reserved" - bi."quantity",
                 "updated_at" = now()
            FROM "booking_items" AS bi
           WHERE bi."booking_id" = ${booking.id}
             AND bi."tenant_id" = ${tenantId}
             AND a."tenant_id" = ${tenantId}
             AND a."product_id" = bi."product_id"
             AND a."night" >= bi."check_in"
             AND a."night" < bi."check_out"
        `);

        await this.auditService.record(tx, {
          tenantId,
          actorId: null,
          action: "booking.expire",
          entity: "booking",
          entityId: booking.id,
          before: { code: booking.code, status: "PENDING_PAYMENT" },
          after: { code: booking.code, status: "EXPIRED" },
        });
      }

      return expired;
    });
  }
}
