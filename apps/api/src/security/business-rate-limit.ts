import { createHash } from "node:crypto";
import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { getStorageToken, type ThrottlerStorage } from "@nestjs/throttler";
import { resolveBusinessRateLimits } from "../config.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";

/** Identidad de la política asociada a un handler por el decorador propio. */
export const BUSINESS_RATE_LIMIT = Symbol("caribe:business-rate-limit");

export type BusinessRateLimitPolicy =
  | "bookings"
  | "payments"
  | "paymentReviews"
  | "downloads";

/**
 * Marca una ruta de negocio con su política de límite. No usa `@Throttle`
 * directamente: el guard de la librería aplicaría TODAS las políticas
 * configuradas a TODAS las rutas, y queremos contadores independientes solo en
 * estas cuatro operaciones. El almacenamiento sí es el de `@nestjs/throttler`.
 */
export function BusinessRateLimit(policy: BusinessRateLimitPolicy): MethodDecorator {
  return (_target, _propertyKey, descriptor) => {
    Reflect.defineMetadata(BUSINESS_RATE_LIMIT, policy, descriptor.value as object);
    return descriptor;
  };
}

interface RateLimitRequest {
  ip?: string | null;
  session?: { user?: { id?: string } } | null;
}

interface RateLimitResponse {
  setHeader?(name: string, value: string | number): void;
}

/**
 * Límite por IP real (o, si no hay IP resoluble, por actor autenticado) de las
 * rutas que mutan reservas/pagos y de las descargas (T-F2-4, spec security).
 *
 * El guard corre antes que los handlers, así que una petición rechazada no
 * abre transacción, no bloquea cupo, no cambia estados y no escribe auditoría.
 * La clave es un hash de `política:identidad`: ni la IP ni la ruta aparecen en
 * el Problema Details, y approve/reject comparten el cupo de «revisión».
 */
@Injectable()
export class BusinessRateLimitGuard implements CanActivate {
  constructor(@Inject(getStorageToken()) private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = Reflect.getMetadata(
      BUSINESS_RATE_LIMIT,
      context.getHandler(),
    ) as BusinessRateLimitPolicy | undefined;
    if (!policy) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<RateLimitRequest>();
    const response = http.getResponse<RateLimitResponse>();
    const tracker = this.trackerOf(request);
    // Sin IP ni sesión no hay identidad fiable: nunca agrupamos a clientes
    // desconocidos en un bucket compartido.
    if (!tracker) return true;

    const limits = resolveBusinessRateLimits();
    const key = createHash("sha256").update(`${policy}:${tracker}`).digest("hex");
    const { isBlocked, timeToBlockExpire } = await this.storage.increment(
      key,
      limits.windowSeconds * 1_000,
      limits[policy],
      0,
      policy,
    );
    if (!isBlocked) return true;

    response.setHeader?.("Retry-After", Math.max(1, timeToBlockExpire));
    throw new ApiProblemException(
      "RATE_LIMITED",
      "Demasiadas peticiones. Intenta de nuevo más tarde.",
    );
  }

  private trackerOf(request: RateLimitRequest): string | null {
    if (typeof request.ip === "string" && request.ip.length > 0) return `ip:${request.ip}`;
    const userId = request.session?.user?.id;
    return typeof userId === "string" && userId.length > 0 ? `user:${userId}` : null;
  }
}
