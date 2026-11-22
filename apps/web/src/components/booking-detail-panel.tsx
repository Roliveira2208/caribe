"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@caribe/shared";
import { useTranslations } from "next-intl";
import {
  bookingCancelApiUrl,
  bookingDetailApiUrl,
  cancelErrorKind,
  parseBookingDetail,
  parseCancelResult,
  type BookingDetailView as BookingDetail,
  type CancelErrorKind,
  type CancelResultView,
} from "@/lib/booking-detail-view";
import { documentsApiUrl, parseBookingDocuments, type BookingDocumentView } from "@/lib/documents-view";
import type { TripStatus } from "@/lib/trips-view";
import { BookingDetailView, type BookingDetailState } from "./booking-detail-view";

/**
 * Parte interactiva del detalle de una reserva (T-F1-14a/14b): lee el detalle y
 * sus documentos, pide confirmación antes de cancelar y solo ofrece descargas
 * que la API devolvió como `downloadPath`.
 */
export function BookingDetailPanel({ bookingId, locale }: { bookingId: string; locale: Locale }) {
  const t = useTranslations("account");
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [documents, setDocuments] = useState<BookingDocumentView[] | null>(null);
  const [documentsError, setDocumentsError] = useState(false);
  const [documentsRefreshing, setDocumentsRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<CancelErrorKind | null>(null);
  const [result, setResult] = useState<CancelResultView | null>(null);
  const [request, setRequest] = useState(0);

  const detailUrl = bookingDetailApiUrl(bookingId);
  const documentsUrl = documentsApiUrl(bookingId);

  useEffect(() => {
    let active = true;
    setPhase("loading");
    setDocumentsRefreshing(request > 0);

    async function load(): Promise<void> {
      try {
        const [detailResponse, documentsResponse] = await Promise.all([
          fetch(detailUrl, { cache: "no-store", credentials: "same-origin" }),
          fetch(documentsUrl, { cache: "no-store", credentials: "same-origin" }),
        ]);
        if (!active) return;
        if (!detailResponse.ok) {
          setPhase("error");
          return;
        }
        const parsedDetail = parseBookingDetail(await detailResponse.json().catch(() => null));
        if (!active) return;
        if (!parsedDetail) {
          setPhase("error");
          return;
        }
        const parsedDocuments = documentsResponse.ok
          ? parseBookingDocuments(await documentsResponse.json().catch(() => null))
          : null;
        if (!active) return;
        setDetail(parsedDetail);
        setDocuments(parsedDocuments);
        setDocumentsError(!documentsResponse.ok || parsedDocuments === null);
        setPhase("ready");
      } catch {
        if (active) setPhase("error");
      } finally {
        if (active) setDocumentsRefreshing(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [detailUrl, documentsUrl, request]);

  function statusLabel(status: TripStatus): string {
    switch (status) {
      case "PENDING_PAYMENT":
        return t("statusPendingPayment");
      case "CONFIRMED":
        return t("statusConfirmed");
      case "CANCELLED":
        return t("statusCancelled");
      case "EXPIRED":
        return t("statusExpired");
    }
  }

  async function confirmCancel(): Promise<void> {
    if (!detail || cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const response = await fetch(bookingCancelApiUrl(detail.id), {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setCancelError(cancelErrorKind(response.status, body));
        setCancelling(false);
        return;
      }
      const parsed = parseCancelResult(await response.json().catch(() => null));
      if (!parsed) {
        setCancelError("generic");
        setCancelling(false);
        return;
      }
      setResult(parsed);
      setConfirming(false);
      setCancelling(false);
      setRequest((count) => count + 1);
    } catch {
      setCancelError("generic");
      setCancelling(false);
    }
  }

  const state: BookingDetailState =
    phase === "ready" && detail
      ? {
            kind: "ready",
            detail,
            documents,
            documentsError,
            documentsRefreshing,
            confirming,
            cancelling,
            cancelError,
            result,
          }
      : phase === "error"
        ? { kind: "error" }
        : { kind: "loading" };

  return (
    <BookingDetailView
      locale={locale}
      statusLabel={statusLabel}
      state={state}
      labels={{
        title: t("tripsDetailTitle"),
        loading: t("tripsDetailLoading"),
        error: t("tripsDetailError"),
        retry: t("tripsRetry"),
        itemsTitle: t("tripsItemsTitle"),
        checkIn: t("tripsCheckIn"),
        checkOut: t("tripsCheckOut"),
        room: t("tripsRoom"),
        guests: t("tripsGuests"),
        subtotal: t("tripsSubtotal"),
        nightPrice: t("tripsNightPrice"),
        policyTitle: t("tripsPolicyTitle"),
        // Plantillas con marcadores: la vista las completa con importes del
        // servidor; `t()` sin valores resolvería la clave cruda.
        policyRule: t.raw("tripsPolicyRule") as string,
        policyNone: t("tripsPolicyNone"),
        totalLabel: t("tripsTotalLabel"),
        totalUsd: t.raw("tripsTotalUsd") as string,
        refundEstimateTitle: t("tripsRefundEstimateTitle"),
        refundEstimatePercentage: t.raw("tripsRefundEstimatePercentage") as string,
        refundEstimateNote: t("tripsRefundEstimateNote"),
        terminal: t("tripsTerminal"),
        cancel: t("tripsCancel"),
        cancelTitle: t("tripsCancelTitle"),
        cancelDescription: t("tripsCancelDescription"),
        cancelKeep: t("tripsCancelKeep"),
        cancelConfirm: t("tripsCancelConfirm"),
        cancelling: t("tripsCancelling"),
        cancelErrorGeneric: t("tripsCancelErrorGeneric"),
        cancelErrorPaymentInReview: t("tripsCancelErrorPaymentInReview"),
        cancelErrorNotFound: t("tripsCancelErrorNotFound"),
        cancelErrorInvalidState: t("tripsCancelErrorInvalidState"),
        cancelSuccess: t("tripsCancelSuccess"),
        refundTitle: t("tripsRefundTitle"),
        refundUsd: t.raw("tripsRefundUsd") as string,
        refundVes: t.raw("tripsRefundVes") as string,
        refundRate: t("tripsRefundRate"),
        refundValueDate: t("tripsRefundValueDate"),
        refundStatus: t("tripsRefundStatus"),
        refundStatusPending: t("tripsRefundStatusPending"),
        refundStatusInReview: t("tripsRefundStatusInReview"),
        refundStatusApproved: t("tripsRefundStatusApproved"),
        refundStatusRejected: t("tripsRefundStatusRejected"),
        refundNone: t("tripsRefundNone"),
        documentsTitle: t("tripsDocumentsTitle"),
        documentsIntro: t("tripsDocumentsIntro"),
        documentsRefresh: t("tripsDocumentsRefresh"),
        documentsRefreshing: t("tripsDocumentsRefreshing"),
        documentsLoadError: t("tripsDocumentsLoadError"),
        documentsEmpty: t("tripsDocumentsEmpty"),
        documentNotFiscal: t("tripsDocumentNotFiscal"),
        documentNumberLabel: t("tripsDocumentNumberLabel"),
        documentDownload: t("tripsDocumentDownload"),
        documentTypeVoucher: t("tripsDocumentTypeVoucher"),
        documentTypeReceipt: t("tripsDocumentTypeReceipt"),
        documentTypeRefundNote: t("tripsDocumentTypeRefundNote"),
        documentStatusPending: t("tripsDocumentStatusPending"),
        documentStatusReady: t("tripsDocumentStatusReady"),
        documentStatusFailed: t("tripsDocumentStatusFailed"),
      }}
      onRetry={() => setRequest((count) => count + 1)}
      onRefreshDocuments={() => setRequest((count) => count + 1)}
      onCancel={() => {
        setCancelError(null);
        setConfirming(true);
      }}
      onKeep={() => setConfirming(false)}
      onConfirmCancel={() => void confirmCancel()}
    />
  );
}
