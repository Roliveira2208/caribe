import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PaymentProvider } from "@caribe/shared";
import { AuditService } from "../audit/audit.service.js";
import { prisma } from "../prisma.js";
import { TenantService } from "../tenant/tenant.service.js";
import { PAYMENT_PROVIDER } from "./payment-provider.token.js";

/** Resultado de una pasada del barrido de reembolsos (spec security). */
export interface RefundReconciliationSummary {
  organizations: number;
  completed: number;
  pending: number;
  failed: number;
}

/**
 * Reconciliación de reembolsos (T-F2-5, F-FINAL-003, spec security
 * "Reconciliación de reembolsos").
 *
 * Cada minuto revisa los despachos PENDING contra el proveedor. Solo consulta
 * el estado (`getRefund`): NUNCA vuelve a llamar a `refund`, porque un rebote
 * podría emitir dos veces un reembolso ya aplicado. Si el proveedor lo aplicó
 * pero no se pudo registrar el resultado, cierra la fila y deja auditoría; si
 * sigue sin aplicarse, conserva el estado PENDING y lo reporta en el resumen.
 *
 * La lectura y la escritura corren dentro de `withTenant` para respetar RLS;
 * la consulta al proveedor ocurre fuera de la transacción para no retener la
 * conexión durante una llamada de red.
 */
@Injectable()
export class RefundReconciliationService {
  private readonly logger = new Logger(RefundReconciliationService.name);

  constructor(
    private readonly tenants: TenantService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async reconcileRefunds(
    input: { organizationIds?: readonly string[] } = {},
  ): Promise<RefundReconciliationSummary> {
    const organizations = input.organizationIds
      ? input.organizationIds.map((id) => ({ id }))
      : await prisma.organization.findMany({
          select: { id: true },
          orderBy: { createdAt: "asc" },
        });

    const summary: RefundReconciliationSummary = {
      organizations: organizations.length,
      completed: 0,
      pending: 0,
      failed: 0,
    };

    for (const organization of organizations) {
      try {
        const pending = await this.tenants.withTenant(organization.id, (tx) =>
          tx.refundDispatch.findMany({
            where: { tenantId: organization.id, status: "PENDING" },
            orderBy: { createdAt: "asc" },
          }),
        );

        for (const dispatch of pending) {
          const state = await this.provider.getRefund(dispatch.refundId);
          if (state?.status !== "COMPLETED") {
            summary.pending += 1;
            this.logger.warn(
              `Reembolso ${dispatch.refundId} sigue pendiente en el proveedor; se revisará de nuevo.`,
            );
            continue;
          }

          await this.tenants.withTenant(organization.id, (tx) =>
            tx.refundDispatch.update({
              where: { refundId: dispatch.refundId },
              data: {
                status: "COMPLETED",
                providerReference: state.providerReference,
              },
            }),
          );
          await this.tenants.withTenant(organization.id, (tx) =>
            this.audit.record(tx, {
              tenantId: organization.id,
              actorId: null,
              action: "refund.reconciled",
              entity: "refund",
              entityId: dispatch.refundId,
              before: { status: "PENDING" },
              after: { refundId: dispatch.refundId, status: "COMPLETED" },
            }),
          );
          summary.completed += 1;
        }
      } catch (error) {
        summary.failed += 1;
        this.logger.error(
          `La reconciliación falló para la agencia ${organization.id}; se continúa con la siguiente: ${
            error instanceof Error ? error.message : "error desconocido"
          }`,
        );
      }
    }

    return summary;
  }
}
