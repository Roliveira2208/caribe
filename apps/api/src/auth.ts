import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {
  APIError,
  createAuthMiddleware,
  getIP,
  getSessionFromCtx,
} from "better-auth/api";
import { admin, organization, twoFactor } from "better-auth/plugins";
import { Logger } from "@nestjs/common";
import { TWO_FACTOR_REQUIRED } from "@caribe/shared";
import { betterAuthAdminRouteOf, targetOrganizationIdOf, tenantOrganizationIdOf, type BetterAuthPreState } from "./admin/admin-route.js";
import { TWO_FACTOR_REQUIRED_MESSAGE, isAdminLevelSession, type AdminSessionInfo } from "./admin/admin-session.js";
import {
  authEventWriteRouteOf,
  beginAuthEvent,
  finishAuthEvent,
} from "./audit/auth-event-hooks.js";
import type { AuditEntry } from "./audit/audit.service.js";
import { AuditService } from "./audit/audit.service.js";
import {
  accessControl,
  adminRole,
  agentRole,
  memberRole,
  ownerRole,
  providerRole,
  superAdminRole,
  systemUserRole,
} from "./access.js";
import { requiredEnv } from "./env.js";
import { prisma } from "./prisma.js";
import { CotizaveProvider } from "./rates/cotizave.provider.js";
import { ExchangeRateService } from "./rates/exchange-rate.service.js";
import { RateCache } from "./rates/rate-cache.js";
import { TenantService } from "./tenant/tenant.service.js";

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
 * - Hooks before/after (fix de la verificacion f0-foundations, deltas de
 *   auth-access y audit): las rutas administrativas del middleware de Better
 *   Auth (/api/auth/admin/* y las escrituras administrativas de
 *   /api/auth/organization/*) exigen TOTP para roles administrativos igual
 *   que el guard de Nest (mismo orden: antes de validar el cuerpo y de
 *   comprobar permisos), y sus escrituras confirmadas dejan fila en
 *   audit_logs. La clasificacion de rutas vive en admin-route.ts.
 */

/** Estado previo por peticion: el hook before lo guarda para el after. */
const betterAuthPreStates = new WeakMap<object, BetterAuthPreState>();

/**
 * Escritura de la fila de auditoria de una escritura de Better Auth (delta de
 * audit): en transaccion propia con el GUC RLS de la accion, porque el
 * middleware no puede unirse a la transaccion interna de la lib. Los
 * servicios no tienen dependencias, se instancian directos fuera de Nest.
 */
const tenantService = new TenantService();
const auditService = new AuditService();

/**
 * Refresco perezoso de la tasa global (T-F1-5b): el hook de creación de sesión
 * no puede depender del contenedor de Nest, así que el servicio se instancia
 * la primera vez que se usa. La caché es solo en memoria (el login no abre
 * Redis) y la comprobación de "hoy" vive en la base.
 */
let rateRefreshService: ExchangeRateService | null = null;
const rateRefreshLogger = new Logger("ExchangeRateRefresh");

function ensureTodayRateInBackground(): void {
  rateRefreshService ??= new ExchangeRateService(
    tenantService,
    new CotizaveProvider(),
    new RateCache(undefined),
  );
  void rateRefreshService.ensureTodayRate().catch((error: unknown) => {
    rateRefreshLogger.warn(
      `El refresco de la tasa al iniciar sesión falló: ${
        error instanceof Error ? error.message : "error desconocido"
      }`,
    );
  });
}

async function recordBetterAuthAudit(entry: AuditEntry): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tenantService.bindContext(
      entry.tenantId === null ? { kind: "platform" } : { kind: "tenant", tenantId: entry.tenantId },
      tx,
    );
    await auditService.record(tx, entry);
  });
}

