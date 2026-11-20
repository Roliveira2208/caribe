import { Module } from "@nestjs/common";
import { TenantModule } from "../tenant/tenant.module.js";
import { CotizaveProvider } from "./cotizave.provider.js";
import { EXCHANGE_RATE_PROVIDER, ExchangeRateService } from "./exchange-rate.service.js";
import { ExchangeRatesController } from "./exchange-rates.controller.js";
import { ExchangeRatesGuard } from "./exchange-rates.guard.js";
import { PublicRatesController } from "./public-rates.controller.js";
import { RateCache } from "./rate-cache.js";

/**
 * Tasas (T-F1-5 y T-F1-5b, design §6): proveedor Cotizave con timeout,
 * reintento y circuit breaker; caché Redis de 1 h con respaldo en memoria;
 * resolución por ámbito, overrides auditados y refresco perezoso al login y al
 * alta de pago.
 *
 * El proveedor se inyecta por token para que el servicio dependa de la
 * interfaz `ExchangeRateProvider` y los tests puedan usar un doble.
 */
@Module({
  imports: [TenantModule],
  controllers: [ExchangeRatesController, PublicRatesController],
  providers: [
    ExchangeRateService,
    ExchangeRatesGuard,
    {
      provide: EXCHANGE_RATE_PROVIDER,
      useFactory: () => new CotizaveProvider(),
    },
    {
      provide: RateCache,
      useFactory: () => new RateCache(process.env.REDIS_URL),
    },
  ],
  exports: [ExchangeRateService],
})
export class RatesModule {}
