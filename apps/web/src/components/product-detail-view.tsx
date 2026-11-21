import type { Locale } from "@caribe/shared";
import Image from "next/image";
import {
  formatUsd,
  formatValueDate,
  formatVes,
  localizedText,
} from "@/lib/catalog-view";
import {
  firstBookableNight,
  nextDay,
  type CatalogAvailabilityView,
  type CatalogProductDetailView,
  type StaySelection,
} from "@/lib/detail-view";

/**
 * Vista pura del detalle (change f1-visual-identity). Recibe textos ya
 * traducidos y datos validados, así que se prueba con `react-dom/server`.
 * La interacción con la API vive en `ProductDetailExperience`.
 */
export interface DetailViewLabels {
  loading: string;
  error: string;
  notFound: string;
  backToSearch: string;
  noPhotos: string;
  basePrice: string;
  vesLabel: string;
  amenitiesTitle: string;
  availabilityTitle: string;
  availabilityEmpty: string;
  remaining: string;
  cancellationTitle: string;
  ruleTemplate: (hours: number, percent: number) => string;
  cancellationNone: string;
  reserve: string;
  unavailable: string;
}

export type DetailStatus = "loading" | "error" | "not-found" | "ready";

interface ProductDetailViewProps {
  locale: Locale;
  productId: string;
  product: CatalogProductDetailView | null;
  availability: CatalogAvailabilityView | null;
  selection: StaySelection;
  status: DetailStatus;
  labels: DetailViewLabels;
}

function BackToSearch({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center rounded-md border border-ink/20 px-4 text-sm font-medium text-ink hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
    >
      {label}
    </a>
  );
}

