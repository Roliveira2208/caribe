import { randomUUID } from "node:crypto";
import { Body, ConflictException, Controller, ForbiddenException, Post, Req } from "@nestjs/common";
import { z } from "@caribe/shared";
import { Auditable } from "../audit/auditable.js";
import { attachAuditData, currentAuditTx } from "../audit/audit-storage.js";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import { isPlatformRole } from "../tenant/tenant-context.js";

/** Lo minimo que el handler necesita de la sesion (estructural). */
interface SessionInfo {
  user: { id: string; role?: string | string[] | null };
}

interface AuthenticatedRequest {
  session?: SessionInfo;
}

/** Mismo formato de slug que usa Better Auth: minusculas, numeros y guiones. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Cuerpo estricto (T-F1-0c): solo `name` y `slug`. `actor_id`, `ip`, `at` y
 * cualquier otro campo calculado o desconocido responden 422 y no se usan:
 * actor, IP y fecha salen de la sesion verificada y del reloj del servidor.
 */
const createOrganizationSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().regex(SLUG_PATTERN),
});

type CreateOrganizationBody = z.infer<typeof createOrganizationSchema>;

/**
 * Creacion de agencias por la plataforma (T-F0-9, delta de audit: "Super
 * Admin crea una agencia"). Accion de plataforma: la fila de auditoria lleva
 * tenant_id NULL y se escribe en la MISMA transaccion que los INSERT.
 *
 * Replica los INSERT de createOrganization de Better Auth (organization +
 * member owner; id y createdAt no tienen default en BD, la lib los genera en
 * su capa) porque esa API usa su propia conexion y no puede entrar en
 * nuestra transaccion; el seed de T-F0-6b sienta el precedente. El creador
 * queda de owner (creatorRole). La gestion completa de agencias llega con su
 * spec en fases posteriores.
 */
@Controller("admin/organizations")
export class OrganizationsController {
  @Auditable({ action: "organization.create", entity: "organization", platform: true })
  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createOrganizationSchema)) body: CreateOrganizationBody,
  ) {
    const session = request.session;
    if (!session || !isPlatformRole(session.user.role)) {
      throw new ForbiddenException("Solo el rol de plataforma puede crear agencias");
    }

    const { name, slug } = body;

    const tx = currentAuditTx();
    const id = randomUUID();
    const createdAt = new Date();
    try {
      await tx.organization.create({ data: { id, name, slug, createdAt } });
      await tx.member.create({
        data: {
          id: randomUUID(),
          organizationId: id,
          userId: session.user.id,
          role: "owner",
          createdAt,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new ConflictException("El slug ya está en uso");
      }
      throw error;
    }

    attachAuditData({ entityId: id, before: null, after: { id, name, slug } });
    return { id, name, slug };
  }
}
