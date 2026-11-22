/** Textos ya traducidos que consume el formulario compartido de búsqueda. */
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
  comingSoonTitle: string;
  comingSoonDescription: string;
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

type Translate = (key: string) => string;

/** Claves del namespace `search`; una sola lista para ambas páginas. */
const KEYS = {
  title: "title",
  subtitle: "subtitle",
  anyDestination: "anyDestination",
  destination: "destination",
  checkIn: "checkIn",
  checkOut: "checkOut",
  guests: "guests",
  type: "type",
  typeTour: "typeTour",
  typeHotel: "typeHotel",
  typePackage: "typePackage",
  typeFlight: "typeFlight",
  comingSoon: "comingSoon",
  comingSoonTitle: "comingSoonTitle",
  comingSoonDescription: "comingSoonDescription",
  minPrice: "minPrice",
  maxPrice: "maxPrice",
  priceError: "priceError",
  search: "search",
  results: "results",
  loading: "loading",
  error: "error",
  emptyTitle: "emptyTitle",
  emptyDescription: "emptyDescription",
  viewDetail: "viewDetail",
  rateLabel: "rateLabel",
} as const satisfies Record<keyof SearchViewLabels, string>;

/**
 * Unica construcción de etiquetas del buscador, compartida por la portada y
 * `/search`. Así no puede aparecer una segunda implementación divergente.
 */
export function searchViewLabels(t: Translate): SearchViewLabels {
  return {
    title: t(KEYS.title),
    subtitle: t(KEYS.subtitle),
    anyDestination: t(KEYS.anyDestination),
    destination: t(KEYS.destination),
    checkIn: t(KEYS.checkIn),
    checkOut: t(KEYS.checkOut),
    guests: t(KEYS.guests),
    type: t(KEYS.type),
    typeTour: t(KEYS.typeTour),
    typeHotel: t(KEYS.typeHotel),
    typePackage: t(KEYS.typePackage),
    typeFlight: t(KEYS.typeFlight),
    comingSoon: t(KEYS.comingSoon),
    comingSoonTitle: t(KEYS.comingSoonTitle),
    comingSoonDescription: t(KEYS.comingSoonDescription),
    minPrice: t(KEYS.minPrice),
    maxPrice: t(KEYS.maxPrice),
    priceError: t(KEYS.priceError),
    search: t(KEYS.search),
    results: t(KEYS.results),
    loading: t(KEYS.loading),
    error: t(KEYS.error),
    emptyTitle: t(KEYS.emptyTitle),
    emptyDescription: t(KEYS.emptyDescription),
    viewDetail: t(KEYS.viewDetail),
    rateLabel: t(KEYS.rateLabel),
  };
}
