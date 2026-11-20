import type { Locale } from "@caribe/shared";
import {
  buildCatalogQuery,
  formatUsd,
  formatVes,
  formatValueDate,
  localizedText,
  type CatalogSearchInput,
} from "@/lib/catalog-view";
import type { CatalogDestinationView, CatalogOfferView, CatalogPageView } from "@/lib/search-view";

/**
 * Vista de búsqueda (change public-rate-and-price-filters). Las dos piezas
 * exportadas son puras: reciben textos ya traducidos y datos ya validados, así
 * que se prueban con `react-dom/server` sin jsdom. La interacción con la API
 * vive en `SearchExperience`.
 */

export interface SearchViewLabels {
  title: string;
  subtitle: string;
  anyDestination: string;
  destination: string;
  checkIn: string;
  checkOut: string;
  guests: string;
  type: string;
  typeTour: string;
  typeHotel: string;
  typePackage: string;
  typeFlight: string;
  comingSoon: string;
  minPrice: string;
  maxPrice: string;
  priceError: string;
  search: string;
  results: string;
  loading: string;
  error: string;
  emptyTitle: string;
  emptyDescription: string;
  viewDetail: string;
  rateLabel: string;
}

interface SearchFormProps {
  locale: Locale;
  destinations: CatalogDestinationView[];
  input: CatalogSearchInput;
  labels: SearchViewLabels;
  priceError?: boolean;
}

interface SearchResultsProps {
  page: CatalogPageView | null;
  status: "loading" | "error" | "ready";
  locale: Locale;
  labels: SearchViewLabels;
  /** Fecha valor de la tasa global; `null` cuando no hay tasa. */
  rateDate: string | null;
}

const FIELD_CLASSES =
  "mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700";

/** Buscador y filtros: un formulario GET conserva la URL y funciona sin JS. */
export function SearchFormView({
  locale,
  destinations,
  input,
  labels,
  priceError = false,
}: SearchFormProps) {
  return (
    <section className="w-full space-y-5">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-brand-800">{labels.title}</h1>
        <p className="text-sm text-slate-600">{labels.subtitle}</p>
      </div>

      <form
        action={`/${locale}/buscar`}
        method="get"
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6"
      >
        <div className="lg:col-span-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="search-destination">
            {labels.destination}
          </label>
          <select
            id="search-destination"
            name="destinationId"
            defaultValue={input.destinationId ?? ""}
            className={FIELD_CLASSES}
          >
            <option value="">{labels.anyDestination}</option>
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {localizedText(destination.name, locale)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700" htmlFor="search-check-in">
            {labels.checkIn}
          </label>
          <input
            id="search-check-in"
            name="checkIn"
            type="date"
            defaultValue={input.checkIn ?? ""}
            className={FIELD_CLASSES}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700" htmlFor="search-check-out">
            {labels.checkOut}
          </label>
          <input
            id="search-check-out"
            name="checkOut"
            type="date"
            defaultValue={input.checkOut ?? ""}
            min={input.checkIn ?? undefined}
            className={FIELD_CLASSES}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700" htmlFor="search-guests">
            {labels.guests}
          </label>
          <input
            id="search-guests"
            name="guests"
            type="number"
            min={1}
            max={20}
            defaultValue={input.guests ?? ""}
            className={FIELD_CLASSES}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700" htmlFor="search-type">
            {labels.type}
          </label>
          <select id="search-type" name="type" defaultValue="hotel" className={FIELD_CLASSES}>
            <option value="tour" disabled>
              {labels.typeTour} · {labels.comingSoon}
            </option>
            <option value="hotel">{labels.typeHotel}</option>
            <option value="package" disabled>
              {labels.typePackage} · {labels.comingSoon}
            </option>
            <option value="flight" disabled>
              {labels.typeFlight} · {labels.comingSoon}
            </option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700" htmlFor="search-min-price">
            {labels.minPrice}
          </label>
          <input
            id="search-min-price"
            name="minPriceUsd"
            type="text"
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]{1,2})?"
            defaultValue={input.minPriceUsd ?? ""}
            aria-invalid={priceError || undefined}
            className={FIELD_CLASSES}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700" htmlFor="search-max-price">
            {labels.maxPrice}
          </label>
          <input
            id="search-max-price"
            name="maxPriceUsd"
            type="text"
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]{1,2})?"
            defaultValue={input.maxPriceUsd ?? ""}
            aria-invalid={priceError || undefined}
            className={FIELD_CLASSES}
          />
        </div>

        <div className="flex items-end sm:col-span-2 lg:col-span-2">
          <button
            type="submit"
            className="h-11 w-full rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-800"
          >
            {labels.search}
          </button>
        </div>

        {priceError ? (
          <p role="alert" className="text-sm text-red-700 sm:col-span-2 lg:col-span-6">
            {labels.priceError}
          </p>
        ) : null}
      </form>
    </section>
  );
}

