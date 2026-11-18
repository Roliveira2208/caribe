import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Prepara el directorio local de PDFs al arrancar (T-F1-11, caso límite de
 * "Almacenamiento y descarga"): lo crea si no existe y comprueba de verdad que
 * se puede escribir, no solo que el permiso lo diga. Si falla, la API no
 * arranca en vez de emitir documentos `READY` sin archivo detrás.
 */
export async function ensureDocumentsDirectory(dir: string): Promise<void> {
  const root = resolve(dir);
  try {
    await mkdir(root, { recursive: true });
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error("la ruta no es un directorio");
    await access(root, constants.R_OK | constants.W_OK);

    const probe = resolve(root, `.write-probe-${randomUUID()}`);
    await writeFile(probe, "", { flag: "wx" });
    await unlink(probe);
  } catch (cause) {
    throw new Error(
      `No se puede usar el directorio de documentos "${root}": ${String(cause)}`,
      { cause },
    );
  }
}
