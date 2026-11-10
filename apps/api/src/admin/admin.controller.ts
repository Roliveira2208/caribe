import { Controller, ForbiddenException, Put, Req } from "@nestjs/common";
import { MemberHasPermission } from "@thallesp/nestjs-better-auth";
import { Auditable } from "../audit/auditable.js";
import { attachAuditData } from "../audit/audit-storage.js";

/** Lo minimo que el handler necesita de la sesion (estructural). */
interface SessionInfo {
  session: { activeOrganizationId?: string | null };
}

interface AuthenticatedRequest {
  session?: SessionInfo;
}

/**
 * Stub administrativo de F0 (SDD, "Tasas": PUT /admin/exchange-rates/
 * override) y ENDPOINT DE EJEMPLO de la auditoria (T-F0-9, spec audit
 * "Acceptance"): "fijar tasas" esta en la lista de acciones sensibles, asi
 * que el override deja fila en audit_logs via el interceptor, con actor/IP/
 * fecha de la sesion y antes/despues del cambio.
 *
 * F0 no tiene tabla de tasas: el ejemplo registra "sin override" ->
 * "con override" de la agencia. El override real llega con specs/payments
 * (F2) y sustituye este stub por estado verdadero.
 */
@Controller("admin/exchange-rates")
export class AdminController {
  @MemberHasPermission({ permissions: { "exchange-rate": ["update"] } })
  @Auditable({ action: "exchange-rate.override", entity: "exchange-rate" })
  @Put("override")
  override(@Req() request: AuthenticatedRequest) {
    // El permiso de agencia ya exige organizacion activa; red de seguridad.
    const organizationId = request.session?.session.activeOrganizationId;
    if (!organizationId) {
      throw new ForbiddenException("El override de tasas requiere una agencia activa");
    }
    attachAuditData({
      entityId: organizationId,
      before: null,
      after: { overridden: true },
    });
    return { overridden: true };
  }
}
