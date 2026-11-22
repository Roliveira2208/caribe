"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@caribe/shared";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { parseTodayRateView } from "@/lib/today-rate";
import {
  catalogInputFromParams,
  parseCatalogPageView,
  type CatalogPageView,
} from "@/lib/search-view";
import { searchViewLabels } from "@/lib/search-labels";
import { useCatalogDestinations } from "@/lib/use-catalog-destinations";
import { SearchFormView, SearchResultsView, searchApiUrl } from "./search-view";

type LoadStatus = "loading" | "error" | "ready";

/** Parte interactiva de `/[locale]/search`: lee la URL y consulta la API. */
export function SearchExperience({ locale }: { locale: Locale }) {
  const t = useTranslations("search");
  const params = useSearchParams();
  const { input, selectedType, comingSoon, invalidPrice } = catalogInputFromParams(params);
  const resultsUrl = searchApiUrl(input);
  const labels = searchViewLabels(t);
  const destinations = useCatalogDestinations();

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

  useEffect(() => {
    const controller = new AbortController();
    // Las categorías sin datos no se envían a una API que solo acepta hotel.
    if (comingSoon) {
      setPage(null);
      setStatus("ready");
      return;
    }
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
  }, [comingSoon, resultsUrl]);

  return (
    <div className="w-full space-y-6">
      <SearchFormView
        locale={locale}
        destinations={destinations}
        input={{ ...input, type: selectedType }}
        labels={labels}
        priceError={invalidPrice}
      />
      <SearchResultsView
        page={page}
        status={status}
        locale={locale}
        labels={labels}
        rateDate={rateDate}
        comingSoon={comingSoon}
      />
    </div>
  );
}
