import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { activeMembershipOf, type ActiveMembershipRequest } from "./active-membership.js";

/**
 * Guard de la agencia activa: resuelve y cachea la membresía vigente antes de
 * los guards de cada familia. Con `activeOrganizationId` revocado responde 403
 * `ACTIVE_ORGANIZATION_REQUIRED` y ningún handler llega a abrir RLS con esa
 * agencia. Sin agencia activa deja pasar (los guards de familia deciden si la
 * ruta admite plataforma o cliente).
 */
@Injectable()
export class ActiveMembershipGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ActiveMembershipRequest>();
    if (!request.session) {
      throw new ApiProblemException("UNAUTHENTICATED", "La solicitud requiere una sesión.");
    }
    await activeMembershipOf(request);
    return true;
  }
}
