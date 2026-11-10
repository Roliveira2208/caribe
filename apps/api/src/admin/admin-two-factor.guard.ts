import { ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";
import { AuthGuard } from "@thallesp/nestjs-better-auth";
import { auth } from "../auth.js";
import { prisma } from "../prisma.js";
import { isPlatformRole } from "../tenant/tenant-context.js";
import {
  AGENCY_ADMIN_ROLES,
  AUTH_METADATA_KEYS,
  isAdminRoute,
  mergeRoutePermissions,
  registeredRoutePath,
  type RouteSecurity,
} from "./admin-route.js";

/** Codigo de aplicacion del 403 que activa la pantalla de TOTP (spec auth-access). */
export const TWO_FACTOR_REQUIRED = "TWO_FACTOR_REQUIRED";

/**
 * Lo minimo que el guard necesita de la sesion (estructural, como
 * SessionTenantInfo del tenant module): la sesion real de Better Auth es
 * asignable a esta forma.
 */
interface SessionInfo {
  session: { activeOrganizationId?: string | null };
  user: { id: string; role?: string | string[] | null; twoFactorEnabled?: boolean | null };
}

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
 * Nest), por lo que siempre es accesible.
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

    const memberRole = await this.activeMemberRole(session);
    const isAdminLevel =
      isPlatformRole(session.user.role) ||
      (memberRole !== undefined && AGENCY_ADMIN_ROLES.includes(memberRole));
    if (!isAdminLevel) return;

    throw new ForbiddenException({
      statusCode: 403,
      code: TWO_FACTOR_REQUIRED,
      message: "Activa el segundo factor (TOTP) antes de usar los endpoints administrativos",
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

  /**
   * Rol de la membresia activa. Better Auth 1.7.18 no expone API de servidor
   * para el rol del miembro activo (la lib cae en undefined), asi que se lee
   * el registro member: la organizacion activa la verifico Better Auth al
   * fijarla y la membresia activa solo puede ser una por agencia.
   */
  private async activeMemberRole(session: SessionInfo): Promise<string | undefined> {
    const organizationId = session.session.activeOrganizationId;
    if (!organizationId) return undefined;
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, organizationId },
      select: { role: true },
    });
    return member?.role;
  }
}
