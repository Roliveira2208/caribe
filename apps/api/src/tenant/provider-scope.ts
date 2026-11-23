import type { Prisma } from "../generated/prisma/client.js";

/**
 * Alcance de negocio del actor dentro de una agencia (F-FINAL-001).
 *
 * - `all`: owner/admin/agente conservan el acceso completo a la agencia.
 * - `provider`: solo las filas cuyo producto pertenece a su `provider_id`.
 * - `none`: rol proveedor sin fila en `providers`; no ve nada de la agencia.
 *
 * Se resuelve dentro de la transacción con el GUC del tenant para que la
 * búsqueda del registro quede cubierta por RLS.
 */
export type ProviderScope =
  | { kind: "all" }
  | { kind: "provider"; providerId: string }
  | { kind: "none" };

export async function providerScope(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string | null;
    membershipRole: string | null;
    userId: string;
  },
): Promise<ProviderScope> {
  if (input.membershipRole !== "provider") return { kind: "all" };
  if (!input.tenantId) return { kind: "none" };

  const provider = await tx.provider.findFirst({
    where: { tenantId: input.tenantId, userId: input.userId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return provider ? { kind: "provider", providerId: provider.id } : { kind: "none" };
}
