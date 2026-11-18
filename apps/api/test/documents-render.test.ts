import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FreeFormReceiptProvider,
  voucherQrUrl,
} from "../src/documents/free-form-receipt.provider.js";
import type { FrozenBooking, FrozenPayment } from "../src/documents/invoice-provider.js";

/**
 * Proveedor de comprobantes (T-F1-11b, spec documents "Voucher",
 * "Comprobante de pago", "QR sin datos personales" e "Impuestos").
 *
 * El proveedor recibe datos congelados: no consulta BD, no recalcula montos y
 * no interpreta el texto del usuario como plantilla. Todo se comprueba sobre
 * el PDF real y sobre el archivo escrito.
 */
/**
 * PDFKit escribe el texto como cadenas hexadecimales dentro de `TJ` y puede
 * partir una palabra en varias cadenas (p. ej. "P" + " AGO"). Se concatenan sin
 * separador para reconstruir los textos; los IDs hexadecanales del PDF producen
 * ruido inofensivo.
 */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  return [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map((match) => Buffer.from(match[1] ?? "", "hex").toString("latin1"))
    .join("");
}

describe("render de documentos", () => {
  let dir: string;
  let provider: FreeFormReceiptProvider;

  const code = "CAR-ABC-123";
  const documentId = randomUUID();

  const booking: FrozenBooking = {
    id: randomUUID(),
    code,
    tenantId: randomUUID(),
    totalUsd: "150.00",
    travelers: [
      {
        fullName: "NOMBRE_PLANO_<b>{{x}}</b> Pérez",
        documentType: "CI",
        documentNumber: "V-12345678",
        phone: "+58 412 1234567",
        email: "viajero@example.com",
      },
    ],
    items: [
      {
        hotelKey: "hotel-sol",
        roomType: "Habitación doble",
        title: { es: "Hotel Sol", en: "Sun Hotel" },
        checkIn: "2026-12-10",
        checkOut: "2026-12-12",
        quantity: 1,
        subtotalUsd: "150.00",
        policySnapshot: {
          policyId: "policy-1",
          name: "Flexible hasta 48 horas",
          rules: [{ hours_before: 48, percentage: 100 }],
        },
      },
    ],
    agency: {
      name: "Agencia Caribe",
      legalName: "Caribe Viajes C.A.",
      rif: "J-123456789",
      address: "Av. Principal 1",
      phone: "+58 212 1234567",
      email: "contacto@example.com",
    },
    document: { id: documentId, number: 42, type: "VOUCHER" },
    qrUrl: "https://caribe.example/reservas/CAR-ABC-123",
  };

  const payment: FrozenPayment = {
    method: "PAGO_MOVIL",
    amountUsd: "150.00",
    amountVes: "5432.1000",
    rate: "36.2140",
    valueDate: "2026-11-17",
    reference: "REF-998877",
    paidAt: "2026-11-17T15:00:00.000Z",
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "caribe-render-"));
    provider = new FreeFormReceiptProvider({ documentsDir: dir });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("el QR codifica solo la URL absoluta con el código de reserva", () => {
    expect(voucherQrUrl("https://caribe.example/", code)).toBe(
      "https://caribe.example/reservas/CAR-ABC-123",
    );
    const url = voucherQrUrl("https://caribe.example", code);
    expect(new URL(url).pathname).toBe("/reservas/CAR-ABC-123");
    expect(url).not.toContain("Pérez");
    expect(url).not.toContain("V-12345678");
    expect(new URL(url).search).toBe("");
    expect(new URL(url).hash).toBe("");
  });

  it("emite un voucher con leyenda,QR, datos congelados y nombre de archivo UUID", async () => {
    const issued = await provider.issue(booking);

    expect(issued).toMatchObject({ type: "VOUCHER", number: 42 });
    expect(issued.fileUrl).toMatch(/^vouchers\/[0-9a-f-]{36}\.pdf$/);
    expect(issued.fileUrl).toContain(documentId);
    expect(issued.fileUrl).not.toContain(code);
    // La regex anterior ya garantiza que el nombre es el UUID del documento,
    // no el número correlativo. Buscar "42" dentro de un UUID daría falsos
    // positivos cuando los caracteres del UUID formen esa secuencia.

    const pdf = await readFile(join(dir, issued.fileUrl));
    const text = pdfText(pdf);
    const raw = pdf.toString("latin1");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(text).toContain("Documento no fiscal");
    expect(text).toContain(code);
    expect(text).toContain("NOMBRE_PLANO_");
    expect(text).toContain("Hotel Sol");
    expect(text).toContain("Flexible hasta 48 horas");
    expect(text).toContain("Caribe Viajes C.A.");
    expect(text).toContain("J-123456789");
    // El QR se incrusta como imagen; no como datos del viajero.
    expect(raw).toContain("/Image");
    expect(text).not.toContain(voucherQrUrl("https://caribe.example", code));
  });

  it("emite un comprobante con número, tasa congelada, VES y referencia", async () => {
    const receipt: FrozenBooking = {
      ...booking,
      document: { id: randomUUID(), number: 41, type: "RECEIPT" },
    };
    const issued = await provider.issue(receipt, payment);
    const text = pdfText(await readFile(join(dir, issued.fileUrl)));

    expect(issued.fileUrl).toMatch(/^receipts\/[0-9a-f-]{36}\.pdf$/);
    expect(text).toContain("Documento no fiscal");
    expect(text).toContain("41");
    expect(text).toContain("150.00");
    expect(text).toContain("36.2140");
    expect(text).toContain("2026-11-17");
    expect(text).toContain("5432.10");
    expect(text).toContain("PAGO_MOVIL");
    expect(text).toContain("REF-998877");
    // Las líneas de impuesto están desactivadas por defecto (spec "Impuestos").
    expect(text).not.toContain("Impuesto");
  });

  it("estampa la leyenda en todas las páginas", async () => {
    const manyItems = Array.from({ length: 28 }, (_unused, index) => ({
      ...booking.items[0]!,
      title: { es: `Hotel ${index}`, en: `Hotel ${index}` },
    }));
    const longBooking: FrozenBooking = {
      ...booking,
      document: { id: randomUUID(), number: 43, type: "RECEIPT" },
      items: manyItems,
    };

    const issued = await provider.issue(longBooking, payment);
    const pdf = await readFile(join(dir, issued.fileUrl));
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [];
    const legends = pdfText(pdf).match(/Documento no fiscal/g) ?? [];

    expect(pages.length).toBeGreaterThan(1);
    expect(legends.length).toBeGreaterThanOrEqual(pages.length);
  });
});
