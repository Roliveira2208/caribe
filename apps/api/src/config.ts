import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { API_PORT } from "@caribe/shared";

/**
 * Directorio local de los PDF (T-F1-11, spec documents "Almacenamiento y
 * descarga"). Sin variable configurada se usa el directorio temporal del
 * sistema: nunca una ruta dentro del repositorio, que no debe contener PDFs.
 */
export function resolveDocumentsDir(value: string | undefined): string {
  const configured = value?.trim();
  const dir = configured && configured.length > 0 ? configured : resolve(tmpdir(), "caribe-documents");
  return isAbsolute(dir) ? resolve(dir) : resolve(process.cwd(), dir);
}

/** Origen de la URL absoluta que codifica el QR del voucher. */
export function resolveWebBaseUrl(value: string | undefined): string {
  const configured = value?.trim();
  const url = configured && configured.length > 0 ? configured : "http://localhost:3000";
  return url.replace(/\/+$/, "");
}

export const apiConfig = {
  port: API_PORT,
  basePath: "/api/v1",
  documentsDir: resolveDocumentsDir(process.env.DOCUMENTS_DIR),
  webBaseUrl: resolveWebBaseUrl(process.env.WEB_URL),
} as const;
