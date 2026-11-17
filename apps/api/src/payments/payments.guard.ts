import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "better-auth/plugins/access";
import { adminRole, agentRole, ownerRole } from "../access.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import {
  activeMembershipOf,
  activeOrganizationRequired,
  type ActiveMembershipRequest,
} from "../tenant/active-membership.js";
import { isPlatformRole } from "../tenant/tenant-context.js";

/**
 * Guard de pagos (T-F1-9, specs/payments "Creación de pago", "Modo de
 * aprobación" y auth-access).
 *
 * Corre después del guard global: la sesión ya está verificada y, en las rutas
 * /admin, el TOTP ya se exigió a los roles administrativos. Aquí se declara el
 * tipo de acceso de cada ruta:
 * - `self`: solo exige sesión; la propiedad de la reserva la comprueba el
 *   servicio (pagar y consultar los pagos de una reserva propia).
 * - `read`: agencia activa con `payment:read` (owner, admin o agent); el Super
 *   Admin sin agencia puede consultar todas las agencias.
 * - `review`: agencia activa con `payment:review` (solo owner/admin); el Super
 *   Admin sin agencia NO revisa pagos.
 *
 * Sin agencia y sin rol de plataforma responde 403
 * `ACTIVE_ORGANIZATION_REQUIRED`. El revisor distinto del pagador y la
 * propiedad de la fila son reglas del servicio: el permiso por sí solo no las
 * autoriza.
 */

export type PaymentAccess = "self" | "read" | "review";

/** Clave de metadata del decorador @PaymentPermission. */
export const PAYMENT_ACCESS_KEY = "caribe:payment-access";

/** Declara el acceso que exige un handler de pagos. */
export const PaymentPermission = (access: PaymentAccess) =>
  SetMetadata(PAYMENT_ACCESS_KEY, access);

export interface PaymentActor {
  /** Agencia activa; `null` para el Super Admin de plataforma o el acceso propio. */
  tenantId: string | null;
  userId: string;
  membershipRole: "owner" | "admin" | "agent" | null;
  isPlatform: boolean;
}

/** Lo mínimo que el guard y los controllers necesitan de la petición. */
export interface PaymentsRequest extends ActiveMembershipRequest {
  ip?: string;
  session?: {
    session: { activeOrganizationId?: string | null };
    user: { id: string; role?: string | string[] | null };
  };
  paymentActor?: PaymentActor;
}

const AGENCY_PAYMENT_ROLES: Record<string, Role> = {
  owner: ownerRole,
  admin: adminRole,
  agent: agentRole,
};

@Injectable()
export class PaymentsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PaymentsRequest>();
    const session = request.session;
    if (!session) {
      throw new ApiProblemException("UNAUTHENTICATED", "La solicitud requiere una sesión.");
    }

    const access = this.reflector.get<PaymentAccess>(PAYMENT_ACCESS_KEY, context.getHandler());
    if (!access) {
      // Fallo cerrado: una ruta de pagos sin acceso declarado no autoriza.
      throw forbidden("La ruta no declara un acceso de pago.");
    }

    // Incluso en `self` se valida la agencia activa: una sesión con una
    // membresía revocada no es una sesión de cliente válida.
    const membership = await activeMembershipOf(request);
    if (access === "self") {
      // El servicio comprueba que la reserva es del usuario; aquí solo se
      // exige la sesión que ya verificó el guard global.
      request.paymentActor = {
        tenantId: null,
        userId: session.user.id,
        membershipRole: null,
        isPlatform: false,
      };
      return true;
    }

    if (membership) {
      const organizationId = membership.organizationId;
      const role = AGENCY_PAYMENT_ROLES[membership.role];
      const action = access === "review" ? "review" : "read";
      if (!role || !role.authorize({ payment: [action] }).success) {
        throw forbidden(
          access === "review"
            ? "Tu rol no puede revisar pagos."
            : "Tu rol no puede consultar pagos.",
        );
      }

      request.paymentActor = {
        tenantId: organizationId,
        userId: session.user.id,
        membershipRole: membership.role as PaymentActor["membershipRole"],
        isPlatform: false,
      };
      return true;
    }

    if (isPlatformRole(session.user.role)) {
      if (access === "review") {
        throw forbidden("El Super Admin no revisa pagos.");
      }
      request.paymentActor = {
        tenantId: null,
        userId: session.user.id,
        membershipRole: null,
        isPlatform: true,
      };
      return true;
    }

    throw activeOrganizationRequired();
  }
}

/** El guard siempre deja `paymentActor`; sin él sería un fallo de cableado. */
export function paymentActorOf(request: PaymentsRequest): PaymentActor {
  if (!request.paymentActor) {
    throw new Error("PaymentsGuard no fijó el actor de pagos");
  }
  return request.paymentActor;
}

function forbidden(detail: string): ApiProblemException {
  return new ApiProblemException("FORBIDDEN", detail);
}