export const auth = betterAuth({
  appName: "Caribe",
  baseURL: requiredEnv("BETTER_AUTH_URL"),
  secret: requiredEnv("BETTER_AUTH_SECRET"),
  trustedOrigins: (process.env["TRUSTED_ORIGINS"] ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  /**
   * Refresco perezoso de la tasa global al crear la sesión (T-F1-5b): se
   * lanza en segundo plano para que el login no espere al proveedor ni falle
   * si Cotizave está caído. La comprobación de "una vez al día" y el respaldo
   * viven en `ensureTodayRate()`.
   */
  databaseHooks: {
    session: {
      create: {
        after: () => {
          ensureTodayRateInBackground();
          return Promise.resolve();
        },
      },
    },
  },
  // En pruebas el alta de usuarios es una acción de sistema (auth-helpers y
  // seed) y no debe crear una sesión: así el refresco perezoso de la tasa se
  // dispara con el login real y no al sembrar fixtures.
  emailAndPassword: { enabled: true, autoSignIn: process.env.NODE_ENV !== "test" },
  // Idioma del usuario para avisos y documentos (T-F1-1a, design.md §2.1).
  // Campo adicional de Better Auth, no una tabla propia: la lib lo escribe en
  // user.locale y el CLI oficial lo refleja en schema.prisma. `es` por defecto
  // (la columna tambien lo trae) y `en` soportado; el respaldo al leer es `es`.
  user: {
    additionalFields: {
      locale: {
        type: "string",
        required: false,
        defaultValue: "es",
        input: true,
      },
    },
  },
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
  hooks: {
    /**
     * 403 TWO_FACTOR_REQUIRED para roles administrativos sin TOTP en las
     * rutas administrativas del middleware. Los demas casos pasan: sin sesion
     * HTTP es una accion de sistema (seed, auth.api), y los roles no
     * administrativos reciben el 403 normal de permisos de la lib.
     *
     * Corre antes de la validacion del cuerpo y de los permisos, igual que el
     * guard de Nest: un admin sin TOTP recibe el codigo de aplicacion aunque
     * el cuerpo sea invalido, para que la UI lo lleve a la activacion.
     */
    before: createAuthMiddleware(async (ctx) => {
      const route = betterAuthAdminRouteOf(ctx.path);
      if (!route) return;

      const session = await getSessionFromCtx(ctx);
      if (!session) return;

      // T-F1-0b: las escrituras administrativas dejan fila de intento ANTES
      // de validar el cuerpo y el TOTP. Si la escritura del intento falla, el
      // hook lanza y la accion no se ejecuta (fallo cerrado).
      const writeRoute = authEventWriteRouteOf(ctx.path);
      if (writeRoute) {
        await beginAuthEvent(ctx, writeRoute, session as AdminSessionInfo);
      }

      try {
        // getSessionFromCtx tipa la sesion con los tipos base de la lib (sin
        // las props que anaden los plugins, como activeOrganizationId); la
        // sesion real si la trae, igual que la que ve el guard de Nest.
        //
        // En las escrituras de organizacion la clasificacion usa la agencia
        // objetivo (B3 del segundo informe): la del cuerpo o la query, o la
        // activa si no viene. Sin objetivo determinable la sesion falla cerrada
        // si es administrativa en cualquier agencia; en las rutas que no aceptan
        // organizationId (cancel-invitation, create) el resolver devuelve null
        // y tampoco vale la activa: el cuerpo no puede librar del TOTP.
        const targetOrganizationId =
          route.authorization === "organization"
            ? targetOrganizationIdOf(
                route.targetOrganization,
                ctx.body as Record<string, unknown> | undefined,
                ctx.query as Record<string, unknown> | undefined,
                session.session.activeOrganizationId,
              )
            : undefined;
        if (
          !session.user.twoFactorEnabled &&
          (await isAdminLevelSession(session as AdminSessionInfo, targetOrganizationId))
        ) {
          throw new APIError("FORBIDDEN", {
            code: TWO_FACTOR_REQUIRED,
            message: TWO_FACTOR_REQUIRED_MESSAGE,
          });
        }

        // revoke-user-session: la fila de session se borra al ejecutar la
        // accion, asi que el antes se guarda aqui para poder auditar despues.
        if (route.audit?.preState === "session-by-token") {
          const token = (ctx.body as Record<string, unknown> | undefined)?.["sessionToken"];
          if (typeof token === "string") {
            const revoked = await prisma.session.findUnique({
              where: { token },
              select: { id: true, userId: true },
            });
            if (revoked) {
              betterAuthPreStates.set(ctx.context, { sessionId: revoked.id, userId: revoked.userId });
            }
          }
        }
      } catch (error) {
        // El hook after no corre si before lanza: el rechazo (TOTP) o el fallo
        // del before escriben aqui su fila de resultado.
        if (writeRoute) {
          await finishAuthEvent(ctx, error, betterAuthPreStates.get(ctx.context));
        }
        throw error;
      }
    }),
    /**
     * Resultado del intento (T-F1-0b) y fila de auditoria de las escrituras
     * administrativas confirmadas (delta de audit). El resultado se escribe
     * primero y en su propia transaccion; si falla, el fallo va al log y la
     * accion ya confirmada se mantiene. La fila de audit_logs solo se escribe
     * en 2xx (los APIError llegan como instancia de Error) y solo con sesion
     * (las acciones de sistema por auth.api las audita su llamador, si le
     * toca).
     */
    after: createAuthMiddleware(async (ctx) => {
      const route = betterAuthAdminRouteOf(ctx.path);
      const pre = betterAuthPreStates.get(ctx.context);
      if (authEventWriteRouteOf(ctx.path)) {
        await finishAuthEvent(
          ctx,
          ctx.context.returned instanceof Error ? ctx.context.returned : undefined,
          pre,
        );
      }

      const audit = route?.audit;
      if (!audit) return;

      const returned = ctx.context.returned;
      if (returned instanceof Error) return;
      const session = await getSessionFromCtx(ctx);
      if (!session) return;

      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const returnedRecord =
        typeof returned === "object" && returned !== null ? (returned as Record<string, unknown>) : {};
      if (audit.preState === "session-by-token" && !pre) return;

      const entityId = audit.entityIdOf(returnedRecord, body, pre);
      if (entityId === undefined) {
        ctx.context.logger.error(
          `auditoría de ${ctx.path}: la regla no encontró el identificador de la entidad`,
        );
        return;
      }
      const tenantId = audit.platform
        ? null
        : tenantOrganizationIdOf(
            audit.entity,
            returnedRecord,
            body,
            ctx.query as Record<string, unknown> | undefined,
            session.session.activeOrganizationId,
            // En las rutas "unknown" (cancel-invitation) el cuerpo no puede
            // imputar la fila: la lib lo ignora y un organizationId ajeno
            // desviaria la auditoria a otra agencia (T-F0-19).
            route?.targetOrganization,
          );
      if (tenantId === undefined) {
        ctx.context.logger.error(`auditoría de ${ctx.path}: sin agencia a la que imputar la fila`);
        return;
      }

      try {
        await recordBetterAuthAudit({
          tenantId,
          actorId: session.user.id,
          action: audit.action,
          entity: audit.entity,
          entityId,
          before: null,
          after: audit.afterOf ? audit.afterOf(returnedRecord, body, pre) : returnedRecord,
          ip: ctx.request ? getIP(ctx.request, ctx.context.options) : null,
        });
      } catch (error) {
        ctx.context.logger.error(`auditoría de ${ctx.path}: la escritura de la fila falló`, error);
      }
    }),
  },
  plugins: [
    // Matriz T-F0-6 (src/access.ts). organization() mezcla estos roles con
    // sus defaults: member se neutraliza con permisos vacios y las agencias
    // solo se crean como accion de sistema (userId, sin sesion), nunca por
    // HTTP desde una sesion de usuario.
    organization({
      ac: accessControl,
      roles: {
        owner: ownerRole,
        admin: adminRole,
        agent: agentRole,
        provider: providerRole,
        member: memberRole,
      },
      creatorRole: "owner",
      allowUserToCreateOrganization: false,
    }),
    // admin() REEMPLAZA sus defaults al recibir roles: el rol de sistema
    // "admin" desaparece; quedan user (Cliente, sin permisos) y super_admin.
    admin({
      defaultRole: "user",
      adminRoles: ["super_admin"],
      roles: { user: systemUserRole, super_admin: superAdminRole },
    }),
    twoFactor({ issuer: "Caribe" }),
  ],
});
