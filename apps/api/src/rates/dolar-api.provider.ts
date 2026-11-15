import { parseRateText, todayInCaracas, type ExchangeRateProvider, type ProviderRate } from "@caribe/shared";
import { CircuitBreaker } from "./circuit-breaker.js";

/** URL pública del dólar oficial del BCV en DolarAPI. */
export const DOLAR_API_DEFAULT_URL = "https://ve.dolarapi.com/v1/dolares/oficial";

export interface DolarApiProviderOptions {
  url?: string;
  /** Tiempo máximo por intento; la spec fija 5 s. */
  timeoutMs?: number;
  /** Reintentos tras el primer intento (la spec pide uno). */
  retries?: number;
  breaker?: CircuitBreaker;
  fetchImpl?: typeof fetch;
}

/** Forma mínima de la respuesta de DolarAPI que consume el proveedor. */
interface DolarApiPayload {
  promedio?: unknown;
  rate?: unknown;
  value?: unknown;
  fechaActualizacion?: unknown;
}

/**
 * Proveedor primario de la tasa oficial (T-F1-5, design §6).
 *
 * Cada llamada tiene un timeout de 5 s y un reintento; el circuit breaker
 * corta las llamadas tras 3 fallos consecutivos durante 60 s. La tasa se
 * recibe como número o texto y se valida como decimal > 0 con ≤ 4 decimales:
 * un valor inválido es un fallo del proveedor. Si la fuente informa
 * `fechaActualizacion`, se usa su fecha en America/Caracas como `value_date`
 * (un feriado devuelve la del último día hábil).
 */
export class DolarApiProvider implements ExchangeRateProvider {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly breaker: CircuitBreaker;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DolarApiProviderOptions = {}) {
    this.url = options.url ?? process.env.DOLARAPI_URL ?? DOLAR_API_DEFAULT_URL;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.retries = options.retries ?? 1;
    this.breaker = options.breaker ?? new CircuitBreaker();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getRate(date: string): Promise<ProviderRate> {
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
    let payload: DolarApiPayload;
    try {
      const response = await this.fetchImpl(this.url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`La fuente de la tasa respondió ${response.status}`);
      }
      payload = (await response.json()) as DolarApiPayload;
    } finally {
      clearTimeout(timer);
    }

    const raw = payload.promedio ?? payload.rate ?? payload.value;
    const text =
      typeof raw === "string" ? raw.trim() : typeof raw === "number" ? raw.toString() : "";
    // `parseRateText` lanza si el valor no es un decimal válido: se trata como
    // fallo del proveedor y entra el respaldo.
    const rate = parseRateText(text);

    const valueDate = this.publishedDate(payload.fechaActualizacion) ?? date;
    return { rate, valueDate };
  }

  /** Fecha de publicación en Caracas; `undefined` si no es una fecha válida. */
  private publishedDate(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return todayInCaracas(parsed);
  }
}
