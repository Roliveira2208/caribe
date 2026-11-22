import type { Locale } from "@caribe/shared";
import type { BookingDocumentType, BookingDocumentView } from "@/lib/documents-view";
import {
  canCancelBooking,
  formatValueDate,
  type BookingDetailView,
  type CancelErrorKind,
  type CancelResultView,
} from "@/lib/booking-detail-view";
import type { TripStatus } from "@/lib/trips-view";
import { Button } from "@/components/ui/button";

/** Textos de la vista de detalle; el contenedor los toma de es/en. */
export interface BookingDetailLabels {
  title: string;
  loading: string;
  error: string;
  retry: string;
  itemsTitle: string;
  checkIn: string;
  checkOut: string;
  room: string;
  guests: string;
  subtotal: string;
  nightPrice: string;
  policyTitle: string;
  policyRule: string;
  policyNone: string;
  totalLabel: string;
  totalUsd: string;
  refundEstimateTitle: string;
  refundEstimatePercentage: string;
  refundEstimateNote: string;
  terminal: string;
  cancel: string;
  cancelTitle: string;
  cancelDescription: string;
  cancelKeep: string;
  cancelConfirm: string;
  cancelling: string;
  cancelErrorGeneric: string;
  cancelErrorPaymentInReview: string;
  cancelErrorNotFound: string;
  cancelErrorInvalidState: string;
  cancelSuccess: string;
  refundTitle: string;
  refundUsd: string;
  refundVes: string;
  refundRate: string;
  refundValueDate: string;
  refundStatus: string;
  refundStatusPending: string;
  refundStatusInReview: string;
  refundStatusApproved: string;
  refundStatusRejected: string;
  refundNone: string;
  documentsTitle: string;
  documentsIntro: string;
  documentsRefresh: string;
  documentsRefreshing: string;
  documentsLoadError: string;
  documentsEmpty: string;
  documentNotFiscal: string;
  documentNumberLabel: string;
  documentDownload: string;
  documentTypeVoucher: string;
  documentTypeReceipt: string;
  documentTypeRefundNote: string;
  documentStatusPending: string;
  documentStatusReady: string;
  documentStatusFailed: string;
}

export type BookingDetailState =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      detail: BookingDetailView;
      documents: BookingDocumentView[] | null;
      documentsError: boolean;
      documentsRefreshing: boolean;
      confirming: boolean;
      cancelling: boolean;
      cancelError: CancelErrorKind | null;
      result: CancelResultView | null;
    };

export interface BookingDetailViewProps {
  locale: Locale;
  labels: BookingDetailLabels;
  statusLabel: (status: TripStatus) => string;
  state: BookingDetailState;
  onRetry: () => void;
  onRefreshDocuments: () => void;
  onCancel: () => void;
  onKeep: () => void;
  onConfirmCancel: () => void;
}

function cancelMessage(labels: BookingDetailLabels, kind: CancelErrorKind | null): string | null {
  switch (kind) {
    case "paymentInReview":
      return labels.cancelErrorPaymentInReview;
    case "notFound":
      return labels.cancelErrorNotFound;
    case "invalidState":
      return labels.cancelErrorInvalidState;
    case "generic":
      return labels.cancelErrorGeneric;
    default:
      return null;
  }
}

function documentTypeLabel(labels: BookingDetailLabels, type: BookingDocumentType): string {
  switch (type) {
    case "VOUCHER":
      return labels.documentTypeVoucher;
    case "RECEIPT":
      return labels.documentTypeReceipt;
    case "REFUND_NOTE":
      return labels.documentTypeRefundNote;
  }
}

function documentStatusLabel(labels: BookingDetailLabels, status: BookingDocumentView["status"]): string {
  switch (status) {
    case "PENDING":
      return labels.documentStatusPending;
    case "READY":
      return labels.documentStatusReady;
    case "FAILED":
      return labels.documentStatusFailed;
  }
}

function refundStatusLabel(labels: BookingDetailLabels, status: string): string {
  switch (status) {
    case "PENDING":
      return labels.refundStatusPending;
    case "IN_REVIEW":
      return labels.refundStatusInReview;
    case "APPROVED":
      return labels.refundStatusApproved;
    case "REJECTED":
      return labels.refundStatusRejected;
    default:
      return status;
  }
}

