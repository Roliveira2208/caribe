import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { TenantService } from "../tenant/tenant.service.js";
import type { DocumentActor } from "./documents.guard.js";

/** Documento que el cliente o la agencia pueden descubrir para descargar. */
export interface BookingDocumentView {
  id: string;
  type: "VOUCHER" | "RECEIPT" | "REFUND_NOTE";
  number: number;
  status: "PENDING" | "READY" | "FAILED";
  issuedAt: string | null;
  /** Solo existe mientras el PDF está listo; nunca es la ruta del archivo. */
  downloadPath: string | null;
}

export interface BookingDocumentsResponse {
  items: BookingDocumentView[];
}

/**
 * Listado de documentos de una reserva (spec documents, "Listado autenticado
 * de documentos de una reserva"). La propiedad se resuelve en dos contextos:
 * dueño primero, agencia después. Así una persona con membresía en otra agencia
 * sigue viendo sus propios documentos.
 */
@Injectable()
export class DocumentListService {
  constructor(private readonly tenants: TenantService) {}

  async list(actor: DocumentActor, bookingId: string): Promise<BookingDocumentsResponse> {
    const own = await this.tenants.withOwner(actor.userId, (tx) =>
      tx.booking.findFirst({
        where: { id: bookingId, userId: actor.userId },
        select: { id: true },
      }),
    );
    if (own) {
      return {
        items: (
          await this.tenants.withOwner(actor.userId, (tx) => this.findDocuments(tx, bookingId))
        ).map(toView),
      };
    }

    const tenantId = actor.tenantId;
    if (tenantId) {
      const agency = await this.tenants.withTenant(tenantId, (tx) =>
        tx.booking.findFirst({
          where: { id: bookingId, tenantId },
          select: { id: true },
        }),
      );
      if (agency) {
        return {
          items: (
            await this.tenants.withTenant(tenantId, (tx) => this.findDocuments(tx, bookingId))
          ).map(toView),
        };
      }
    }

    throw new ApiProblemException("NOT_FOUND", "La reserva no existe.");
  }

  private findDocuments(tx: Prisma.TransactionClient, bookingId: string) {
    return tx.document.findMany({
      where: { bookingId },
      select: { id: true, type: true, number: true, status: true, issuedAt: true },
      orderBy: [{ type: "asc" }, { number: "asc" }],
    });
  }
}

type DocumentRow = {
  id: string;
  type: "VOUCHER" | "RECEIPT" | "REFUND_NOTE";
  number: number;
  status: "PENDING" | "READY" | "FAILED";
  issuedAt: Date | null;
};

function toView(row: DocumentRow): BookingDocumentView {
  return {
    id: row.id,
    type: row.type,
    number: row.number,
    status: row.status,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    downloadPath: row.status === "READY" ? `/api/v1/documents/${row.id}/download` : null,
  };
}
