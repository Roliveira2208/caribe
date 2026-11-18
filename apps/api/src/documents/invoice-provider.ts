import type { DecimalValue } from "@caribe/shared";
import type { CancellationRule } from "../bookings/cancellation-policy.js";

/**
 * Contrato de emisión de comprobantes (T-F1-11, spec documents
 * "InvoiceProvider"). `issue(booking, payment?)` cubre el voucher sin pago y el
 * comprobante con pago; cambiar de proveedor no toca BookingModule ni
 * PaymentModule. Los datos son instantáneas congeladas: aquí no se consulta la
 * BD ni se recalcula ningún monto o tasa.
 */
export type DocumentTypeValue = "VOUCHER" | "RECEIPT";

export interface IssuedDocument {
  type: DocumentTypeValue;
  number: number;
  fileUrl: string;
  issuedAt: Date;
}

export interface FrozenTraveler {
  fullName: string;
  documentType: string;
  documentNumber: string;
  phone?: string;
  email?: string;
}

export interface FrozenBookingItem {
  hotelKey: string;
  roomType: string;
  title: { es: string; en: string };
  checkIn: string;
  checkOut: string;
  quantity: number;
  subtotalUsd: DecimalValue;
  policySnapshot: {
    policyId: string | null;
    name: string | null;
    rules: CancellationRule[];
  };
}

export interface FrozenAgency {
  name: string;
  legalName: string | null;
  rif: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface FrozenBooking {
  id: string;
  code: string;
  tenantId: string;
  totalUsd: DecimalValue;
  travelers: FrozenTraveler[];
  items: FrozenBookingItem[];
  agency: FrozenAgency;
  document: {
    id: string;
    number: number;
    type: DocumentTypeValue;
  };
  /** URL absoluta del QR del voucher; se incrusta como imagen, nunca como texto. */
  qrUrl: string;
}

export interface FrozenPayment {
  method: string;
  amountUsd: DecimalValue;
  amountVes: DecimalValue;
  rate: DecimalValue;
  valueDate: string;
  reference: string | null;
  paidAt: string;
}

export interface InvoiceProvider {
  issue(booking: FrozenBooking, payment?: FrozenPayment): Promise<IssuedDocument>;
}

/** Token de inyección (la interfaz se borra en runtime). */
export const INVOICE_PROVIDER = Symbol("INVOICE_PROVIDER");