function Refund({ refund, labels }: { refund: CancelResultView["refund"]; labels: BookingDetailLabels }) {
  if (!refund) {
    return <p className="text-sm text-ink">{labels.refundNone}</p>;
  }
  return (
    <dl className="grid gap-2 text-sm text-ink">
      <div className="flex justify-between gap-4">
        <dt>{labels.refundUsd.replace("{amount}", refund.amountUsd)}</dt>
        <dd className="font-mono">{refund.id}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt>{labels.refundVes.replace("{amount}", refund.amountVes)}</dt>
        <dd>{labels.refundRate}: {refund.rate}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt>{labels.refundValueDate}</dt>
        <dd>{refund.valueDate}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt>{labels.refundStatus}</dt>
        <dd>{refundStatusLabel(labels, refund.paymentStatus)}</dd>
      </div>
    </dl>
  );
}

function Documents({
  bookingId,
  documents,
  error,
  refreshing,
  labels,
  onRefresh,
}: {
  bookingId: string;
  documents: BookingDocumentView[] | null;
  error: boolean;
  refreshing: boolean;
  labels: BookingDetailLabels;
  onRefresh: () => void;
}) {
  return (
    <section aria-label={labels.documentsTitle} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-display text-body-lg text-ink">{labels.documentsTitle}</h4>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? labels.documentsRefreshing : labels.documentsRefresh}
        </Button>
      </div>
      <p className="text-sm text-ink">{labels.documentsIntro}</p>
      {error ? (
        <p role="alert" className="text-sm text-coral-ink">
          {labels.documentsLoadError}
        </p>
      ) : null}
      {documents && documents.length === 0 ? (
        <p className="text-sm text-ink">{labels.documentsEmpty}</p>
      ) : null}
      {documents && documents.length > 0 ? (
        <ul className="grid gap-2">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink/15 px-3 py-2"
            >
              <span className="text-sm text-ink">
                {documentTypeLabel(labels, document.type)} · {labels.documentNumberLabel} {document.number} ·{" "}
                {documentStatusLabel(labels, document.status)}
              </span>
              {document.status === "READY" && document.downloadPath ? (
                <a
                  className="text-sm font-medium text-teal-ink underline underline-offset-2"
                  href={document.downloadPath}
                >
                  {labels.documentDownload}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-ink">{labels.documentNotFiscal}</p>
      <span className="sr-only" data-booking-documents={bookingId} />
    </section>
  );
}

/** Vista pura del detalle, la cancelación y los documentos de una reserva. */
export function BookingDetailView({
  locale,
  labels,
  statusLabel,
  state,
  onRetry,
  onRefreshDocuments,
  onCancel,
  onKeep,
  onConfirmCancel,
}: BookingDetailViewProps) {
  if (state.kind === "loading") {
    return (
      <p role="status" aria-live="polite" className="text-body-lg text-ink">
        {labels.loading}
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div role="alert" className="space-y-3">
        <p className="text-body-lg text-ink">{labels.error}</p>
        <Button variant="outline" onClick={onRetry}>
          {labels.retry}
        </Button>
      </div>
    );
  }

  const { detail, documents, documentsError, documentsRefreshing, confirming, cancelling, cancelError, result } =
    state;
  const message = cancelMessage(labels, cancelError);
  const cancellable = canCancelBooking(detail.status) && !result;

  return (
    <div className="space-y-6" data-booking-detail={detail.id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-h3 text-ink">{labels.title}</h3>
        <p className="text-sm text-ink">
          {detail.code} · {statusLabel(detail.status)}
        </p>
      </div>

      <section aria-label={labels.itemsTitle} className="space-y-3">
        {detail.items.map((item) => (
          <article key={`${item.productId}-${item.checkIn}`} className="rounded-panel border border-ink/15 p-4">
            <h4 className="font-display text-body-lg text-ink">{item.title[locale]}</h4>
            <dl className="mt-2 grid gap-2 text-sm text-ink sm:grid-cols-2">
              <div>
                <dt>{labels.checkIn}</dt>
                <dd>{formatValueDate(item.checkIn, locale)}</dd>
              </div>
              <div>
                <dt>{labels.checkOut}</dt>
                <dd>{formatValueDate(item.checkOut, locale)}</dd>
              </div>
              <div>
                <dt>{labels.room}</dt>
                <dd>{item.roomType}</dd>
              </div>
              <div>
                <dt>{labels.guests}</dt>
                <dd>{item.quantity}</dd>
              </div>
              <div>
                <dt>{labels.subtotal}</dt>
                <dd>{labels.totalUsd.replace("{amount}", item.subtotalUsd)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-ink">
              {labels.nightPrice}: {item.nightlyPrices
                .map((night) => `${formatValueDate(night.night, locale)} ${labels.totalUsd.replace("{amount}", night.priceUsd)}`)
                .join(" · ")}
            </p>
            <div className="mt-3 space-y-1">
              <p className="text-xs font-medium text-ink">{labels.policyTitle}</p>
              <p className="text-xs text-ink">{item.policySnapshot.name ?? labels.policyNone}</p>
              {item.policySnapshot.rules.length > 0 ? (
                <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink">
                  {item.policySnapshot.rules.map((rule) => (
                    <li key={`${rule.hoursBefore}-${rule.percentage}`}>
                      {labels.policyRule
                        .replace("{percentage}", String(rule.percentage))
                        .replace("{hours}", String(rule.hoursBefore))}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </article>
        ))}
        <p className="font-display text-body-lg text-ink">
          {labels.totalLabel}: {labels.totalUsd.replace("{amount}", detail.totalUsd)}
        </p>
      </section>

      {detail.refundEstimate ? (
        <section
          aria-label={labels.refundEstimateTitle}
          className="space-y-2 rounded-panel border border-ink/15 p-4"
        >
          <h4 className="font-display text-body-lg text-ink">{labels.refundEstimateTitle}</h4>
          <p className="text-sm text-ink">
            {labels.refundEstimatePercentage.replace(
              "{percentage}",
              String(detail.refundEstimate.percentage),
            )}
          </p>
          <dl className="grid gap-2 text-sm text-ink sm:grid-cols-2">
            <div>
              <dt>{labels.refundUsd.replace("{amount}", detail.refundEstimate.amountUsd)}</dt>
              <dd>{labels.refundVes.replace("{amount}", detail.refundEstimate.amountVes)}</dd>
            </div>
            <div>
              <dt>{labels.refundRate}: {detail.refundEstimate.rate}</dt>
              <dd>{labels.refundValueDate}: {detail.refundEstimate.valueDate}</dd>
            </div>
          </dl>
          <p className="text-xs text-ink">{labels.refundEstimateNote}</p>
        </section>
      ) : null}

      <Documents
        bookingId={detail.id}
        documents={documents}
        error={documentsError}
        refreshing={documentsRefreshing}
        labels={labels}
        onRefresh={onRefreshDocuments}
      />

      {result ? (
        <section aria-label={labels.cancelSuccess} className="space-y-2 rounded-panel border border-ink/15 p-4">
          <h4 className="font-display text-body-lg text-ink">
            {labels.cancelSuccess} · {statusLabel(result.status)}
          </h4>
          <p className="text-sm text-ink">{labels.refundTitle}</p>
          <Refund refund={result.refund} labels={labels} />
        </section>
      ) : null}

      {result ? null : cancellable ? (
        <Button variant="destructive" onClick={onCancel} disabled={confirming || cancelling}>
          {labels.cancel}
        </Button>
      ) : (
        <p className="text-sm text-ink">{labels.terminal}</p>
      )}

      {message ? (
        <p role="alert" className="text-sm text-coral-ink">
          {message}
        </p>
      ) : null}

      {confirming ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`cancel-title-${detail.id}`}
          aria-describedby={`cancel-description-${detail.id}`}
          className="space-y-3 rounded-panel border border-ink/25 bg-bone p-4"
        >
          <h4 id={`cancel-title-${detail.id}`} className="font-display text-body-lg text-ink">
            {labels.cancelTitle}
          </h4>
          <p id={`cancel-description-${detail.id}`} className="text-sm text-ink">
            {labels.cancelDescription}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={onKeep} disabled={cancelling} autoFocus>
              {labels.cancelKeep}
            </Button>
            <Button variant="destructive" onClick={onConfirmCancel} disabled={cancelling}>
              {cancelling ? labels.cancelling : labels.cancelConfirm}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
