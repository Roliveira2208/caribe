import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { formatAmount, formatRate } from "@caribe/shared";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import {
  type FrozenBooking,
  type FrozenPayment,
  type InvoiceProvider,
  type IssuedDocument,
} from "./invoice-provider.js";

/** Texto exigido por la normativa del MVP en cada página (spec documents). */
export const FISCAL_LEGEND = "Documento no fiscal";

const MARGIN = 48;

/**
 * URL del QR del voucher: absoluta, con el código global de la reserva y sin
 * datos personales ni tokens. No lleva `search` ni `hash`.
 */
export function voucherQrUrl(webBaseUrl: string, bookingCode: string): string {
  return `${webBaseUrl.replace(/\/+$/, "")}/reservas/${encodeURIComponent(bookingCode)}`;
}

/**
 * Comprobante libre sin factura fiscal (design §9). Genera el PDF con PDFKit a
 * partir de la instantánea recibida: no abre transacciones, no relee productos
 * ni tasas y no interpreta el texto del viajero como HTML ni como plantilla.
 */
export class FreeFormReceiptProvider implements InvoiceProvider {
  constructor(private readonly options: { documentsDir: string }) {}

  async issue(booking: FrozenBooking, payment?: FrozenPayment): Promise<IssuedDocument> {
    const folder = booking.document.type === "VOUCHER" ? "vouchers" : "receipts";
    // El nombre lo decide el servidor con el UUID de la fila: nunca el código
    // de reserva, el número correlativo ni datos del viajero.
    const fileUrl = `${folder}/${booking.document.id}.pdf`;
    const target = join(this.options.documentsDir, folder, `${booking.document.id}.pdf`);
    await mkdir(dirname(target), { recursive: true });

    const qr =
      booking.document.type === "VOUCHER"
        ? await QRCode.toBuffer(booking.qrUrl, { type: "png", margin: 1, width: 110 })
        : null;

    // bufferPages mantiene todas las páginas para poder estampar la leyenda en
    // cada una al final, incluidos los saltos automáticos de PDFKit.
    const pdf = new PDFDocument({
      size: "A4",
      margin: MARGIN,
      compress: false,
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve, reject) => {
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);
    });

    this.draw(pdf, booking, payment, qr);
    this.stampLegendOnEveryPage(pdf);
    pdf.end();

    await writeFile(target, await finished);
    return {
      type: booking.document.type,
      number: booking.document.number,
      fileUrl,
      issuedAt: new Date(),
    };
  }

  private draw(
    pdf: PDFKit.PDFDocument,
    booking: FrozenBooking,
    payment: FrozenPayment | undefined,
    qr: Buffer | null,
  ): void {
    const agency = booking.agency;
    let y = MARGIN;

    const line = (text: string, size = 10, bold = false): void => {
      pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
      pdf.text(text, MARGIN, y, {
        width: pdf.page.width - MARGIN * 2 - (qr ? 130 : 0),
        lineBreak: true,
      });
      y = pdf.y + 6;
    };

    line(
      booking.document.type === "VOUCHER" ? "VOUCHER DE RESERVA" : "COMPROBANTE DE PAGO",
      16,
      true,
    );
    line(`Reserva: ${booking.code}`, 11, true);
    line(`Documento N.° ${booking.document.number}`);
    line(`${agency.name}${agency.legalName ? ` — ${agency.legalName}` : ""}`, 11, true);
    if (agency.rif) line(`RIF: ${agency.rif}`);
    if (agency.address) line(agency.address);
    if (agency.phone) line(`Teléfono: ${agency.phone}`);
    if (agency.email) line(`Correo: ${agency.email}`);
    y += 8;

    line("VIAJEROS", 11, true);
    for (const traveler of booking.travelers) {
      line(
        `${traveler.fullName} — ${traveler.documentType} ${traveler.documentNumber}`,
      );
      if (traveler.phone) line(`Teléfono: ${traveler.phone}`);
      if (traveler.email) line(`Correo: ${traveler.email}`);
    }
    y += 8;

    line("DETALLE", 11, true);
    for (const item of booking.items) {
      line(`${item.title.es} (${item.hotelKey}) — ${item.roomType}`);
      line(`Fechas: ${item.checkIn} al ${item.checkOut} · Cantidad: ${item.quantity}`);
      line(`Subtotal USD ${formatAmount(item.subtotalUsd)}`);
      const policy = item.policySnapshot;
      if (policy.name) line(`Política de cancelación: ${policy.name}`);
      for (const rule of policy.rules) {
        line(`${rule.hours_before} h antes · ${rule.percentage} %`, 9);
      }
      y += 4;
    }
    line(`Total USD ${formatAmount(booking.totalUsd)}`, 11, true);

    if (payment) {
      y += 8;
      line("PAGO", 11, true);
      line(`Monto USD ${formatAmount(payment.amountUsd)}`);
      line(`Tasa BCV ${formatRate(payment.rate)} · Fecha valor ${payment.valueDate}`);
      line(`Total VES ${formatAmount(payment.amountVes)}`, 11, true);
      line(`Método: ${payment.method}`);
      if (payment.reference) line(`Referencia: ${payment.reference}`);
    }

    if (qr) {
      pdf.image(qr, pdf.page.width - MARGIN - 110, MARGIN, { width: 110 });
    }
  }

  /**
   * La leyenda va en TODAS las páginas, no solo en la primera. Se estampa al
   * final, cuando ya se conocen todas, para cubrir también los saltos
   * automáticos de PDFKit.
   */
  private stampLegendOnEveryPage(pdf: PDFKit.PDFDocument): void {
    const range = pdf.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      pdf.switchToPage(page);
      pdf.font("Helvetica").fontSize(8).fillColor("#333333");
      // Por encima del margen inferior: si se escribe más abajo, PDFKit abre
      // una página nueva y la leyenda quedaría solo en algunas páginas.
      pdf.text(FISCAL_LEGEND, MARGIN, pdf.page.height - MARGIN - 16, {
        width: pdf.page.width - MARGIN * 2,
        lineBreak: false,
      });
    }
  }
}
