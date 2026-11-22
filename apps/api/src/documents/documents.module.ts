import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { apiConfig } from "../config.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { BookingDocumentsController } from "./booking-documents.controller.js";
import { DocumentDownloadService } from "./document-download.service.js";
import { DocumentIssuanceService } from "./document-issuance.service.js";
import { DocumentListService } from "./document-list.service.js";
import { DocumentRenderingService } from "./document-rendering.service.js";
import { DocumentsController } from "./documents.controller.js";
import { ensureDocumentsDirectory } from "./documents-directory.js";
import { FreeFormReceiptProvider } from "./free-form-receipt.provider.js";
import { INVOICE_PROVIDER } from "./invoice-provider.js";

/**
 * Prepara el almacenamiento local antes de servir peticiones. Si el directorio
 * no se puede crear o escribir, el arranque falla (spec documents, caso
 * límite de "Almacenamiento y descarga").
 */
@Injectable()
class DocumentsDirectoryInitializer implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await ensureDocumentsDirectory(apiConfig.documentsDir);
  }
}

@Module({
  imports: [TenantModule],
  providers: [
    DocumentsDirectoryInitializer,
    DocumentListService,
    DocumentDownloadService,
    DocumentIssuanceService,
    DocumentRenderingService,
    {
      provide: INVOICE_PROVIDER,
      useFactory: () => new FreeFormReceiptProvider({ documentsDir: apiConfig.documentsDir }),
    },
  ],
  controllers: [DocumentsController, BookingDocumentsController],
  exports: [
    INVOICE_PROVIDER,
    DocumentListService,
    DocumentDownloadService,
    DocumentIssuanceService,
    DocumentRenderingService,
  ],
})
export class DocumentsModule {}
