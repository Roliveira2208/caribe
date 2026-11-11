import { ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";
import { AuthGuard } from "@thallesp/nestjs-better-auth";
import { TWO_FACTOR_REQUIRED } from "@caribe/shared";
import { auth } from "../auth.js";
import {
  AUTH_METADATA_KEYS,
  isAdminRoute,
  mergeRoutePermissions,
  registeredRoutePath,
  type RouteSecurity,
} from "./admin-route.js";
import { TWO_FACTOR_REQUIRED_MESSAGE, isAdminLevelSession } from "./admin-session.js";

interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Guard global de segundo factor (T-F0-8): extiende el AuthGuard de la lib
 * (app.module pasa disableGlobalAuthGuard: true, asi que esta subclase es el
 * unico guard global) y anade, ANTES de los checks estandar, la exigencia de
 * TOTP en rutas administrativas.
 *
 * El orden es deliberado: el check de 2FA va primero para que un rol
 * administrativo sin TOTP reciba siempre TWO_FACTOR_REQUIRED (p.ej. un
 * super_admin sin el permiso de agencia de la ruta) y la interfaz pueda
 * llevarlo a la pantalla de activacion en vez de a un 403 opaco.
 *
 * Regla (delta de auth-access): owner/admin/super_admin sin TOTP activo que
 * llama a una ruta administrativa recibe 403 TWO_FACTOR_REQUIRED. Los roles
 * no administrativos siguen el flujo normal (el AuthGuard responde 401/403
 * por permisos), las rutas no administrativas quedan fuera del check y la
 * activacion vive en /api/auth/* (middleware de Better Auth, sin guards de
 * Nest, con sus propios hooks desde el fix de la verificacion
 * f0-foundations), por lo que siempre es accesible.
 */
@Injectable()
export class AdminTwoFactorGuard extends AuthGuard {
  constructor(private readonly twoFactorReflector: Reflector) {
    // super() necesita la instancia de Better Auth: el mismo singleton que
    // AuthModule.forRoot recibe en app.module (el guard solo usa
    // options.auth.api).
    super(twoFactorReflector, { auth });
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() === "http") {
      await this.requireTwoFactorForAdminRoute(context);
    }
    return super.canActivate(context);
  }

  /**
   * 403 TWO_FACTOR_REQUIRED para roles administrativos sin TOTP en rutas
   * administrativas. Los demas casos pasan: sin sesion responde 401 el
   * AuthGuard, y los roles no administrativos reciben su 403 normal.
   */
  private async requireTwoFactorForAdminRoute(context: ExecutionContext): Promise<void> {
    if (!isAdminRoute(this.routeSecurityOf(context))) return;

    const request = context.switchToHttp().getRequest<HttpRequest>();
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session || session.user.twoFactorEnabled) return;

    if (!(await isAdminLevelSession(session))) return;

    throw new ForbiddenException({
      statusCode: 403,
      code: TWO_FACTOR_REQUIRED,
      message: TWO_FACTOR_REQUIRED_MESSAGE,
    });
  }

  /** Clasifica la ruta actual con su metadata registrada (funcion pura). */
  private routeSecurityOf(context: ExecutionContext): RouteSecurity {
    const handler = context.getHandler();
    const controller = context.getClass();
    return {
      path: registeredRoutePath(controller, handler),
      permissions: mergeRoutePermissions(
        this.twoFactorReflector.getAllAndOverride(AUTH_METADATA_KEYS.userHasPermission, [
          handler,
          controller,
        ]),
        this.twoFactorReflector.getAllAndOverride(AUTH_METADATA_KEYS.memberHasPermission, [
          handler,
          controller,
        ]),
      ),
      systemRoles: this.twoFactorReflector.getAllAndOverride<string[] | undefined>(
        AUTH_METADATA_KEYS.systemRoles,
        [handler, controller],
      ),
      orgRoles: this.twoFactorReflector.getAllAndOverride<string[] | undefined>(
        AUTH_METADATA_KEYS.orgRoles,
        [handler, controller],
      ),
    };
  }
}
