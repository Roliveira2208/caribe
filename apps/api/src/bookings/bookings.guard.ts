import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "better-auth/plugins/access";
import { adminRole, agentRole, ownerRole, providerRole } from "../access.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import {
  activeMembershipOf,
  type ActiveMembershipRequest,
} from "../tenant/active-membership.js";
import { isPlatformRole } from "../tenant/tenant-context.js";

/**
 * Guard de reservas (T-F1-10, specs/booking "Cancelación" y specs/auth-access
 * "Permisos sobre reservas y pagos").
 *
 * Corre después del guard global: la sesión ya está verificada. Aquí se
 * declara el tipo de acceso de cada ruta y se fija el actor que el servicio
 * usa para autorizar la fila:
 * - owner/admin con `booking:cancel`: cancela cualquier reserva de su agencia.
 * - agente: solo las propias (aunque su rol no tenga `booking:cancel`, el
 *   dueño decidió que puede cancelar como cliente).
 * - miembro sin rol de negocio: solo las propias.
 * - proveedor: 403; no cancela reservas.
 * - Super Admin sin agencia: 403 al cancelar; sí consulta (solo lectura).
 * - cliente sin agencia: solo las propias.
 *
 * Las rutas de lectura declaran `read`: con agencia activa solo pasan los roles
 * con `booking:read`; un `member` sin ese permiso recibe 403 en lugar de caer al
 * alcance de cliente (fallo cerrado, NUEVO-01).
 *
 * Sin agencia y sin rol de plataforma el actor es el cliente. La propiedad de
 * la fila la comprueba el servicio: una reserva ajena responde 404.
 */

export type BookingAccess = "read" | "cancel";

/** Clave de metadata del decorador @BookingPermission. */
export const BOOKING_ACCESS_KEY = "caribe:booking-access";

/** Declara el acceso que exige un handler de reservas. */
export const BookingPermission = (access: BookingAccess) =>
  SetMetadata(BOOKING_ACCESS_KEY, access);

export type MembershipRole = "owner" | "admin" | "agent" | "member" | "provider";

export interface BookingActor {
  /** Agencia activa; `null` para el cliente sin organización. */
  tenantId: string | null;
  userId: string;
  membershipRole: MembershipRole | null;
  /** owner/admin de la agencia activa: cancela cualquier reserva de la agencia. */
  canCancelAgency: boolean;
  isPlatform: boolean;
}

/** Lo mínimo que el guard y el controller necesitan de la petición. */
export interface BookingsRequest extends ActiveMembershipRequest {
  ip?: string;
  session?: {
    session: { activeOrganizationId?: string | null };
    user: { id: string; role?: string | string[] | null };
  };
  bookingActor?: BookingActor;
}

const AGENCY_BOOKING_ROLES: Record<string, Role> = {
  owner: ownerRole,
  admin: adminRole,
  agent: agentRole,
  provider: providerRole,
};

@Injectable()
export class BookingsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<BookingsRequest>();
    const session = request.session;
    if (!session) {
      throw new ApiProblemException("UNAUTHENTICATED", "La solicitud requiere una sesión.");
    }

    const access = this.reflector.get<BookingAccess>(BOOKING_ACCESS_KEY, context.getHandler());
    if (!access) {
      // Fallo cerrado: una ruta de reservas sin acceso declarado no autoriza.
      throw forbidden("La ruta no declara un acceso de reserva.");
    }

    const membership = await activeMembershipOf(request);
    if (membership) {
      const organizationId = membership.organizationId;
      const role = AGENCY_BOOKING_ROLES[membership.role];
      const canReadAgency = role?.authorize({ booking: ["read"] }).success === true;

      if (access === "read") {
        if (!canReadAgency) {
          throw forbidden("Tu rol no puede consultar reservas.");
        }
        request.bookingActor = {
          tenantId: organizationId,
          userId: session.user.id,
          membershipRole: membership.role as MembershipRole,
          canCancelAgency: membership.role === "owner" || membership.role === "admin",
          isPlatform: false,
        };
        return true;
      }

      if (membership.role === "owner" || membership.role === "admin") {
        if (!role || !role.authorize({ booking: ["cancel"] }).success) {
          throw forbidden("Tu rol no puede cancelar reservas.");
        }
        request.bookingActor = {
          tenantId: organizationId,
          userId: session.user.id,
          membershipRole: membership.role,
          canCancelAgency: true,
          isPlatform: false,
        };
        return true;
      }

      if (membership.role === "provider") {
        throw forbidden("El proveedor no cancela reservas.");
      }

      // Agente o miembro sin rol de negocio: solo las reservas propias.
      request.bookingActor = {
        tenantId: organizationId,
        userId: session.user.id,
        membershipRole: membership.role as MembershipRole,
        canCancelAgency: false,
        isPlatform: false,
      };
      return true;
    }

    if (isPlatformRole(session.user.role)) {
      if (access === "read") {
        request.bookingActor = {
          tenantId: null,
          userId: session.user.id,
          membershipRole: null,
          canCancelAgency: false,
          isPlatform: true,
        };
        return true;
      }
      throw forbidden("El Super Admin no cancela reservas.");
    }

    request.bookingActor = {
      tenantId: null,
      userId: session.user.id,
      membershipRole: null,
      canCancelAgency: false,
      isPlatform: false,
    };
    return true;
  }
}

/** El guard siempre deja `bookingActor`; sin él sería un fallo de cableado. */
export function bookingActorOf(request: BookingsRequest): BookingActor {
  if (!request.bookingActor) {
    throw new Error("BookingsGuard no fijó el actor de reservas");
  }
  return request.bookingActor;
}

function forbidden(detail: string): ApiProblemException {
  return new ApiProblemException("FORBIDDEN", detail);
}
