"use client";

import type { Locale } from "@caribe/shared";
import { useTranslations } from "next-intl";
import { searchViewLabels } from "@/lib/search-labels";
import { useCatalogDestinations } from "@/lib/use-catalog-destinations";
import { SearchPanel } from "./search-panel";

/** Panel de la portada: mismo formulario y datos que `/search`, con stagger. */
export function HomeSearchPanel({ locale }: { locale: Locale }) {
  const labels = searchViewLabels(useTranslations("search"));
  const destinations = useCatalogDestinations();

  return <SearchPanel locale={locale} destinations={destinations} input={{}} labels={labels} stagger />;
}
