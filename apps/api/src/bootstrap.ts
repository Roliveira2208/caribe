// reflect-metadata debe evaluarse antes que cualquier modulo con decoradores
// de NestJS; este archivo es el unico punto de arranque (main y tests).
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { apiConfig } from "./config.js";
import {
  problemOf,
  writeProblem,
  type ProblemRequest,
  type ProblemResponse,
} from "./errors/problem-details.filter.js";

/** Lo minimo que el puente necesita de la app de Express subyacente. */
interface ExpressInstance {
  use(handler: ExpressErrorHandler): void;
}

type ExpressNext = (error?: unknown) => void;
type ExpressErrorHandler = (
  error: unknown,
  request: ProblemRequest,
  response: ProblemResponse,
  next: ExpressNext,
) => void;

/**
 * Crea la aplicacion de NestJS. main.ts y los tests e2e comparten esta
 * funcion para probar exactamente lo mismo que corre en produccion.
 */
export async function createApp() {
  // bodyParser: false: Better Auth lee el cuerpo crudo de /api/auth/*
  // (la integracion re-agrega los parsers para el resto de las rutas).
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Negocio versionado en /api/v1; Better Auth queda en /api/auth (D15 y
  // spec auth-access: "Better Auth queda fuera del versionado /api/v1").
  app.setGlobalPrefix(apiConfig.basePath);
  app.enableShutdownHooks();

  // Inicializa rutas y middleware antes de anadir el manejador de errores:
  // Express solo alcanza un error handler registrado DESPUES del middleware
  // que falla. listen() vuelve a llamar a init() y no repite el trabajo.
  await app.init();
  registerBodyParserErrors(app.getHttpAdapter().getInstance() as ExpressInstance);

  return app;
}

/**
 * Puente de los errores de middleware a Problem Details (T-F1-0c).
 *
 * Los parsers de cuerpo los registra la integracion de Better Auth como
 * middleware de Nest; un JSON invalido o un cuerpo demasiado grande llega
 * por `next(error)` y no por el pipeline de rutas, asi que el filtro global
 * no lo ve. Sin este puente Express responderia con su HTML por defecto.
 * Las rutas /api/auth conservan el formato de Better Auth.
 */
function registerBodyParserErrors(express: ExpressInstance): void {
  const handler: ExpressErrorHandler = (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const path = request.originalUrl ?? request.url ?? request.path ?? "";
    if (path === "/api/auth" || path.startsWith("/api/auth/")) {
      next(error);
      return;
    }
    writeProblem(response, problemOf(error, request), error);
  };
  express.use(handler);
}

/** Tipo de la app creada por createApp (para main y tests). */
export type ApiApplication = Awaited<ReturnType<typeof createApp>>;
