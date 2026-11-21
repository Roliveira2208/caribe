import type { Locale } from "@caribe/shared";
import { formatUsd, formatVes, localizedText } from "./catalog-view";
import type { CatalogOfferView } from "./search-view";

/** Tres destacados: el mismo número de tarjetas que caben en una fila ancha. */
export const FEATURED_LIMIT = 3;

/**
 * La portada pide solo alojamientos publicados. El prefijo `/api` lo resuelve
 * el rewrite de Next hacia la API; no se exponen URLs absolutas al cliente.
 */
export function featuredApiUrl(limit: number = FEATURED_LIMIT): string {
  return `/api/v1/products?limit=${limit}&type=hotel`;
}

/** Precio de la tarjeta destacada: nunca se calcula en la web. */
export function featuredPrice(offer: CatalogOfferView): { usd: string; ves: string | null } {
  return {
    usd: offer.basePriceUsd,
    ves: offer.basePriceVes,
  };
}

export function featuredTitle(offer: CatalogOfferView, locale: Locale): string {
  return localizedText(offer.title, locale);
}

export function featuredUsd(offer: CatalogOfferView, locale: Locale): string {
  return formatUsd(featuredPrice(offer).usd, locale);
}

export function featuredVes(offer: CatalogOfferView, locale: Locale): string | null {
  const ves = featuredPrice(offer).ves;
  return ves === null ? null : formatVes(ves, locale);
}
