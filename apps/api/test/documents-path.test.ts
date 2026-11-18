import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INVALID_PATH_DETAIL,
  resolveDocumentPath,
  validateDocumentFileUrl,
} from "../src/documents/document-path.js";

/**
 * Protección de ruta (T-F1-11a, spec documents "Ruta manipulada").
 *
 * `file_url` la genera el servidor, pero se valida de nuevo al descargar:
 * cualquier `..`, ruta absoluta, esquema de URL o barra invertida se rechaza
 * antes de abrir un archivo. Esto cubre tanto un valor manipulado en la BD
 * como un parámetro de consulta malicioso.
 */
describe("ruta de archivos de documentos", () => {
  const root = resolve(join(process.cwd(), "tmp-documents-root"));
  const uuid = "4f3c1a52-8b7d-4c10-9f2e-6a5b4d3c2e1f";
  const valid = `vouchers/${uuid}.pdf`;

  it("acepta una ruta relativa generada por el servidor", () => {
    expect(() => validateDocumentFileUrl(valid)).not.toThrow();
    expect(resolveDocumentPath(root, valid)).toBe(join(root, valid));
  });

  it("acepta subcarpetas por tipo y un nombre de UUID", () => {
    expect(resolveDocumentPath(root, `receipts/${uuid}.pdf`)).toBe(
      join(root, `receipts/${uuid}.pdf`),
    );
  });

  it.each([
    ["traversal simple", "../secrets.txt"],
    ["traversal con prefijo", "vouchers/../../secrets.txt"],
    ["ruta absoluta POSIX", "/etc/passwd"],
    ["ruta absoluta de Windows", "C:\\secret\\x.pdf"],
    ["barra invertida", "vouchers\\..\\secrets.pdf"],
    ["esquema http", "http://example.com/x.pdf"],
    ["esquema file", "file:///etc/passwd"],
    ["punto suelto", "vouchers/./x.pdf"],
    ["barra duplicada", "vouchers//x.pdf"],
    ["vacía", ""],
    ["NUL", `vouchers/${uuid}\u0000.pdf`],
  ])("rechaza %s", (_name, fileUrl) => {
    expect(() => validateDocumentFileUrl(fileUrl)).toThrow(INVALID_PATH_DETAIL);
    expect(() => resolveDocumentPath(root, fileUrl)).toThrow(INVALID_PATH_DETAIL);
  });

  it("el error de ruta es 400 INVALID_PATH", () => {
    try {
      validateDocumentFileUrl("../secrets.txt");
      expect.unreachable("debía rechazar la ruta");
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_PATH" });
      expect((error as { getStatus?: () => number }).getStatus?.()).toBe(400);
    }
  });
});
