import { randomUUID } from "node:crypto";
import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import {
  API_ERROR_STATUS,
  API_ERROR_TITLES,
  isApiErrorCode,
  problemType,
  type ApiErrorCode,
  type ProblemDetails,
  type ValidationIssue,
} from "@caribe/shared";
import { ApiProblemException } from "./api-problem.exception.js";

/** Lo minimo que el filtro necesita de la peticion (Express). */
export interface ProblemRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  path?: string;
}

/** Lo minimo que el filtro necesita de la respuesta (Express). */
export interface ProblemResponse {
  status(code: number): ProblemResponse;
  type(value: string): ProblemResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  headersSent?: boolean;
}

/**
 * Filtro global de errores (spec api-errors): todo error de `/api/v1/*` sale
 * como `application/problem+json` con `type`, `title`, `status`, `detail`,
 * `instance` y un `code` de la tabla.
 *
 * Las rutas de `/api/auth/*` no pasan por aqui: Better Auth es middleware y
 * conserva su formato (TWO_FACTOR_REQUIRED es la excepcion documentada).
 *
 * Un 500 nunca devuelve mensaje interno, traza ni SQL: el detalle queda en el
 * log con un identificador de correlacion que viaja en el cuerpo y en la
 * cabecera X-Correlation-Id.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ProblemRequest>();
    const response = http.getResponse<ProblemResponse>();
    writeProblem(response, problemOf(exception, request), exception);
  }
}

/**
 * Escribe un Problem Details en la respuesta y deja el detalle interno en el
 * log solo cuando el fallo es inesperado (5xx).
 *
 * Tambien lo usa el manejador de errores de Express de `bootstrap` para los
 * fallos que ocurren en middleware (cuerpo JSON invalido o demasiado grande):
 * esos errores no pasan por el pipeline de Nest y sin este puente saldrian
 * con el formato HTML de Express.
 */
export function writeProblem(
  response: ProblemResponse,
  problem: ProblemDetails,
  exception?: unknown,
): void {
  if (problem.status >= 500) {
    const logger = new Logger(ProblemDetailsFilter.name);
    logger.error(
      `[${problem.correlationId ?? "sin-correlacion"}] ${problem.instance}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
  }

  response.status(problem.status);
  // Express agrega charset=utf-8 al Content-Type.
  response.type("application/problem+json");
  if (problem.correlationId) {
    response.setHeader("X-Correlation-Id", problem.correlationId);
  }
  response.json(problem);
}

/**
 * Construye el Problem Details de una excepcion. Es una funcion pura para
 * poder probarla sin levantar la app.
 *
 * Orden: excepcion de dominio (su codigo manda) -> HttpException con `code`
 * propio (p. ej. TWO_FACTOR_REQUIRED) -> estado HTTP de Nest traducido a la
 * tabla -> error inesperado (500 INTERNAL_ERROR).
 */
export function problemOf(exception: unknown, request: ProblemRequest): ProblemDetails {
  const instance = instanceOf(request);

  if (exception instanceof ApiProblemException) {
    return buildProblem(exception.code, exception.detail, instance, exception.issues);
  }

  if (exception instanceof HttpException) {
    const body = exception.getResponse();
    const explicit = explicitCodeOf(body);
    if (explicit) {
      return buildProblem(explicit.code, explicit.detail, instance, explicit.issues);
    }
    const status = exception.getStatus();
    const code = codeForStatus(status);
    if (code) return buildProblem(code, detailForStatus(status), instance);
    return internalProblem(instance);
  }

  // Errores de body-parser (JSON invalido, cuerpo demasiado grande) no son
  // HttpException pero traen status. No se copia su mensaje: puede contener
  // fragmentos del cuerpo.
  const status = statusOf(exception);
  const code = status === null ? null : codeForStatus(status);
  if (status !== null && code) {
    return buildProblem(code, detailForStatus(status), instance);
  }

  return internalProblem(instance);
}

/** Estado HTTP de un error con forma de body-parser; null si no lo es. */
function statusOf(exception: unknown): number | null {
  if (typeof exception !== "object" || exception === null) return null;
  const record = exception as { status?: unknown; statusCode?: unknown };
  for (const value of [record.status, record.statusCode]) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599) {
      return value;
    }
  }
  return null;
}

/** Traduce el estado de una HttpException sin codigo propio a la tabla. */
export function codeForStatus(status: number): ApiErrorCode | null {
  switch (status) {
    case 400:
    case 422:
      // Nest usa 400 para validaciones manuales; el contrato las expone 422.
      return "VALIDATION_ERROR";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 405:
      return "METHOD_NOT_ALLOWED";
    case 409:
      return "CONFLICT";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 429:
      return "RATE_LIMITED";
    case 500:
      return "INTERNAL_ERROR";
    default:
      return null;
  }
}

/** Mensaje publico y fijo por estado; nunca el mensaje interno de Nest. */
function detailForStatus(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return "La solicitud no es válida.";
    case 401:
      return "La solicitud requiere una sesión.";
    case 403:
      return "No tienes permiso para esta operación.";
    case 404:
      return "El recurso no existe.";
    case 405:
      return "El método HTTP no está permitido para esta ruta.";
    case 409:
      return "La operación entra en conflicto con el estado actual.";
    case 413:
      return "El cuerpo de la solicitud es demasiado grande.";
    case 429:
      return "Demasiadas peticiones. Intenta de nuevo más tarde.";
    default:
      return "Ocurrió un error inesperado.";
  }
}

interface ExplicitCode {
  code: ApiErrorCode;
  detail: string;
  issues?: ValidationIssue[];
}

/**
 * Codigo propio que una excepcion trae en su cuerpo (guards de la API). Solo
 * se acepta un codigo de la tabla: un codigo inventado no se propaga.
 */
function explicitCodeOf(body: unknown): ExplicitCode | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const code = record["code"];
  if (!isApiErrorCode(code)) return null;

  const detail =
    typeof record["detail"] === "string"
      ? record["detail"]
      : typeof record["message"] === "string"
        ? record["message"]
        : detailForStatus(API_ERROR_STATUS[code]);

  return { code, detail, issues: validationIssuesOf(record["errors"]) };
}

/** Copia solo `{ path, message }`; descarta cualquier otro campo (valores). */
function validationIssuesOf(value: unknown): ValidationIssue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const issues: ValidationIssue[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const path = record["path"];
    const message = record["message"];
    if (typeof path === "string" && typeof message === "string") {
      issues.push({ path, message });
    }
  }
  return issues.length > 0 ? issues : undefined;
}

function buildProblem(
  code: ApiErrorCode,
  detail: string,
  instance: string,
  issues?: ValidationIssue[],
): ProblemDetails {
  const problem: ProblemDetails = {
    type: problemType(code),
    title: API_ERROR_TITLES[code],
    status: API_ERROR_STATUS[code],
    detail,
    instance,
    code,
  };
  if (issues && issues.length > 0) problem.errors = issues;
  if (code === "INTERNAL_ERROR") problem.correlationId = randomUUID();
  return problem;
}

function internalProblem(instance: string): ProblemDetails {
  return buildProblem(
    "INTERNAL_ERROR",
    "Ocurrió un error inesperado.",
    instance,
  );
}

/** Ruta de la peticion sin query string ni datos de sesion. */
function instanceOf(request: ProblemRequest): string {
  const url = request.originalUrl ?? request.url ?? request.path ?? "";
  const queryIndex = url.indexOf("?");
  return queryIndex >= 0 ? url.slice(0, queryIndex) : url;
}
