/**
 * Entrega local del CSV devuelto por la API. El archivo se crea en el navegador
 * a partir del `Blob` de la respuesta; nunca se calculan filas ni columnas aquí.
 */
export function saveCsvBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
