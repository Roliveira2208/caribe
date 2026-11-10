import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "../generated/prisma/client.js";

/**
 * Lo que el handler de una ruta auditable aporta a la fila: el identificador
 * de la entidad afectada y sus estados antes y despues (spec audit, escenario
 * "Admin aprueba un pago"). Actor, IP y fecha no van aqui: el interceptor
 * los toma de la sesion y del servidor.
 */
export interface AuditAttachment {
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Almacen por peticion de las rutas auditables: la transaccion que el
 * interceptor abre (la MISMA de la operacion y de la auditoria, casos
 * limites de la spec audit) y el attachment del handler.
 */
export interface AuditStorage {
  tx?: Prisma.TransactionClient;
  attachment?: AuditAttachment;
}

export const auditStorage = new AsyncLocalStorage<AuditStorage>();

/**
 * Lo llama el handler de una ruta @Auditable para aportar entityId y los
 * estados antes/despues. Fuera del interceptor falla ruidoso: es un error de
 * cableado, no algo que silenciar.
 */
export function attachAuditData(attachment: AuditAttachment): void {
  const store = auditStorage.getStore();
  if (!store) {
    throw new Error("attachAuditData solo se llama dentro de una ruta @Auditable");
  }
  store.attachment = attachment;
}

/**
 * Transaccion de la ruta auditable en curso: operacion y auditoria comparten
 * esta transaccion, asi que escribir aqui es escribir con la garantia de la
 * spec (si la auditoria falla, la operacion no se confirma).
 */
export function currentAuditTx(): Prisma.TransactionClient {
  const tx = auditStorage.getStore()?.tx;
  if (!tx) {
    throw new Error("currentAuditTx solo se llama dentro de una ruta @Auditable");
  }
  return tx;
}
