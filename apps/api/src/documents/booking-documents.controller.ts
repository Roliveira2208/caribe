import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import {
  DocumentPermission,
  DocumentsGuard,
  documentActorOf,
  type DocumentsRequest,
} from "./documents.guard.js";
import {
  DocumentListService,
  type BookingDocumentsResponse,
} from "./document-list.service.js";

/**
 * Descubrimiento de los documentos de una reserva (spec documents,
 * "Listado autenticado de documentos de una reserva"). No expone archivos ni
 * rutas de disco: entrega solo la ruta autenticada de descarga de cada PDF.
 */
@Controller("bookings/:id/documents")
@UseGuards(DocumentsGuard)
export class BookingDocumentsController {
  constructor(private readonly list: DocumentListService) {}

  @Get()
  @DocumentPermission("download")
  listForBooking(
    @Req() request: DocumentsRequest,
    @Param("id") bookingId: string,
  ): Promise<BookingDocumentsResponse> {
    return this.list.list(documentActorOf(request), bookingId);
  }
}