/** Precio visible de la oferta: total de la estancia si se enviaron fechas. */
function visiblePrice(offer: CatalogOfferView): { usd: string; ves: string | null } {
  return offer.totalUsd !== null
    ? { usd: offer.totalUsd, ves: offer.totalVes }
    : { usd: offer.basePriceUsd, ves: offer.basePriceVes };
}

function OfferCard({
  offer,
  locale,
  labels,
  rateDate,
}: {
  offer: CatalogOfferView;
  locale: Locale;
  labels: SearchViewLabels;
  rateDate: string | null;
}) {
  const price = visiblePrice(offer);
  const title = localizedText(offer.title, locale);
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby={`offer-${offer.id}`}>
      <h2 id={`offer-${offer.id}`} className="text-lg font-semibold text-brand-800">
        {title}
      </h2>
      <p className="text-sm text-slate-600">
        {localizedText(offer.destination.name, locale)} · {offer.roomType}
      </p>
      <p className="mt-2 text-lg font-bold text-slate-900">{formatUsd(price.usd, locale)}</p>
      {price.ves !== null ? (
        <p className="text-xs text-slate-600">
          ≈ {formatVes(price.ves, locale)} · {labels.rateLabel}
          {rateDate ? ` ${formatValueDate(rateDate, locale)}` : ""}
        </p>
      ) : null}
      <a
        className="mt-3 inline-flex h-11 items-center rounded-md border border-brand-700 px-4 text-sm font-medium text-brand-800 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        href={`/${locale}/hoteles/${offer.id}`}
      >
        {labels.viewDetail}
      </a>
    </article>
  );
}

/** Resultados, estados vacíos y estados de carga/error con anuncios accesibles. */
export function SearchResultsView({
  page,
  status,
  locale,
  labels,
  rateDate,
}: SearchResultsProps) {
  if (status === "loading") {
    return (
      <p role="status" aria-live="polite" className="text-sm text-slate-600">
        {labels.loading}
      </p>
    );
  }
  if (status === "error") {
    return (
      <p role="alert" className="text-sm text-red-700">
        {labels.error}
      </p>
    );
  }
  if (!page || page.items.length === 0) {
    return (
      <div role="status" aria-live="polite" className="space-y-1 rounded-xl border border-dashed border-slate-300 p-8 text-center">
        <p className="font-semibold text-slate-800">{labels.emptyTitle}</p>
        <p className="text-sm text-slate-600">{labels.emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="text-sm font-medium text-slate-700">
        {page.items.length} {labels.results}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {page.items.map((offer) => (
          <li key={offer.id}>
            <OfferCard offer={offer} locale={locale} labels={labels} rateDate={rateDate} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Construye la URL de la API para una búsqueda concreta. */
export function searchApiUrl(input: CatalogSearchInput, limit = 20): string {
  const query = buildCatalogQuery({ ...input, limit });
  return query ? `/api/v1/products?${query}` : "/api/v1/products";
}
