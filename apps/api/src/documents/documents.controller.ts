import { Controller, Get, Param, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { DocumentDownloadService } from "./document-download.service.js";
import {
  DocumentPermission,
  DocumentsGuard,
  documentActorOf,
  type DocumentsRequest,
} from "./documents.guard.js";

/**
 * Descarga de documentos (T-F1-11e, spec documents "Almacenamiento y descarga").
 *
 * Una única ruta autenticada: /api/v1/documents/:id/download. No se sirve el
 * archivo desde una URL pública ni se expone `file_url`; el servidor resuelve
 * el id, comprueba propiedad/agencia y devuelve el PDF como adjunto.
 */
@Controller("documents")
@UseGuards(DocumentsGuard)
export class DocumentsController {
  constructor(private readonly downloads: DocumentDownloadService) {}

  @Get(":id/download")
  @DocumentPermission("download")
  async download(
    @Req() request: DocumentsRequest,
    @Param("id") documentId: string,
  ): Promise<StreamableFile> {
    const { file, fileName } = await this.downloads.download(
      documentActorOf(request),
      documentId,
    );
    return new StreamableFile(file, {
      type: "application/pdf",
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
