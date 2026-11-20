"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@caribe/shared";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { parseTodayRateView } from "@/lib/today-rate";
import {
  catalogInputFromParams,
  extractDestinations,
  parseCatalogPageView,
  type CatalogDestinationView,
  type CatalogPageView,
} from "@/lib/search-view";
import {
  SearchFormView,
  SearchResultsView,
  searchApiUrl,
  type SearchViewLabels,
} from "./search-view";

type LoadStatus = "loading" | "error" | "ready";

/** Parte interactiva de `/[locale]/buscar`: lee la URL y consulta la API. */
export function SearchExperience({ locale }: { locale: Locale }) {
  const t = useTranslations("search");
  const params = useSearchParams();
  const { input, invalidPrice } = catalogInputFromParams(params);
  const resultsUrl = searchApiUrl(input);

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

  const [destinations, setDestinations] = useState<CatalogDestinationView[]>([]);
  const [rateDate, setRateDate] = useState<string | null>(null);
  const [page, setPage] = useState<CatalogPageView | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");

  // La fecha valor del VES se lee una vez: el catálogo solo devuelve el
  // equivalente, no la tasa con la que se calculó.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/rates/today", { signal: controller.signal })
      .then(async (response) => (response.ok ? parseTodayRateView(await response.json()) : null))
      .then((view) => {
        if (controller.signal.aborted) return;
        setRateDate(view?.available ? view.valueDate : null);
      })
      .catch(() => {
        // Sin tasa global el catálogo ya devuelve los importes VES a null.
      });
    return () => controller.abort();
  }, []);

  // No hay endpoint de destinos en F1: se derivan de una lectura acotada del
  // propio catálogo (design.md, decisión 4).
  useEffect(() => {
    const controller = new AbortController();
    fetch(searchApiUrl({ type: "hotel", limit: 50 }, 50), { signal: controller.signal })
      .then(async (response) => (response.ok ? parseCatalogPageView(await response.json()) : null))
      .then((catalog) => {
        if (controller.signal.aborted || !catalog) return;
        setDestinations(extractDestinations(catalog.items));
      })
      .catch(() => {
        // El selector sigue siendo usable con la opción "todos los destinos".
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");

    const load = async (): Promise<void> => {
      try {
        const response = await fetch(resultsUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const catalog = parseCatalogPageView(await response.json());
        if (controller.signal.aborted) return;
        if (!catalog) {
          setPage(null);
          setStatus("error");
          return;
        }
        setPage(catalog);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) {
          setPage(null);
          setStatus("error");
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [resultsUrl]);

  return (
    <div className="w-full space-y-6">
      <SearchFormView
        locale={locale}
        destinations={destinations}
        input={input}
        labels={labels}
        priceError={invalidPrice}
      />
      <SearchResultsView
        page={page}
        status={status}
        locale={locale}
        labels={labels}
        rateDate={rateDate}
      />
    </div>
  );
}
