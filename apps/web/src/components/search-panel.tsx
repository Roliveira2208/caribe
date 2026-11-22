import type { Locale } from "@caribe/shared";
import { localizedPath } from "@/lib/localized-path";
import { localizedText, type CatalogSearchInput } from "@/lib/catalog-view";
import type { SearchViewLabels } from "@/lib/search-labels";
import type { CatalogDestinationView } from "@/lib/search-view";

export type { SearchViewLabels } from "@/lib/search-labels";

interface SearchPanelProps {
  locale: Locale;
  destinations: CatalogDestinationView[];
  input: CatalogSearchInput;
  labels: SearchViewLabels;
  priceError?: boolean;
  /** Activa el stagger del gesto de revelacion en la portada. */
  stagger?: boolean;
}

const FIELD_CLASSES =
  "mt-1 h-11 w-full rounded border border-ink/20 bg-bone px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber";
const LABEL_CLASSES = "text-sm font-medium text-ink";

/**
 * Panel compartido entre inicio y busqueda. Es un formulario GET: conserva la
 * URL, funciona sin JavaScript y mantiene los mismos nombres de campo.
 */
export function SearchPanel({
  locale,
  destinations,
  input,
  labels,
  priceError = false,
  stagger = false,
}: SearchPanelProps) {
  const field = (extra = "") => (stagger ? `reveal-field ${extra}` : extra);

  return (
    <form
      action={localizedPath(locale, "/search")}
      method="get"
      className="grid gap-4 rounded-xl border border-ink/10 bg-bone p-5 shadow-brand sm:grid-cols-2 lg:grid-cols-6"
    >
      <div className={field("lg:col-span-2")}>
        <label className={LABEL_CLASSES} htmlFor="search-destination">
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

      <div className={field()}>
        <label className={LABEL_CLASSES} htmlFor="search-check-in">
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

      <div className={field()}>
        <label className={LABEL_CLASSES} htmlFor="search-check-out">
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

      <div className={field()}>
        <label className={LABEL_CLASSES} htmlFor="search-guests">
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

      <div className={field()}>
        <label className={LABEL_CLASSES} htmlFor="search-type">
          {labels.type}
        </label>
        <select
          id="search-type"
          name="type"
          defaultValue={input.type ?? "hotel"}
          className={FIELD_CLASSES}
        >
          <option value="hotel">{labels.typeHotel}</option>
          <option value="tour">
            {labels.typeTour} ({labels.comingSoon})
          </option>
          <option value="package">
            {labels.typePackage} ({labels.comingSoon})
          </option>
          <option value="flight">
            {labels.typeFlight} ({labels.comingSoon})
          </option>
        </select>
      </div>

      <div className={field()}>
        <label className={LABEL_CLASSES} htmlFor="search-min-price">
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

      <div className={field()}>
        <label className={LABEL_CLASSES} htmlFor="search-max-price">
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

      <div className={field("flex items-end sm:col-span-2 lg:col-span-2")}>
        <button
          type="submit"
          className="h-11 w-full rounded-md bg-amber px-4 text-sm font-semibold text-ink hover:bg-amber/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
        >
          {labels.search}
        </button>
      </div>

      {priceError ? (
        <p role="alert" className="text-sm text-coral-ink sm:col-span-2 lg:col-span-6">
          {labels.priceError}
        </p>
      ) : null}
    </form>
  );
}
