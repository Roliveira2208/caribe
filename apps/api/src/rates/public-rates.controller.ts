import { Controller, Get } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import type { TodayRateView } from "./exchange-rate.schemas.js";
import { ExchangeRateService } from "./exchange-rate.service.js";

/**
 * Lectura pública de la tasa (change public-rate-and-price-filters, spec
 * exchange-rates "Lectura pública de la tasa vigente").
 *
 * `GET /rates/today` es anónima y devuelve la tasa global que ya usa el
 * catálogo: la última fila global con `value_date <= hoy`, incluidos los fines
 * de semana y los overrides globales. No llama a `ensureTodayRate()`, así que
 * un visitante nunca dispara al proveedor. Sin tasa global responde 200 con
 * `available: false` para que la web muestre solo USD, en vez de un 503 que
 * rompería la página pública.
 */
@Controller("rates")
export class PublicRatesController {
  constructor(private readonly exchangeRateService: ExchangeRateService) {}

  @AllowAnonymous()
  @Get("today")
  async today(): Promise<TodayRateView> {
    try {
      const rate = await this.exchangeRateService.globalRate();
      return { available: true, rate: rate.rate, valueDate: rate.valueDate };
    } catch (error) {
      if (error instanceof ApiProblemException && error.code === "RATE_UNAVAILABLE") {
        return { available: false, rate: null, valueDate: null };
      }
      throw error;
    }
  }
}
