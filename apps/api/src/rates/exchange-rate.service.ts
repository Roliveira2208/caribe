import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  formatRate,
  formatValueDate,
  parseRateText,
  todayInCaracas,
  type DecimalValue,
  type ExchangeRateProvider,
} from "@caribe/shared";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { Prisma } from "../generated/prisma/client.js";
import { TenantService } from "../tenant/tenant.service.js";
import type { RateActor } from "./exchange-rates.guard.js";
import type {
  ExchangeRateView,
  OverrideRateBody,
  RateScope,
} from "./exchange-rate.schemas.js";
import { RateCache } from "./rate-cache.js";

/** La tasa cacheada 1 h: clave por fecha pedida, valor serializado. */
const RATE_CACHE_TTL_MS = 60 * 60 * 1_000;
const RATE_CACHE_PREFIX = "exchange-rate:global:v1:";

/** Token de inyección del proveedor primario (la interfaz se borra en runtime). */
export const EXCHANGE_RATE_PROVIDER = Symbol("EXCHANGE_RATE_PROVIDER");

/** Columnas de `exchange_rates` que consume el servicio. */
interface RateRow {
  id: string;
  source: string;
  rate: DecimalValue;
  valueDate: Date;
  isOverride: boolean;
  reason: string | null;
}

/** Resultado de un override: fila escrita y estado previo para la auditoría. */
export interface OverrideResult {
  id: string;
  view: ExchangeRateView;
  before: AuditRateState | null;
}

export interface AuditRateState {
  id: string;
  valueDate: string;
  rate: string;
  source: string;
  isOverride: boolean;
  reason: string | null;
}

const RATE_SELECT = {
  id: true,
  source: true,
  rate: true,
  valueDate: true,
  isOverride: true,
  reason: true,
} as const;

