// reflect-metadata debe evaluarse antes que cualquier modulo con decoradores
// de NestJS; este archivo es el unico punto de arranque (main y tests).
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { apiConfig } from "./config.js";

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
  return app;
}

/** Tipo de la app creada por createApp (para main y tests). */
export type ApiApplication = Awaited<ReturnType<typeof createApp>>;
