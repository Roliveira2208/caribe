import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { Auditable } from "../audit/auditable.js";
import { attachAuditData, currentAuditTx } from "../audit/audit-storage.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import {
  activeMembershipOf,
  type ActiveMembershipRequest,
} from "../tenant/active-membership.js";
import { ActiveMembershipGuard } from "../tenant/active-membership.guard.js";
import { TenantService } from "../tenant/tenant.service.js";
import { TenantSettingsGuard } from "./tenant-settings.guard.js";
import {
  toTenantSettingsResponse,
  updateTenantSettingsSchema,
  type TenantSettingsResponse,
  type UpdateTenantSettingsBody,
} from "./tenant-settings.schemas.js";

/** Lo minimo que el controller necesita de la sesion (estructural). */
interface SessionInfo {
  session: { activeOrganizationId?: string | null };
  user: { id: string };
}

interface AuthenticatedRequest extends ActiveMembershipRequest {
  session?: SessionInfo;
}

/**
 * Ajustes de la agencia (T-F1-1a, design §2.1 y spec auth-access).
 *
 * GET y PUT /api/v1/admin/tenant-settings. La ruta esta bajo /admin, asi que
 * el guard global exige TOTP a owner/admin; TenantSettingsGuard exige ademas
 * agencia activa y membresia owner/admin. GET nunca crea la fila: sin fila
 * devuelve los defaults. PUT es parcial, estricto y auditado con antes y
 * despues en la MISMA transaccion (spec audit, "Cambio de ajustes de la
 * agencia").
 */
@Controller("admin/tenant-settings")
@UseGuards(ActiveMembershipGuard, TenantSettingsGuard)
export class TenantSettingsController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  async get(@Req() request: AuthenticatedRequest): Promise<TenantSettingsResponse> {
    const tenantId = await activeOrganizationOf(request);
    return this.tenantService.withTenant(tenantId, async (tx) => {
      const row = await tx.tenantSettings.findUnique({ where: { tenantId } });
      return toTenantSettingsResponse(row, tenantId);
    });
  }

  @Auditable({ action: "tenant-settings.update", entity: "tenant_settings" })
  @Put()
  async update(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(updateTenantSettingsSchema)) body: UpdateTenantSettingsBody,
  ): Promise<TenantSettingsResponse> {
    const tenantId = await activeOrganizationOf(request);
    // La transaccion la abre el interceptor de auditoria con el GUC de la
    // agencia: operacion y fila de audit_logs se confirman juntas o ninguna.
    const tx = currentAuditTx();
    const before = await tx.tenantSettings.findUnique({ where: { tenantId } });
    const row = await tx.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...body },
      update: { ...body },
    });

    const after = toTenantSettingsResponse(row, tenantId);
    attachAuditData({
      entityId: tenantId,
      // Sin fila previa el "antes" son los defaults efectivos, no null.
      before: toTenantSettingsResponse(before, tenantId),
      after,
    });
    return after;
  }
}

/** Agencia activa ya validada por ActiveMembershipGuard (sin consulta extra). */
async function activeOrganizationOf(request: AuthenticatedRequest): Promise<string> {
  const membership = await activeMembershipOf(request);
  if (!membership) {
    // Red de seguridad: el guard ya respondio antes.
    throw new ApiProblemException(
      "ACTIVE_ORGANIZATION_REQUIRED",
      "La operación requiere una agencia activa de la que el usuario sea miembro.",
    );
  }
  return membership.organizationId;
}
