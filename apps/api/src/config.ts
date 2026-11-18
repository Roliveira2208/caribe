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

/** Configuración del único transporte de correo de F1 (spec notifications). */
export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

/** SMTP local por defecto (Mailpit): sin host configurado no se envía nada. */
export function resolveSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const port = Number.parseInt((env.SMTP_PORT ?? "").trim(), 10);
  return {
    host: env.SMTP_HOST?.trim() ?? "",
    port: Number.isFinite(port) && port > 0 ? port : 1025,
    user: env.SMTP_USER?.trim() ?? "",
    password: env.SMTP_PASSWORD ?? "",
    from: env.SMTP_FROM?.trim() || "Caribe <no-reply@example.com>",
  };
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
  smtp: resolveSmtpConfig(),
} as const;
