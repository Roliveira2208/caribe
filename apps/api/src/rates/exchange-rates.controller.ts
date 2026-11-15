import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { attachAuditData, currentAuditTx } from "../audit/audit-storage.js";
import { Auditable } from "../audit/auditable.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import {
  overrideRateSchema,
  type ExchangeRateView,
  type OverrideRateBody,
} from "./exchange-rate.schemas.js";
import { ExchangeRateService, type AuditRateState } from "./exchange-rate.service.js";
import {
  ExchangeRatesGuard,
  RatePermission,
  type RateActor,
  type RatesRequest,
} from "./exchange-rates.guard.js";

/**
 * Tasas administrativas (T-F1-5, spec exchange-rates "Ajuste manual").
 *
 * - GET /admin/exchange-rates/current: tasa vigente del ámbito de la sesión.
 * - PUT /admin/exchange-rates/override: override de la agencia, con motivo y
 *   auditoría antes/después en la MISMA transacción.
 * - PUT /admin/exchange-rates/global-override: override global del Super
 *   Admin, auditado como acción de plataforma (`tenant_id` NULL).
 *
 * El guard global ya exigió TOTP a los roles administrativos; `ExchangeRatesGuard`
 * aplica después la matriz de permisos y la regla de plataforma.
 */
@Controller("admin/exchange-rates")
@UseGuards(ExchangeRatesGuard)
export class ExchangeRatesController {
  constructor(private readonly exchangeRateService: ExchangeRateService) {}

  @Get("current")
  @RatePermission("tenant-read")
  current(@Req() request: RatesRequest): Promise<ExchangeRateView> {
    return this.exchangeRateService.currentRate(actorOf(request));
  }

  @Auditable({ action: "exchange-rate.override", entity: "exchange-rate" })
  @Put("override")
  @RatePermission("tenant-update")
  async override(
    @Req() request: RatesRequest,
    @Body(new ZodValidationPipe(overrideRateSchema)) body: OverrideRateBody,
  ): Promise<ExchangeRateView> {
    const actor = actorOf(request);
    const tenantId = actor.tenantId;
    if (!tenantId) {
      // Red de seguridad: el guard ya rechazó este caso.
      throw new ApiProblemException(
        "FORBIDDEN",
        "El override de agencia requiere una agencia activa.",
      );
    }

    // La transacción la abre el interceptor de auditoría con el GUC de la
    // agencia: la tasa y su fila de audit_logs se confirman juntas o ninguna.
    const result = await this.exchangeRateService.applyAgencyOverride(
      currentAuditTx(),
      tenantId,
      actor.userId,
      body,
    );

    attachAuditData({
      entityId: result.id,
      before: result.before,
      after: auditState(result.id, result.view, body.reason),
    });
    return result.view;
  }

  @Auditable({
    action: "exchange-rate.global-override",
    entity: "exchange-rate",
    platform: true,
  })
  @Put("global-override")
  @RatePermission("platform-update")
  async globalOverride(
    @Req() request: RatesRequest,
    @Body(new ZodValidationPipe(overrideRateSchema)) body: OverrideRateBody,
  ): Promise<ExchangeRateView> {
    const actor = actorOf(request);
    const result = await this.exchangeRateService.applyGlobalOverride(
      currentAuditTx(),
      actor.userId,
      body,
    );

    attachAuditData({
      entityId: result.id,
      before: result.before,
      after: auditState(result.id, result.view, body.reason),
    });
    return result.view;
  }
}

/** El guard siempre deja `rateActor`; sin él sería un fallo de cableado. */
function actorOf(request: RatesRequest): RateActor {
  if (!request.rateActor) {
    throw new Error("ExchangeRatesGuard no fijó el actor de tasas");
  }
  return request.rateActor;
}

function auditState(
  id: string,
  view: ExchangeRateView,
  reason: string,
): AuditRateState {
  return {
    id,
    valueDate: view.valueDate,
    rate: view.rate,
    source: view.source,
    isOverride: view.isOverride,
    reason,
  };
}
