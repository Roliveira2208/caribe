"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Locale, PaymentBody } from "@caribe/shared";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import {
  bookingApiUrl,
  buildBookingRequest,
  checkoutErrorKind,
  checkoutStayFromParams,
  initialTravelers,
  parseBookingCreated,
  type BookingCreatedView,
  type CheckoutErrorKind,
  type CheckoutTraveler,
} from "@/lib/checkout-view";
import {
  parseReportedPayment,
  paymentApiUrl,
  paymentErrorKind as classifyPaymentError,
  type PaymentErrorKind,
  type ReportedPaymentView,
} from "@/lib/payment-view";
import {
  documentsApiUrl,
  parseBookingDocuments,
  type BookingDocumentView,
} from "@/lib/documents-view";
import {
  availabilityApiUrl,
  detailApiUrl,
  parseAvailabilityView,
  parseProductDetailView,
  type CatalogAvailabilityView,
  type CatalogProductDetailView,
} from "@/lib/detail-view";
import {
  CheckoutView,
  type CheckoutStatus,
  type CheckoutViewLabels,
  type SummaryCurrency,
  type TravelerField,
} from "./checkout-view";

/** Parte interactiva de `/[locale]/checkout/[productId]`. */
export function CheckoutExperience({
  locale,
  productId,
}: {
  locale: Locale;
  productId: string;
}) {
  const t = useTranslations("checkout");
  const params = useSearchParams();
  const pathname = usePathname();
  const stay = useMemo(() => checkoutStayFromParams(params), [params]);
  const detailUrl = detailApiUrl(productId);
  const availabilityUrl = stay
    ? availabilityApiUrl(productId, {
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        guests: stay.guests,
      })
    : "";

  const labels: CheckoutViewLabels = {
    loading: t("loading"),
    backToDetail: t("backToDetail"),
    title: t("title"),
    subtitle: t("subtitle"),
    stayTitle: t("stayTitle"),
    checkIn: t("checkIn"),
    checkOut: t("checkOut"),
    guests: t("guests"),
    summaryTitle: t("summaryTitle"),
    nightPrice: t("nightPrice"),
    availabilityEmpty: t("availabilityEmpty"),
    currencyTitle: t("currencyTitle"),
    currencyUsd: t("currencyUsd"),
    currencyVes: t("currencyVes"),
    vesUnavailable: t("vesUnavailable"),
    totalNote: t("totalNote"),
    travelersTitle: t("travelersTitle"),
    fullName: t("fullName"),
    documentType: t("documentType"),
    documentNumber: t("documentNumber"),
    documentTypeDni: t("documentTypeDni"),
    documentTypePassport: t("documentTypePassport"),
    phone: t("phone"),
    email: t("email"),
    addTraveler: t("addTraveler"),
    removeTraveler: t("removeTraveler"),
    travelersRequired: t("travelersRequired"),
    reserve: t("reserve"),
    reserving: t("reserving"),
    login: t("login"),
    paymentTitle: t("paymentTitle"),
    paymentSubtitle: t("paymentSubtitle"),
    holdLabel: t("holdLabel"),
    holdPending: t("holdPending"),
    holdExpired: t("holdExpired"),
    holdNote: t("holdNote"),
    methodTitle: t("methodTitle"),
    methodMobile: t("methodMobile"),
    methodZelle: t("methodZelle"),
    methodBinance: t("methodBinance"),
    methodCard: t("methodCard"),
    amountTitle: t("amountTitle"),
    amountNote: t("amountNote"),
    bank: t("bank"),
    reference: t("reference"),
    senderName: t("senderName"),
    senderEmail: t("senderEmail"),
    confirmationNumber: t("confirmationNumber"),
    orderId: t("orderId"),
    last4: t("last4"),
    brand: t("brand"),
    reportPayment: t("reportPayment"),
    reporting: t("reporting"),
    paymentRequired: t("paymentRequired"),
    successTitle: t("successTitle"),
    successCode: t("successCode"),
    successStatus: t("successStatus"),
    paymentStatusLabel: t("paymentStatusLabel"),
    statusInReview: t("statusInReview"),
    statusApproved: t("statusApproved"),
    statusConfirmed: t("statusConfirmed"),
    successTotal: t("successTotal"),
    successVes: t("successVes"),
    successRate: t("successRate"),
    successExpires: t("successExpires"),
    successDescription: t("successDescription"),
    voucherPreviewTitle: t("voucherPreviewTitle"),
    voucherQrCaption: t("voucherQrCaption"),
    documentNotFiscal: t("documentNotFiscal"),
    documentsTitle: t("documentsTitle"),
    documentsIntro: t("documentsIntro"),
    documentsRefresh: t("documentsRefresh"),
    documentsRefreshing: t("documentsRefreshing"),
    documentsLoadError: t("documentsLoadError"),
    documentsEmpty: t("documentsEmpty"),
    documentTypeVoucher: t("documentTypeVoucher"),
    documentTypeReceipt: t("documentTypeReceipt"),
    documentTypeRefundNote: t("documentTypeRefundNote"),
    documentStatusPending: t("documentStatusPending"),
    documentStatusReady: t("documentStatusReady"),
    documentStatusFailed: t("documentStatusFailed"),
    documentNumberLabel: t("documentNumberLabel"),
    documentDownload: t("documentDownload"),
    viewTrips: t("viewTrips"),
    nextStepsTitle: t("nextStepsTitle"),
    nextStepReview: t("nextStepReview"),
    nextStepApproved: t("nextStepApproved"),
    nextStepExpired: t("nextStepExpired"),
  };

  const errorMessages: Record<CheckoutErrorKind, string> = {
    generic: t("error"),
    "not-found": t("notFound"),
    "invalid-dates": t("invalidDates"),
    unauthenticated: t("unauthenticated"),
    availability: t("availabilityError"),
    validation: t("validationError"),
  };

  const paymentErrorMessages: Record<PaymentErrorKind, string> = {
    generic: t("paymentError"),
    expired: t("paymentErrorExpired"),
    duplicate: t("paymentErrorDuplicate"),
    validation: t("paymentErrorValidation"),
    forbidden: t("paymentErrorForbidden"),
    cancelled: t("paymentErrorCancelled"),
    alreadyPaid: t("paymentErrorAlreadyPaid"),
    malformed: t("paymentErrorMalformed"),
  };

  const [product, setProduct] = useState<CatalogProductDetailView | null>(null);
  const [availability, setAvailability] = useState<CatalogAvailabilityView | null>(null);
  const [status, setStatus] = useState<CheckoutStatus>("loading");
  const [errorKind, setErrorKind] = useState<CheckoutErrorKind>("generic");
  const [booking, setBooking] = useState<BookingCreatedView | null>(null);
  const [payment, setPayment] = useState<ReportedPaymentView | null>(null);
  const [documents, setDocuments] = useState<BookingDocumentView[] | null>(null);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentsRefreshing, setDocumentsRefreshing] = useState(false);
  const [documentsRequest, setDocumentsRequest] = useState(0);
  const [paymentErrorKind, setPaymentErrorKind] = useState<PaymentErrorKind>("generic");
  const [travelers, setTravelers] = useState<CheckoutTraveler[]>(() => initialTravelers(1));
  const [travelerError, setTravelerError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<SummaryCurrency>("USD");
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const paymentIdempotencyKey = useRef<string | null>(null);
  const paymentBodySignature = useRef<string | null>(null);

  const query = params.toString();
  const currentPath = `${pathname}${query ? `?${query}` : ""}`;
  const loginHref = `/${locale}/login?redirectTo=${encodeURIComponent(currentPath)}`;

  function resetIdempotencyKey(): void {
    idempotencyKey.current = null;
  }

  function getIdempotencyKey(): string {
    idempotencyKey.current ??= crypto.randomUUID();
    return idempotencyKey.current;
  }

  function getPaymentIdempotencyKey(): string {
    paymentIdempotencyKey.current ??= crypto.randomUUID();
    return paymentIdempotencyKey.current;
  }

  function refreshDocuments(): void {
    setDocumentsRequest((count) => count + 1);
  }

  useEffect(() => {
    setTravelers(initialTravelers(stay?.guests ?? 1));
    setTravelerError(null);
    resetIdempotencyKey();
  }, [stay?.guests]);

  useEffect(() => {
    if (!stay) {
      setProduct(null);
      setAvailability(null);
      setErrorKind("invalid-dates");
      setStatus("error");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    setErrorKind("generic");

    const load = async (): Promise<void> => {
      try {
        const [detailResponse, availabilityResponse] = await Promise.all([
          fetch(detailUrl, { signal: controller.signal }),
          fetch(availabilityUrl, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        if (detailResponse.status === 404) {
          setErrorKind("not-found");
          setStatus("error");
          return;
        }
        if (!detailResponse.ok || !availabilityResponse.ok) {
          throw new Error(
            `HTTP ${detailResponse.status}/${availabilityResponse.status}`,
          );
        }

        const parsedProduct = parseProductDetailView(await detailResponse.json());
        const parsedAvailability = parseAvailabilityView(await availabilityResponse.json());
        if (controller.signal.aborted) return;
        if (!parsedProduct || !parsedAvailability) {
          setErrorKind("generic");
          setStatus("error");
          return;
        }
        setProduct(parsedProduct);
        setAvailability(parsedAvailability);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) {
          setErrorKind("generic");
          setStatus("error");
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [detailUrl, availabilityUrl, stay]);

  // La confirmación solo muestra descargas que la API entrega como `READY`.
  // Un error deja el botón de actualización visible, nunca un enlace inventado.
  useEffect(() => {
    if (status !== "success" || !booking) return;
    const controller = new AbortController();
    setDocumentsRefreshing(true);
    setDocumentsError(null);
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(documentsApiUrl(booking.id), {
          signal: controller.signal,
          credentials: "same-origin",
        });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setDocuments(null);
          setDocumentsError(labels.documentsLoadError);
          return;
        }
        const parsed = parseBookingDocuments(body);
        if (!parsed) {
          setDocuments(null);
          setDocumentsError(labels.documentsLoadError);
          return;
        }
        setDocuments(parsed);
      } catch {
        if (!controller.signal.aborted) {
          setDocuments(null);
          setDocumentsError(labels.documentsLoadError);
        }
      } finally {
        if (!controller.signal.aborted) setDocumentsRefreshing(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [status, booking?.id, documentsRequest, labels.documentsLoadError]);

  function changeTraveler(index: number, field: TravelerField, value: string): void {
    setTravelers((current) =>
      current.map((traveler, position) =>
        position === index ? { ...traveler, [field]: value } : traveler,
      ),
    );
    setTravelerError(null);
    resetIdempotencyKey();
  }

  function addTraveler(): void {
    setTravelers((current) => [
      ...current,
      { fullName: "", documentType: "DNI", documentNumber: "" },
    ]);
    setTravelerError(null);
    resetIdempotencyKey();
  }

  function removeTraveler(index: number): void {
    setTravelers((current) => current.filter((_, position) => position !== index));
    setTravelerError(null);
    resetIdempotencyKey();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const request = buildBookingRequest(productId, stay, travelers);
    if (!request) {
      setTravelerError(labels.travelersRequired);
      return;
    }

    setBusy(true);
    setTravelerError(null);
    paymentIdempotencyKey.current = null;
    paymentBodySignature.current = null;
    setPayment(null);
    setDocuments(null);
    setDocumentsError(null);
    setDocumentsRefreshing(false);
    setDocumentsRequest(0);
    setPaymentErrorKind("generic");
    try {
      const response = await fetch(bookingApiUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getIdempotencyKey(),
        },
        body: JSON.stringify(request),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorKind(checkoutErrorKind(response.status, body));
        setStatus("error");
        return;
      }
      const parsedBooking = parseBookingCreated(body);
      if (!parsedBooking) {
        setErrorKind("generic");
        setStatus("error");
        return;
      }
      setBooking(parsedBooking);
      setStatus("payment");
    } catch {
      setErrorKind("generic");
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  async function onPay(body: PaymentBody): Promise<void> {
    if (!booking) return;
    // Reintentar el mismo cuerpo conserva la clave (evita un segundo pago tras
    // un fallo de red); corregir los datos genera una clave nueva.
    const signature = JSON.stringify(body);
    if (paymentBodySignature.current !== signature) {
      paymentIdempotencyKey.current = null;
      paymentBodySignature.current = signature;
    }
    setBusy(true);
    setPaymentErrorKind("generic");
    try {
      const response = await fetch(paymentApiUrl(booking.id), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getPaymentIdempotencyKey(),
        },
        body: JSON.stringify(body),
      });
      const responseBody: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setPaymentErrorKind(classifyPaymentError(response.status, responseBody));
        return;
      }
      const reported = parseReportedPayment(responseBody);
      if (!reported) {
        setPaymentErrorKind("malformed");
        return;
      }
      setPayment(reported);
      setStatus("success");
    } catch {
      setPaymentErrorKind("generic");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CheckoutView
      locale={locale}
      productId={productId}
      stay={stay}
      product={product}
      availability={availability}
      currency={currency}
      status={status}
      booking={booking}
      payment={payment}
      documents={documents}
      documentsError={documentsError}
      documentsRefreshing={documentsRefreshing}
      paymentError={status === "payment" ? paymentErrorMessages[paymentErrorKind] : null}
      travelers={travelers}
      travelerError={travelerError}
      errorMessage={status === "error" ? errorMessages[errorKind] : null}
      showLogin={errorKind === "unauthenticated"}
      loginHref={loginHref}
      busy={busy}
      labels={labels}
      onCurrencyChange={setCurrency}
      onTravelerChange={changeTraveler}
      onAddTraveler={addTraveler}
      onRemoveTraveler={removeTraveler}
      onSubmit={(event) => void onSubmit(event)}
      onPay={(body) => void onPay(body)}
      onRefreshDocuments={refreshDocuments}
    />
  );
}
