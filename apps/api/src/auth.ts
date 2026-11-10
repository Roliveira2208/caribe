import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, organization, twoFactor } from "better-auth/plugins";
import { requiredEnv } from "./env.js";
import { prisma } from "./prisma.js";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Instancia unica de Better Auth (D15). Las rutas se montan en /api/auth/*
 * a traves de AuthModule de @thallesp/nestjs-better-auth; el resto de la API
 * queda protegido por su guard global salvo @AllowAnonymous.
 *
 * - El secreto solo viene de BETTER_AUTH_SECRET (nunca en codigo).
 * - Cookies httpOnly + SameSite=Lax por defecto de Better Auth; Secure solo
 *   fuera de desarrollo (advanced.useSecureCookies).
 * - Rate limit activo siempre (por defecto solo aplica en produccion), mas
 *   estricto en login, registro y recuperacion de contrasena. La IP del
 *   cliente: en desarrollo/test Better Auth la resuelve como 127.0.0.1; en
 *   produccion, detras del proxy del hosting, habra que fijar
 *   advanced.ipAddress.trustedProxies (pregunta abierta de hosting). Sin IP
 *   conocida usa un bucket compartido por ruta y lo avisa en el log.
 */
export const auth = betterAuth({
  appName: "OTA Venezuela",
  baseURL: requiredEnv("BETTER_AUTH_URL"),
  secret: requiredEnv("BETTER_AUTH_SECRET"),
  trustedOrigins: (process.env["TRUSTED_ORIGINS"] ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  advanced: { useSecureCookies: isProduction },
  rateLimit: {
    // Activo siempre (por defecto Better Auth solo lo aplica en produccion).
    // Las rutas de customRules son relativas al basePath de Better Auth.
    enabled: true,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/forget-password": { window: 60, max: 5 },
    },
  },
  plugins: [
    organization(),
    // El plugin admin va con sus valores por defecto en F0: rol de sistema
    // "admin" y alta como "user" (= Cliente de la spec). T-F0-6 sustituye
    // esto por la matriz real de roles/permisos con createAccessControl.
    admin(),
    twoFactor({ issuer: "OTA Venezuela" }),
  ],
});
