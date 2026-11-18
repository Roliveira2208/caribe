import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { apiConfig } from "../config.js";
import { ensureDocumentsDirectory } from "./documents-directory.js";

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
  providers: [DocumentsDirectoryInitializer],
})
export class DocumentsModule {}
