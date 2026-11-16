import {
  parseRateText,
  todayInCaracas,
  type ExchangeRateProvider,
  type ProviderRate,
} from "@caribe/shared";
import { CircuitBreaker } from "./circuit-breaker.js";

/** Endpoint V2 de Cotizave para las tasas de Venezuela. */
export const COTIZAVE_DEFAULT_URL = "https://api.cotizave.com/v2/fx/VE/rates";

/** ID canónico de la tasa oficial del BCV en Cotizave. */
export const COTIZAVE_BCV_ID = "ve-bcv";

export interface CotizaveProviderOptions {
  url?: string;
  /** Clave de Cotizave; por defecto `COTIZAVE_API_KEY`. */
  apiKey?: string;
  /** Tiempo máximo por intento; la spec fija 5 s. */
  timeoutMs?: number;
  /** Reintentos tras el primer intento (la spec pide uno). */
  retries?: number;
  breaker?: CircuitBreaker;
  fetchImpl?: typeof fetch;
}

/** Forma mínima de una tasa de la respuesta de Cotizave. */
interface CotizaveRate {
  id?: unknown;
  mid?: unknown;
  updated_at?: unknown;
  effective_date?: unknown;
}

interface CotizavePayload {
  rates?: unknown;
}

/**
 * Proveedor de la tasa oficial (T-F1-5b, design §6).
 *
 * Cotizave exige la clave en la cabecera `X-API-Key` (nunca en la URL). Cada
 * llamada tiene un timeout de 5 s y un reintento; el circuit breaker corta las
 * llamadas tras 3 fallos consecutivos durante 60 s. Se usa la tasa `ve-bcv` y
 * su `mid`; un valor inválido o la falta de clave se tratan como fallo del
 * proveedor. `value_date` sale de `effective_date`, de `updated_at` en
 * America/Caracas o de la fecha pedida (fin de semana: la del viernes).
 */
export class CotizaveProvider implements ExchangeRateProvider {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly breaker: CircuitBreaker;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CotizaveProviderOptions = {}) {
    this.url = options.url ?? process.env.COTIZAVE_API_URL ?? COTIZAVE_DEFAULT_URL;
    this.apiKey = (options.apiKey ?? process.env.COTIZAVE_API_KEY ?? "").trim();
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.retries = options.retries ?? 1;
    this.breaker = options.breaker ?? new CircuitBreaker();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getRate(date: string): Promise<ProviderRate> {
    if (!this.apiKey) {
      throw new Error("Cotizave no está configurado: falta COTIZAVE_API_KEY");
    }
    if (!this.breaker.canRequest()) {
      throw new Error("El circuit breaker de la tasa está abierto");
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const result = await this.fetchOnce(date);
        this.breaker.recordSuccess();
        return result;
      } catch (error) {
        lastError = error;
      }
    }

    // Un fallo por solicitud: los reintentos internos no inflan el contador.
    this.breaker.recordFailure();
    throw lastError instanceof Error ? lastError : new Error("La fuente de la tasa falló");
  }

  private async fetchOnce(date: string): Promise<ProviderRate> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let payload: CotizavePayload;
    try {
      const response = await this.fetchImpl(this.url, {
        signal: controller.signal,
        headers: { accept: "application/json", "x-api-key": this.apiKey },
      });
      if (!response.ok) {
        throw new Error(`Cotizave respondió ${response.status}`);
      }
      payload = (await response.json()) as CotizavePayload;
    } finally {
      clearTimeout(timer);
    }

    const rates: unknown[] = Array.isArray(payload.rates) ? payload.rates : [];
    const row = rates.find(
      (item): item is CotizaveRate =>
        typeof item === "object" &&
        item !== null &&
        (item as { id?: unknown }).id === COTIZAVE_BCV_ID,
    );
    if (!row) {
      throw new Error(`Cotizave no devolvió la tasa ${COTIZAVE_BCV_ID}`);
    }

    const raw = row.mid;
    const text =
      typeof raw === "string" ? raw.trim() : typeof raw === "number" ? raw.toString() : "";
    // `parseRateText` lanza si el valor no es un decimal válido: se trata como
    // fallo del proveedor y entra el respaldo.
    const rate = parseRateText(text);
    return { rate, valueDate: this.valueDateOf(row, date) };
  }

  /** `effective_date`, o el día de `updated_at` en Caracas, o la fecha pedida. */
  private valueDateOf(row: CotizaveRate, requested: string): string {
    const effective = dateText(row.effective_date);
    if (effective) return effective;

    if (typeof row.updated_at === "string") {
      const parsed = new Date(row.updated_at);
      if (!Number.isNaN(parsed.getTime())) return todayInCaracas(parsed);
    }

    return requested;
  }
}

/** Fecha calendario `YYYY-MM-DD` válida o `undefined`. */
function dateText(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10) === value ? value : undefined;
}
