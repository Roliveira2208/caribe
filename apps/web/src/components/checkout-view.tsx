import type { FormEvent } from "react";
import type { Locale } from "@caribe/shared";
import { localizedPath } from "@/lib/localized-path";
import { formatUsd, formatValueDate, formatVes, localizedText } from "@/lib/catalog-view";
import type {
  CatalogAvailabilityView,
  CatalogProductDetailView,
} from "@/lib/detail-view";
import type {
  BookingCreatedView,
  CheckoutStay,
  CheckoutTraveler,
} from "@/lib/checkout-view";

/**
 * Vista pura del checkout (change f1-visual-identity). Recibe textos ya
 * traducidos y datos validados; la interacción con la API vive en
 * `CheckoutExperience`. Nunca recibe montos calculados por el cliente.
 */
export interface CheckoutViewLabels {
  loading: string;
  backToDetail: string;
  title: string;
  subtitle: string;
  stayTitle: string;
  checkIn: string;
  checkOut: string;
  guests: string;
  summaryTitle: string;
  nightPrice: string;
  availabilityEmpty: string;
  currencyTitle: string;
  currencyUsd: string;
  currencyVes: string;
  vesUnavailable: string;
  totalNote: string;
  travelersTitle: string;
  fullName: string;
  documentType: string;
  documentNumber: string;
  documentTypeDni: string;
  documentTypePassport: string;
  phone: string;
  email: string;
  addTraveler: string;
  removeTraveler: string;
  travelersRequired: string;
  reserve: string;
  reserving: string;
  login: string;
  successTitle: string;
  successCode: string;
  successStatus: string;
  successTotal: string;
  successExpires: string;
  successDescription: string;
}

export type CheckoutStatus = "loading" | "error" | "ready" | "success";
export type SummaryCurrency = "USD" | "VES";
export type TravelerField =
  | "fullName"
  | "documentType"
  | "documentNumber"
  | "phone"
  | "email";

interface CheckoutViewProps {
  locale: Locale;
  productId: string;
  stay: CheckoutStay | null;
  product: CatalogProductDetailView | null;
  availability: CatalogAvailabilityView | null;
  currency: SummaryCurrency;
  status: CheckoutStatus;
  booking: BookingCreatedView | null;
  travelers: CheckoutTraveler[];
  travelerError: string | null;
  errorMessage: string | null;
  showLogin: boolean;
  loginHref: string;
  busy: boolean;
  labels: CheckoutViewLabels;
  onCurrencyChange?: (currency: SummaryCurrency) => void;
  onTravelerChange?: (index: number, field: TravelerField, value: string) => void;
  onAddTraveler?: () => void;
  onRemoveTraveler?: (index: number) => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}

const FIELD_CLASSES =
  "mt-1 h-11 w-full rounded border border-ink/20 bg-bone px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber";
const LABEL_CLASSES = "text-sm font-medium text-ink";

function BackToDetail({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center rounded-md border border-ink/20 px-4 text-sm font-medium text-ink hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
    >
      {label}
    </a>
  );
}

function Success({
  booking,
  locale,
  labels,
  detailHref,
}: {
  booking: BookingCreatedView;
  locale: Locale;
  labels: CheckoutViewLabels;
  detailHref: string;
}) {
  return (
    <section
      data-checkout-status="success"
      role="status"
      aria-live="polite"
      className="mx-auto max-w-xl space-y-6 rounded-xl border border-ink/10 bg-bone p-8 shadow-brand"
    >
      <div className="space-y-2">
        <h1 className="font-display text-h2 text-ink">{labels.successTitle}</h1>
        <p className="text-body-lg text-ink/70">{labels.successDescription}</p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md bg-ink/5 p-4">
          <dt className="text-sm text-ink/70">{labels.successCode}</dt>
          <dd className="font-display text-h4 text-ink">{booking.code}</dd>
        </div>
        <div className="rounded-md bg-amber/15 p-4">
          <dt className="text-sm text-ink/70">{labels.successStatus}</dt>
          <dd className="font-semibold text-ink">{labels.successStatus}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink/70">{labels.successTotal}</dt>
          <dd className="font-display text-h4 text-ink">{formatUsd(booking.totalUsd, locale)}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink/70">{labels.successExpires}</dt>
          <dd className="font-medium text-ink">
            {formatValueDate(booking.expiresAt.slice(0, 10), locale)}
          </dd>
        </div>
      </dl>
      <BackToDetail href={detailHref} label={labels.backToDetail} />
    </section>
  );
}

