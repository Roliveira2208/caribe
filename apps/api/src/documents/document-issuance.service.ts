import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma, type Document } from "../generated/prisma/client.js";
import { TenantService } from "../tenant/tenant.service.js";
import type { DocumentTypeValue } from "./invoice-provider.js";

/** Datos mínimos para reservar un documento dentro de una transacción. */
export interface ReserveDocumentInput {
  tenantId: string;
  bookingId: string;
  paymentId?: string;
  type: DocumentTypeValue;
}

/** Fila reservada, tal como la necesita el renderizado posterior. */
export interface ReservedDocument {
  id: string;
  tenantId: string;
  bookingId: string;
  paymentId: string | null;
  type: DocumentTypeValue;
  number: number;
  status: "PENDING" | "READY" | "FAILED";
  fileUrl: string | null;
  language: "ES" | "EN";
}

/**
 * Reserva la fila `PENDING` del documento en la MISMA transacción que confirma
 * la reserva o aprueba el pago (T-F1-11c, spec documents "Ciclo de vida" y
 * "Numeración correlativa").
 *
 * El contador por agencia y tipo se bloquea con `FOR UPDATE` antes de mirar si
 * ya existe el documento: dos emisiones concurrentes de la misma entidad
 * esperan, la segunda ve la fila ya creada y no consume número. Dos emisiones
 * distintas obtienen números consecutivos sin huecos, porque el incremento y
 * el `INSERT` se confirman juntos.
 */
@Injectable()
export class DocumentIssuanceService {
  constructor(private readonly tenants: TenantService) {}

  /** Cómplice para trabajos y pruebas: abre el contexto `tenant` y delega. */
  async reserveForTenant(
    tenantId: string,
    input: ReserveDocumentInput,
  ): Promise<ReservedDocument> {
    return this.tenants.withTenant(tenantId, (tx) => this.reserve(tx, input));
  }

  /** Reserva usando una transacción de negocio ya abierta y con GUC de tenant. */
  async reserve(
    tx: Prisma.TransactionClient,
    input: ReserveDocumentInput,
  ): Promise<ReservedDocument> {
    if (input.tenantId.length === 0) throw new Error("La reserva de documentos requiere agencia");
    if (input.type === "RECEIPT" && !input.paymentId) {
      throw new Error("Un comprobante requiere el pago aprobado");
    }
    if (input.type === "VOUCHER" && input.paymentId) {
      throw new Error("Un voucher no lleva pago");
    }

    // La fila del contador puede no existir todavía (primera emisión).
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "document_counters" ("tenant_id", "type", "next_value")
      VALUES (${input.tenantId}, ${input.type}::"DocumentType", 1)
      ON CONFLICT ("tenant_id", "type") DO NOTHING
    `);

    const locked = await tx.$queryRaw<Array<{ next_value: number }>>(Prisma.sql`
      SELECT "next_value"
        FROM "document_counters"
       WHERE "tenant_id" = ${input.tenantId}
         AND "type" = ${input.type}::"DocumentType"
       FOR UPDATE
    `);
    if (!locked[0]) throw new Error("No se pudo bloquear el contador de documentos");

    // Bajo el bloqueo, una emisión repetida encuentra la fila anterior y la
    // devuelve sin gastar un número.
    const existing = await tx.document.findFirst({
      where:
        input.type === "RECEIPT"
          ? { tenantId: input.tenantId, paymentId: input.paymentId!, type: input.type }
          : { tenantId: input.tenantId, bookingId: input.bookingId, type: input.type },
    });
    if (existing) return toReserved(existing);

    const consumed = await tx.$queryRaw<Array<{ number: number }>>(Prisma.sql`
      UPDATE "document_counters"
         SET "next_value" = "next_value" + 1
       WHERE "tenant_id" = ${input.tenantId}
         AND "type" = ${input.type}::"DocumentType"
      RETURNING "next_value" - 1 AS "number"
    `);
    const number = consumed[0]?.number;
    if (number === undefined) throw new Error("No se pudo asignar el número de documento");

    const document = await tx.document.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        bookingId: input.bookingId,
        paymentId: input.paymentId ?? null,
        type: input.type,
        number,
        status: "PENDING",
        language: "ES",
      },
    });
    return toReserved(document);
  }
}

function toReserved(document: Document): ReservedDocument {
  // F1 solo emite voucher y comprobante; la nota de reembolso queda para F2.
  // Este guardián estrecha el enum de Prisma al contrato del proveedor sin
  // casts: si algún día se reserva un REFUND_NOTE, falla aquí y no en el PDF.
  if (document.type === "REFUND_NOTE") {
    throw new Error("Las notas de reembolso no se emiten en F1");
  }
  return {
    id: document.id,
    tenantId: document.tenantId,
    bookingId: document.bookingId,
    paymentId: document.paymentId,
    type: document.type,
    number: document.number,
    status: document.status,
    fileUrl: document.fileUrl,
    language: document.language,
  };
}
