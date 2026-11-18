import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveDocumentsDir,
  resolveWebBaseUrl,
} from "../src/config.js";
import { ensureDocumentsDirectory } from "../src/documents/documents-directory.js";

/**
 * Configuración del almacenamiento local de documentos (T-F1-11a).
 *
 * Sin `DOCUMENTS_DIR` se usa un directorio temporal del sistema, nunca una
 * ruta dentro del repositorio. Si la ruta configurada existe pero no es un
 * directorio escribible, el arranque debe fallar en vez de dejar documentos
 * `READY` sin archivo.
 */
describe("configuración de documentos", () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("usa un directorio temporal fuera del repositorio si no se configura nada", () => {
    const dir = resolveDocumentsDir(undefined);
    expect(resolve(dir)).toBe(dir);
    expect(dir.startsWith(resolve(process.cwd()))).toBe(false);
    expect(dir).toContain("caribe-documents");
  });

  it("respeta DOCUMENTS_DIR y recorta espacios", () => {
    const dir = resolveDocumentsDir(`  ${join(tmpdir(), `caribe-doc-${randomUUID()}`)}  `);
    expect(resolve(dir)).toBe(dir);
    expect(dir).toContain("caribe-doc-");
  });

  it("la URL base de la web es absoluta y no termina en barra", () => {
    expect(resolveWebBaseUrl(undefined)).toBe("http://localhost:3000");
    expect(resolveWebBaseUrl("https://caribe.example/")).toBe("https://caribe.example");
    expect(resolveWebBaseUrl("  ")).toBe("http://localhost:3000");
  });

  it("crea el directorio y comprueba que se puede escribir", async () => {
    const base = await mkdtemp(join(tmpdir(), "caribe-docs-ok-"));
    created.push(base);
    const dir = join(base, "pdf");

    await expect(ensureDocumentsDirectory(dir)).resolves.toBeUndefined();
    await expect(ensureDocumentsDirectory(dir)).resolves.toBeUndefined();
  });

  it("falla al arrancar si la ruta configurada es un archivo", async () => {
    const base = await mkdtemp(join(tmpdir(), "caribe-docs-bad-"));
    created.push(base);
    const file = join(base, "not-a-directory");
    await writeFile(file, "ocupado", "utf8");

    await expect(ensureDocumentsDirectory(file)).rejects.toThrow(/documentos/i);
  });
});