/**
 * Resolución y ajuste de tasas (T-F1-5, spec exchange-rates y design §6).
 *
 * Precedencia por fecha y ámbito: override de agencia > fila global (override
 * global o BCV). El respaldo es la última `value_date <= fecha` del ámbito.
 * Sin ninguna fila la API responde 503 RATE_UNAVAILABLE.
 *
 * La caché de 1 h cubre solo el resultado del proveedor global. Los overrides
 * se leen de la base en cada petición para no servir un ajuste viejo. El job
 * (`refreshGlobalRate`) escribe con el contexto `rates_global`, solo filas
 * globales, y nunca pisa una fila `is_override`.
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  constructor(
    private readonly tenantService: TenantService,
    @Inject(EXCHANGE_RATE_PROVIDER) private readonly provider: ExchangeRateProvider,
    private readonly cache: RateCache,
  ) {}

  /** Tasa vigente del ámbito de la sesión (agencia o plataforma). */
  async currentRate(actor: RateActor): Promise<ExchangeRateView> {
    // La lectura intenta refrescar la tasa global; si el proveedor falla se
    // usa el respaldo guardado y, si tampoco hay, resolve* lanza 503.
    await this.refreshGlobalRate().catch(() => undefined);

    return actor.tenantId
      ? this.tenantService.withTenant(actor.tenantId, (tx) =>
          this.resolveAgency(tx, actor.tenantId as string),
        )
      : this.tenantService.withPlatform((tx) => this.resolveGlobal(tx));
  }

  /**
   * Tasa global vigente para una fecha (catálogo público, T-F1-6). Corre en
   * el contexto `public`, que solo ve filas globales, y no dispara al
   * proveedor: la fila la escriben `refreshGlobalRate()` (job diario) o un
   * override. Sin fila lanza 503 y el catálogo sigue sirviendo USD.
   */
  async globalRate(date: string = todayInCaracas()): Promise<ExchangeRateView> {
    return this.tenantService.withPublic((tx) => this.resolveGlobal(tx, date));
  }

  /**
   * Tasa de la agencia para una fecha (pago, T-F1-9): override de la agencia
   * o, en su defecto, la fila global vigente.
   */
  async agencyRate(tenantId: string, date: string = todayInCaracas()): Promise<ExchangeRateView> {
    return this.tenantService.withTenant(tenantId, (tx) =>
      this.resolveAgency(tx, tenantId, date),
    );
  }

  /**
   * Cuerpo del trabajo diario de la tasa BCV. Obtiene la tasa del proveedor
   * (salvo que la caché de 1 h ya la tenga), guarda la fila global del día y
   * nunca pisa un override. Si el proveedor falla se usa la última fila
   * global; sin ninguna, 503 RATE_UNAVAILABLE.
   */
  async refreshGlobalRate(): Promise<ExchangeRateView> {
    const requestedDate = todayInCaracas();
    const cacheKey = `${RATE_CACHE_PREFIX}${requestedDate}`;

    let fetched = await this.readCached(cacheKey);
    if (!fetched) {
      try {
        const providerRate = await this.provider.getRate(requestedDate);
        fetched = {
          rate: parseRateText(providerRate.rate),
          valueDate: providerRate.valueDate ?? requestedDate,
        };
        await this.cache.set(cacheKey, JSON.stringify(fetched), RATE_CACHE_TTL_MS);
      } catch (error) {
        this.logger.warn(
          `No se pudo obtener la tasa del proveedor; se usa el respaldo guardado: ${
            error instanceof Error ? error.message : "error desconocido"
          }`,
        );
        fetched = null;
      }
    }

    return this.tenantService.withRatesGlobal(async (tx) => {
      if (fetched) {
        await this.upsertGlobalRate(tx, fetched.valueDate, fetched.rate);
      }
      return this.resolveGlobal(tx, requestedDate);
    });
  }

  /**
   * Override de agencia dentro de la transacción auditable. Reemplaza la fila
   * de esa fecha (único `tenant_id, value_date`) y devuelve el estado previo
   * para la auditoría.
   */
  async applyAgencyOverride(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    body: OverrideRateBody,
  ): Promise<OverrideResult> {
    const valueDate = body.valueDate ?? todayInCaracas();
    const previous = await tx.exchangeRate.findFirst({
      where: { tenantId, valueDate: dateOf(valueDate) },
      select: RATE_SELECT,
    });

    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "exchange_rates"
        (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
      VALUES (
        ${randomUUID()}, ${tenantId}, 'MANUAL', ${body.rate}::numeric,
        ${valueDate}::date, now(), true, ${body.reason}, ${userId}
      )
      ON CONFLICT ("tenant_id", "value_date") DO UPDATE SET
        source = EXCLUDED.source,
        rate = EXCLUDED.rate,
        fetched_at = EXCLUDED.fetched_at,
        is_override = true,
        reason = EXCLUDED.reason,
        created_by = EXCLUDED.created_by
      RETURNING id
    `);

    return this.overrideResult(tx, rows[0]?.id, previous, "agency");
  }

  /**
   * Override global dentro de la transacción auditable de plataforma.
   * Reemplaza la fila BCV de esa fecha mediante el único parcial de
   * `value_date WHERE tenant_id IS NULL`.
   */
  async applyGlobalOverride(
    tx: Prisma.TransactionClient,
    userId: string,
    body: OverrideRateBody,
  ): Promise<OverrideResult> {
    const valueDate = body.valueDate ?? todayInCaracas();
    const previous = await tx.exchangeRate.findFirst({
      where: { tenantId: null, valueDate: dateOf(valueDate) },
      select: RATE_SELECT,
    });

    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "exchange_rates"
        (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
      VALUES (
        ${randomUUID()}, NULL, 'MANUAL', ${body.rate}::numeric,
        ${valueDate}::date, now(), true, ${body.reason}, ${userId}
      )
      ON CONFLICT ("value_date") WHERE "tenant_id" IS NULL DO UPDATE SET
        source = EXCLUDED.source,
        rate = EXCLUDED.rate,
        fetched_at = EXCLUDED.fetched_at,
        is_override = true,
        reason = EXCLUDED.reason,
        created_by = EXCLUDED.created_by
      RETURNING id
    `);

    return this.overrideResult(tx, rows[0]?.id, previous, "platform");
  }

  /** Upsert de la fila global BCV; no toca filas `is_override`. */
  private async upsertGlobalRate(
    tx: Prisma.TransactionClient,
    valueDate: string,
    rate: string,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "exchange_rates"
        (id, tenant_id, source, rate, value_date, fetched_at, is_override, reason, created_by)
      VALUES (${randomUUID()}, NULL, 'DOLARAPI', ${rate}::numeric, ${valueDate}::date, now(), false, NULL, NULL)
      ON CONFLICT ("value_date") WHERE "tenant_id" IS NULL DO UPDATE SET
        source = EXCLUDED.source,
        rate = EXCLUDED.rate,
        fetched_at = EXCLUDED.fetched_at
      WHERE "exchange_rates"."is_override" = false
    `);
  }

  /** Última fila global con `value_date <= date`; 503 si no hay ninguna. */
  private async resolveGlobal(
    tx: Prisma.TransactionClient,
    date: string = todayInCaracas(),
  ): Promise<ExchangeRateView> {
    const row = await tx.exchangeRate.findFirst({
      where: { tenantId: null, valueDate: { lte: dateOf(date) } },
      orderBy: { valueDate: "desc" },
      select: RATE_SELECT,
    });
    if (!row) throw rateUnavailable();
    return toView(row, "platform");
  }

  /** Override de la agencia para la fecha o, en su defecto, la fila global. */
  private async resolveAgency(
    tx: Prisma.TransactionClient,
    tenantId: string,
    date: string = todayInCaracas(),
  ): Promise<ExchangeRateView> {
    const own = await tx.exchangeRate.findFirst({
      where: { tenantId, valueDate: { lte: dateOf(date) } },
      orderBy: { valueDate: "desc" },
      select: RATE_SELECT,
    });
    if (own) return toView(own, "agency");

    const global = await tx.exchangeRate.findFirst({
      where: { tenantId: null, valueDate: { lte: dateOf(date) } },
      orderBy: { valueDate: "desc" },
      select: RATE_SELECT,
    });
    if (!global) throw rateUnavailable();
    return toView(global, "agency");
  }

  /** Lee la caché y valida el contenido; una entrada corrupta se descarta. */
  private async readCached(
    key: string,
  ): Promise<{ rate: string; valueDate: string } | null> {
    const raw = await this.cache.get(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { rate?: unknown; valueDate?: unknown };
      if (typeof parsed.rate !== "string" || typeof parsed.valueDate !== "string") {
        return null;
      }
      return { rate: parseRateText(parsed.rate), valueDate: parsed.valueDate };
    } catch {
      return null;
    }
  }

  private async overrideResult(
    tx: Prisma.TransactionClient,
    id: string | undefined,
    previous: RateRow | null,
    scope: RateScope,
  ): Promise<OverrideResult> {
    if (!id) {
      throw new Error("El override de tasa no devolvió la fila escrita");
    }
    const row = await tx.exchangeRate.findUniqueOrThrow({
      where: { id },
      select: RATE_SELECT,
    });
    return {
      id,
      view: toView(row, scope),
      before: previous ? toAuditState(previous) : null,
    };
  }
}

function dateOf(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toView(row: RateRow, scope: RateScope): ExchangeRateView {
  return {
    scope,
    valueDate: formatValueDate(row.valueDate),
    rate: formatRate(row.rate),
    source: row.source,
    isOverride: row.isOverride,
  };
}

function toAuditState(row: RateRow): AuditRateState {
  return {
    id: row.id,
    valueDate: formatValueDate(row.valueDate),
    rate: formatRate(row.rate),
    source: row.source,
    isOverride: row.isOverride,
    reason: row.reason,
  };
}

function rateUnavailable(): ApiProblemException {
  return new ApiProblemException(
    "RATE_UNAVAILABLE",
    "No hay una tasa de cambio disponible para el ámbito solicitado.",
  );
}
