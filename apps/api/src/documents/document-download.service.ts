import { Injectable, Logger } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { apiConfig } from "../config.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { TenantService } from "../tenant/tenant.service.js";
import type { DocumentActor } from "./documents.guard.js";
import { resolveDocumentPath } from "./document-path.js";

/** PDF listo para entregar, con el nombre de descarga calculado por el servidor. */
export interface DownloadedDocument {
  file: Buffer;
  fileName: string;
}

/**
 * Descarga autenticada (T-F1-11e, spec documents "Almacenamiento y descarga"
 * e "Idempotencia y unicidad del documento").
 *
 * La propiedad se comprueba con RLS: el dueño abre un contexto `owner` y el
 * personal de la agencia, `tenant+owner`. Lo que no ve la política no existe
 * (404). La ruta se valida ANTES de leer; una cadena manipulada nunca llega al
 * disco. El nombre del archivo adjunto se construye a partir del tipo y número
 * del documento, nunca del código de reserva ni de datos personales.
 */
@Injectable()
export class DocumentDownloadService {
  private readonly logger = new Logger(DocumentDownloadService.name);

  constructor(private readonly tenants: TenantService) {}

  async download(actor: DocumentActor, documentId: string): Promise<DownloadedDocument> {
    const tenantId = actor.tenantId;
    const document = tenantId
      ? await this.tenants.withOwnerTenant(actor.userId, tenantId, (tx) =>
          tx.document.findFirst({
            where: {
              id: documentId,
              OR: [
                { tenantId },
                { booking: { userId: actor.userId } },
              ],
            },
            select: {
              type: true,
              number: true,
              status: true,
              fileUrl: true,
            },
          }),
        )
      : await this.tenants.withOwner(actor.userId, (tx) =>
          tx.document.findFirst({
            where: { id: documentId, booking: { userId: actor.userId } },
            select: {
              type: true,
              number: true,
              status: true,
              fileUrl: true,
            },
          }),
        );

    if (!document) {
      throw new ApiProblemException("NOT_FOUND", "El documento no existe.");
    }
    if (document.status === "PENDING") {
      throw new ApiProblemException(
        "DOCUMENT_PENDING",
        "El documento se está generando; inténtalo de nuevo en unos segundos.",
      );
    }
    if (document.status === "FAILED" || !document.fileUrl) {
      throw new ApiProblemException(
        "DOCUMENT_UNAVAILABLE",
        "El documento no está disponible.",
      );
    }

    // Defensa en profundidad: un file_url manipulado en la BD se rechaza sin
    // abrir ningún archivo (spec documents, "Ruta manipulada").
    const path = resolveDocumentPath(apiConfig.documentsDir, document.fileUrl);
    try {
      const file = await readFile(path);
      return { file, fileName: this.fileNameOf(document.type, document.number) };
    } catch (error) {
      this.logger.warn(`No se pudo leer el documento ${documentId}: ${String(error)}`);
      throw new ApiProblemException(
        "DOCUMENT_UNAVAILABLE",
        "El documento no está disponible.",
      );
    }
  }

  /** F1 solo emite voucher y comprobante; la nota de reembolso queda para F2. */
  private fileNameOf(type: string, number: number): string {
    const prefix =
      type === "VOUCHER" ? "voucher" : type === "RECEIPT" ? "comprobante" : "documento";
    return `${prefix}-${number}.pdf`;
  }
}
