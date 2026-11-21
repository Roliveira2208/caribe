import type { Locale } from "@caribe/shared";
import { localizedPath } from "@/lib/localized-path";
import {
  buildCatalogQuery,
  formatUsd,
  formatVes,
  formatValueDate,
  localizedText,
  type CatalogSearchInput,
} from "@/lib/catalog-view";
import type { CatalogDestinationView, CatalogOfferView, CatalogPageView } from "@/lib/search-view";
import { SearchPanel, type SearchViewLabels } from "./search-panel";

export type { SearchViewLabels } from "./search-panel";

/**
 * Vista de busqueda (change f1-visual-identity). Las piezas exportadas son
 * puras: reciben textos ya traducidos y datos validados, así que se prueban con
 * `react-dom/server`. La interaccion con la API vive en `SearchExperience`.
 */
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

/** Buscador y filtros: reutiliza el panel de la portada sin revelacion. */
export function SearchFormView({
  locale,
  destinations,
  input,
  labels,
  priceError = false,
}: SearchFormProps) {
  return (
    <section className="w-full space-y-5">
      <div className="space-y-2">
        <h1 className="font-display text-h2 text-ink">{labels.title}</h1>
        <p className="max-w-2xl text-body-lg text-ink/70">{labels.subtitle}</p>
      </div>
      <SearchPanel
        locale={locale}
        destinations={destinations}
        input={input}
        labels={labels}
        priceError={priceError}
      />
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
    <article
      className="flex h-full flex-col rounded-lg border border-ink/10 bg-bone p-5 shadow-brand"
      aria-labelledby={`offer-${offer.id}`}
    >
      <h2 id={`offer-${offer.id}`} className="font-display text-h4 text-ink">
        {title}
      </h2>
      <p className="mt-1 text-sm font-medium text-teal-ink">
        {localizedText(offer.destination.name, locale)}
      </p>
      <p className="text-sm text-ink/70">{offer.roomType}</p>
      <div className="mt-4">
        <p className="text-xl font-semibold text-ink">{formatUsd(price.usd, locale)}</p>
        {price.ves !== null ? (
          <p className="text-xs text-ink/70">
            {labels.rateLabel} {formatVes(price.ves, locale)}
            {rateDate ? ` ${formatValueDate(rateDate, locale)}` : ""}
          </p>
        ) : null}
      </div>
      <a
        className="mt-5 inline-flex h-11 items-center rounded-md bg-ink px-4 text-sm font-medium text-bone hover:bg-ink/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
        href={localizedPath(locale, "/hotels/[id]", { id: offer.id })}
      >
        {labels.viewDetail}
      </a>
    </article>
  );
}

/** Resultados, estados vacios y estados de carga/error con anuncios accesibles. */
export function SearchResultsView({
  page,
  status,
  locale,
  labels,
  rateDate,
}: SearchResultsProps) {
  if (status === "loading") {
    return (
      <p role="status" aria-live="polite" className="text-base text-ink/70">
        {labels.loading}
      </p>
    );
  }
  if (status === "error") {
    return (
      <p role="alert" className="rounded-md border border-coral/30 bg-coral/5 p-4 text-coral-ink">
        {labels.error}
      </p>
    );
  }
  if (!page || page.items.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="space-y-1 rounded-lg border border-dashed border-ink/25 p-8 text-center"
      >
        <p className="font-display text-h4 text-ink">{labels.emptyTitle}</p>
        <p className="text-sm text-ink/70">{labels.emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
        {page.items.length} {labels.results}
      </p>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {page.items.map((offer) => (
          <li key={offer.id}>
            <OfferCard offer={offer} locale={locale} labels={labels} rateDate={rateDate} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Construye la URL de la API para una busqueda concreta. */
export function searchApiUrl(input: CatalogSearchInput, limit = 20): string {
  const query = buildCatalogQuery({ ...input, limit });
  return query ? `/api/v1/products?${query}` : "/api/v1/products";
}