/** Galería con estado explícito cuando el producto no publica fotos. */
function Gallery({
  product,
  labels,
}: {
  product: CatalogProductDetailView;
  labels: DetailViewLabels;
}) {
  const title = localizedText(product.title, "es") || localizedText(product.title, "en");
  if (product.attributes.images.length === 0) {
    return (
      <div
        role="img"
        aria-label={labels.noPhotos}
        className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-ink shadow-brand"
      >
        <div aria-hidden="true" className="flex h-full w-full">
          <div className="w-1/3 bg-amber" />
          <div className="w-1/6 bg-teal" />
          <div className="flex-1 bg-bone" />
        </div>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {product.attributes.images.map((image, index) => (
        <li
          key={`${image}-${index}`}
          className="relative aspect-[4/3] overflow-hidden rounded-lg bg-ink shadow-brand"
        >
          <Image
            src={image}
            alt={title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
            priority={index === 0}
          />
        </li>
      ))}
    </ul>
  );
}

function Availability({
  availability,
  locale,
  labels,
}: {
  availability: CatalogAvailabilityView;
  locale: Locale;
  labels: DetailViewLabels;
}) {
  if (availability.nights.length === 0) {
    return (
      <p role="status" aria-live="polite" className="rounded-lg border border-dashed border-ink/25 p-6 text-center text-sm text-ink/70">
        {labels.availabilityEmpty}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-ink/10 rounded-lg border border-ink/10 bg-bone">
      {availability.nights.map((night) => (
        <li key={night.night} className="flex flex-wrap items-baseline justify-between gap-2 p-4">
          <div className="space-y-1">
            <p className="font-medium text-ink">{formatValueDate(night.night, locale)}</p>
            <p className="text-sm text-ink/70">
              {night.remaining} {labels.remaining}
            </p>
          </div>
          <div className="text-right">
            <p className="font-semibold text-ink">{formatUsd(night.priceUsd, locale)}</p>
            {night.priceVes !== null ? (
              <p className="text-xs text-ink/70">
                {labels.vesLabel} {formatVes(night.priceVes, locale)}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ProductDetailView({
  locale,
  productId,
  product,
  availability,
  selection,
  status,
  labels,
}: ProductDetailViewProps) {
  const searchHref = `/${locale}/buscar`;
  if (status === "loading") {
    return (
      <p
        role="status"
        aria-live="polite"
        data-detail-status="loading"
        className="text-base text-ink/70"
      >
        {labels.loading}
      </p>
    );
  }
  if (status !== "ready" || !product) {
    return (
      <div
        data-detail-status={status}
        className="max-w-xl space-y-4 rounded-lg border border-coral/30 bg-coral/5 p-6"
      >
        <p role="alert" className="font-display text-h4 text-coral-ink">
          {status === "not-found" ? labels.notFound : labels.error}
        </p>
        <BackToSearch href={searchHref} label={labels.backToSearch} />
      </div>
    );
  }

  const title = localizedText(product.title, locale);
  const description = localizedText(product.description, locale);
  const checkIn = selection.checkIn ?? firstBookableNight(availability);
  const checkOut = selection.checkOut ?? (checkIn ? nextDay(checkIn) : undefined);
  const guests = selection.guests;
  const canReserve = Boolean(checkIn && checkOut && availability && firstBookableNight(availability));
  const query = new URLSearchParams({
    checkIn: checkIn ?? "",
    checkOut: checkOut ?? "",
    guests: String(guests),
  });
  const reserveHref = `/${locale}/checkout/${productId}?${query.toString()}`;

  return (
    <article data-detail-status="ready" className="w-full space-y-8">
      <div className="space-y-3">
        <BackToSearch href={searchHref} label={labels.backToSearch} />
        <h1 className="font-display text-h1 text-ink">{title}</h1>
        <p className="text-body-lg text-ink/70">{localizedText(product.destination.name, locale)}</p>
        <p className="text-sm font-medium text-teal-ink">{product.roomType}</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <div className="space-y-8">
          <Gallery product={product} labels={labels} />
          {description ? <p className="max-w-2xl text-body-lg text-ink/80">{description}</p> : null}
          {product.attributes.amenities.length > 0 ? (
            <section className="space-y-2">
              <h2 className="font-display text-h4 text-ink">{labels.amenitiesTitle}</h2>
              <ul className="flex flex-wrap gap-2">
                {product.attributes.amenities.map((amenity) => (
                  <li
                    key={amenity}
                    className="rounded border border-ink/15 px-3 py-1 text-sm text-ink/80"
                  >
                    {amenity}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6 rounded-lg border border-ink/10 bg-bone p-6 shadow-brand lg:sticky lg:top-24">
          <div className="space-y-1">
            <p className="text-sm text-ink/70">{labels.basePrice}</p>
            <p className="font-display text-h3 text-ink">{formatUsd(product.basePriceUsd, locale)}</p>
            {product.basePriceVes !== null ? (
              <p className="text-sm text-ink/70">
                {labels.vesLabel} {formatVes(product.basePriceVes, locale)}
              </p>
            ) : null}
          </div>

          <section className="space-y-3">
            <h2 className="font-display text-h4 text-ink">{labels.availabilityTitle}</h2>
            {availability ? (
              <Availability availability={availability} locale={locale} labels={labels} />
            ) : (
              <p role="status" className="text-sm text-ink/70">
                {labels.availabilityEmpty}
              </p>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-h4 text-ink">{labels.cancellationTitle}</h2>
            {product.cancellationPolicy ? (
              <div className="space-y-2 text-sm text-ink/80">
                <p className="font-medium text-ink">{product.cancellationPolicy.name}</p>
                <ul className="space-y-1">
                  {product.cancellationPolicy.rules.map((rule) => (
                    <li key={rule.hoursBefore}>
                      {labels.ruleTemplate(rule.hoursBefore, rule.percentage)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-ink/70">{labels.cancellationNone}</p>
            )}
          </section>

          {canReserve ? (
            <a
              href={reserveHref}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-amber px-6 font-semibold text-ink hover:bg-amber/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
            >
              {labels.reserve}
            </a>
          ) : (
            <p role="status" className="rounded-md bg-ink/5 p-4 text-center text-sm font-medium text-ink">
              {labels.unavailable}
            </p>
          )}
        </aside>
      </div>
    </article>
  );
}
