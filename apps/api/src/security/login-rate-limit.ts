import { ApiProblemException } from "../errors/api-problem.exception.js";
import {
  problemOf,
  writeProblem,
  type ProblemRequest,
  type ProblemResponse,
} from "../errors/problem-details.filter.js";

/**
 * Límite de inicio de sesión con la IP resuelta por `clientIpMiddleware`
 * (T-F2-2, spec security). Better Auth ya traía un contador, pero respondía
 * JSON propio y, sin un proxy de confianza, agrupaba a todos los clientes en
 * un bucket compartido. Este middleware corre antes que el handler de Better
 * Auth, usa la misma ventana y el mismo umbral y devuelve Problem Details.
 */
export interface LoginRateLimit {
  /** Ventana en segundos (la misma que consume Better Auth). */
  windowSeconds: number;
  /** Intentos permitidos por IP dentro de la ventana. */
  max: number;
}

const SIGN_IN_PATH = "/api/auth/sign-in/email";
const DETAIL = "Demasiados intentos de inicio de sesión. Intenta de nuevo más tarde.";

interface LimitRequest extends ProblemRequest {
  ip?: string | null;
}

/** Contador en memoria por IP: se reinicia con el proceso, igual que el de la lib. */
export function createLoginRateLimiter(limit: LoginRateLimit) {
  const attempts = new Map<string, number[]>();
  const windowMs = limit.windowSeconds * 1_000;

  return (request: LimitRequest, response: ProblemResponse, next: () => void): void => {
    const path = request.originalUrl?.split("?")[0] ?? request.url ?? request.path;
    if (request.method !== "POST" || path !== SIGN_IN_PATH) {
      next();
      return;
    }

    const now = Date.now();
    // Una IP no resuelta tiene su propia clave: nunca el bucket global de la
    // librería ni el contador de otro cliente.
    const key = request.ip ?? "sin-ip";
    const recent = (attempts.get(key) ?? []).filter((at) => now - at < windowMs);

    if (recent.length >= limit.max) {
      attempts.set(key, recent);
      const problem = problemOf(new ApiProblemException("RATE_LIMITED", DETAIL), request);
      writeProblem(response, problem);
      return;
    }

    recent.push(now);
    attempts.set(key, recent);
    next();
  };
}