export function CheckoutView({
  locale,
  productId,
  stay,
  product,
  availability,
  currency,
  status,
  booking,
  travelers,
  travelerError,
  errorMessage,
  showLogin,
  loginHref,
  busy,
  labels,
  onCurrencyChange,
  onTravelerChange,
  onAddTraveler,
  onRemoveTraveler,
  onSubmit,
}: CheckoutViewProps) {
  const detailHref = localizedPath(locale, "/hotels/[id]", { id: productId });

  if (status === "loading") {
    return (
      <p
        role="status"
        aria-live="polite"
        data-checkout-status="loading"
        className="text-base text-ink/70"
      >
        {labels.loading}
      </p>
    );
  }

  if (status === "success" && booking) {
    return (
      <Success booking={booking} locale={locale} labels={labels} detailHref={detailHref} />
    );
  }

  if (status === "error" || !stay || !product || !availability) {
    return (
      <div
        data-checkout-status="error"
        className="mx-auto max-w-xl space-y-4 rounded-xl border border-coral/30 bg-coral/5 p-6 shadow-brand"
      >
        <p role="alert" className="font-display text-h4 text-coral-ink">
          {errorMessage ?? labels.loading}
        </p>
        <div className="flex flex-wrap gap-3">
          <BackToDetail href={detailHref} label={labels.backToDetail} />
          {showLogin ? (
            <a
              href={loginHref}
              className="inline-flex min-h-11 items-center rounded-md bg-ink px-5 font-medium text-bone hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
            >
              {labels.login}
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  const title = localizedText(product.title, locale);
  const vesAvailable = availability.nights.some((night) => night.priceVes !== null);

  return (
    <article data-checkout-status="ready" className="w-full space-y-8">
      <div className="space-y-2">
        <BackToDetail href={detailHref} label={labels.backToDetail} />
        <h1 className="font-display text-h1 text-ink">{labels.title}</h1>
        <p className="text-body-lg text-ink/70">{labels.subtitle}</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <aside className="space-y-6 rounded-lg border border-ink/10 bg-bone p-6 shadow-brand lg:sticky lg:top-24">
          <div className="space-y-2">
            <h2 className="font-display text-h4 text-ink">{title}</h2>
            <p className="text-sm text-teal-ink">{localizedText(product.destination.name, locale)}</p>
          </div>

          <section className="space-y-3">
            <h2 className="font-display text-h4 text-ink">{labels.stayTitle}</h2>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-ink/70">{labels.checkIn}</dt>
                <dd className="font-medium text-ink">{formatValueDate(stay.checkIn, locale)}</dd>
              </div>
              <div>
                <dt className="text-sm text-ink/70">{labels.checkOut}</dt>
                <dd className="font-medium text-ink">{formatValueDate(stay.checkOut, locale)}</dd>
              </div>
              <div>
                <dt className="text-sm text-ink/70">{labels.guests}</dt>
                <dd className="font-medium text-ink">{stay.guests}</dd>
              </div>
            </dl>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-h4 text-ink">{labels.summaryTitle}</h2>
            <fieldset className="space-y-2">
              <legend className={LABEL_CLASSES}>{labels.currencyTitle}</legend>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name="summaryCurrency"
                    value="USD"
                    checked={currency === "USD"}
                    onChange={() => onCurrencyChange?.("USD")}
                    className="h-4 w-4 accent-amber focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
                  />
                  {labels.currencyUsd}
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name="summaryCurrency"
                    value="VES"
                    checked={currency === "VES"}
                    disabled={!vesAvailable}
                    onChange={() => onCurrencyChange?.("VES")}
                    className="h-4 w-4 accent-amber focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
                  />
                  {labels.currencyVes}
                </label>
              </div>
              {!vesAvailable ? <p className="text-sm text-ink/70">{labels.vesUnavailable}</p> : null}
            </fieldset>

            {availability.nights.length > 0 ? (
              <ul
                aria-label={labels.nightPrice}
                className="divide-y divide-ink/10 rounded-md border border-ink/10"
              >
                {availability.nights.map((night) => (
                  <li key={night.night} className="flex items-baseline justify-between gap-3 p-3">
                    <span className="text-sm text-ink/80">
                      {formatValueDate(night.night, locale)}
                    </span>
                    <span className="font-medium text-ink">
                      {currency === "VES" && night.priceVes !== null
                        ? formatVes(night.priceVes, locale)
                        : formatUsd(night.priceUsd, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p role="status" className="rounded-md border border-dashed border-ink/25 p-4 text-sm text-ink/70">
                {labels.availabilityEmpty}
              </p>
            )}
            <p className="text-xs text-ink/70">{labels.totalNote}</p>
          </section>
        </aside>

        <form
          className="space-y-6 rounded-lg border border-ink/10 bg-bone p-6 shadow-brand"
          noValidate
          onSubmit={onSubmit}
        >
          <fieldset
            aria-describedby={travelerError ? "travelers-error" : undefined}
            className="space-y-5"
          >
            <legend className="font-display text-h3 text-ink">{labels.travelersTitle}</legend>
            {travelers.map((traveler, index) => (
              <div key={index} className="space-y-4 rounded-md border border-ink/10 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className={LABEL_CLASSES} htmlFor={`traveler-${index}-fullName`}>
                      {labels.fullName}
                    </label>
                    <input
                      id={`traveler-${index}-fullName`}
                      className={FIELD_CLASSES}
                      value={traveler.fullName}
                      aria-invalid={Boolean(travelerError)}
                      onChange={(event) =>
                        onTravelerChange?.(index, "fullName", event.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASSES} htmlFor={`traveler-${index}-documentType`}>
                      {labels.documentType}
                    </label>
                    <select
                      id={`traveler-${index}-documentType`}
                      className={FIELD_CLASSES}
                      value={traveler.documentType}
                      aria-invalid={Boolean(travelerError)}
                      onChange={(event) =>
                        onTravelerChange?.(index, "documentType", event.target.value)
                      }
                    >
                      <option value="DNI">{labels.documentTypeDni}</option>
                      <option value="PASSPORT">{labels.documentTypePassport}</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASSES} htmlFor={`traveler-${index}-documentNumber`}>
                      {labels.documentNumber}
                    </label>
                    <input
                      id={`traveler-${index}-documentNumber`}
                      className={FIELD_CLASSES}
                      value={traveler.documentNumber}
                      aria-invalid={Boolean(travelerError)}
                      onChange={(event) =>
                        onTravelerChange?.(index, "documentNumber", event.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASSES} htmlFor={`traveler-${index}-phone`}>
                      {labels.phone}
                    </label>
                    <input
                      id={`traveler-${index}-phone`}
                      type="tel"
                      className={FIELD_CLASSES}
                      value={traveler.phone ?? ""}
                      onChange={(event) => onTravelerChange?.(index, "phone", event.target.value)}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASSES} htmlFor={`traveler-${index}-email`}>
                      {labels.email}
                    </label>
                    <input
                      id={`traveler-${index}-email`}
                      type="email"
                      className={FIELD_CLASSES}
                      value={traveler.email ?? ""}
                      onChange={(event) => onTravelerChange?.(index, "email", event.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="min-h-11 rounded-md border border-ink/20 px-4 text-sm font-medium text-ink hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
                  onClick={() => onRemoveTraveler?.(index)}
                >
                  {labels.removeTraveler}
                </button>
              </div>
            ))}
            {travelerError ? (
              <p
                id="travelers-error"
                role="alert"
                className="rounded-md border border-coral/30 bg-coral/5 p-3 text-sm font-medium text-coral-ink"
              >
                {travelerError}
              </p>
            ) : null}
            {travelers.length < 9 ? (
              <button
                type="button"
                onClick={onAddTraveler}
                className="min-h-11 rounded-md border border-ink/20 px-4 text-sm font-medium text-ink hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
              >
                {labels.addTraveler}
              </button>
            ) : null}
          </fieldset>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-amber px-6 font-semibold text-ink hover:bg-amber/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? labels.reserving : labels.reserve}
          </button>
        </form>
      </div>
    </article>
  );
}
