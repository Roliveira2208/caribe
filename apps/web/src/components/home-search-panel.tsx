import type { Locale } from "@caribe/shared";
import { getTranslations } from "next-intl/server";
import { SearchPanel, type SearchViewLabels } from "./search-panel";

/** Panel de la portada: sin destinos precargados y con el stagger activado. */
export async function HomeSearchPanel({ locale }: { locale: Locale }) {
  const t = await getTranslations("search");
  const labels: SearchViewLabels = {
    title: t("title"),
    subtitle: t("subtitle"),
    anyDestination: t("anyDestination"),
    destination: t("destination"),
    checkIn: t("checkIn"),
    checkOut: t("checkOut"),
    guests: t("guests"),
    type: t("type"),
    typeTour: t("typeTour"),
    typeHotel: t("typeHotel"),
    typePackage: t("typePackage"),
    typeFlight: t("typeFlight"),
    comingSoon: t("comingSoon"),
    minPrice: t("minPrice"),
    maxPrice: t("maxPrice"),
    priceError: t("priceError"),
    search: t("search"),
    results: t("results"),
    loading: t("loading"),
    error: t("error"),
    emptyTitle: t("emptyTitle"),
    emptyDescription: t("emptyDescription"),
    viewDetail: t("viewDetail"),
    rateLabel: t("rateLabel"),
  };

  return <SearchPanel locale={locale} destinations={[]} input={{}} labels={labels} stagger />;
}
