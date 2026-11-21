"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@caribe/shared";
import { useTranslations } from "next-intl";
import { localizedText } from "@/lib/catalog-view";
import { featuredApiUrl, FEATURED_LIMIT, featuredUsd, featuredVes } from "@/lib/featured-view";
import { localizedPath } from "@/lib/localized-path";
import { parseCatalogPageView, type CatalogOfferView } from "@/lib/search-view";

export interface FeaturedLabels {
  title: string;
  subtitle: string;
  loading: string;
  empty: string;
  viewDetail: string;
  rateLabel: string;
  tour: string;
  package: string;
  flight: string;
  comingSoon: string;
}

interface FeaturedStaysViewProps {
  items: CatalogOfferView[];
  status: "loading" | "ready";
  locale: Locale;
  labels: FeaturedLabels;
}

/**
 * Vista pura de destacados. Recibe datos ya validados por `parseCatalogPageView`:
 * no inventa productos, precios ni destinos cuando la API no responde.
 */
export function FeaturedStaysView({ items, status, locale, labels }: FeaturedStaysViewProps) {
  const soon = [labels.tour, labels.package, labels.flight];

  return (
    <section id="destacados" className="scroll-target border-t border-ink/10 bg-bone py-16">
      <div className="mx-auto max-w-6xl space-y-8 px-5 lg:px-10">
        <div className="max-w-2xl space-y-2">
          <h2 className="scroll-rise font-display text-h2 text-ink">{labels.title}</h2>
          <p className="scroll-rise text-body-lg text-ink/70">{labels.subtitle}</p>
        </div>

        {status === "loading" ? (
          <p role="status" aria-live="polite" className="text-sm text-ink/70">
            {labels.loading}
          </p>
        ) : items.length === 0 ? (
          <p role="status" aria-live="polite" className="rounded-md border border-ink/10 p-4 text-ink/70">
            {labels.empty}
          </p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((offer) => {
              const ves = featuredVes(offer, locale);
              return (
                <li key={offer.id} className="featured-card scroll-rise">
                  <article className="flex h-full flex-col rounded-lg border border-ink/10 bg-bone p-5 shadow-brand">
                    <p className="text-xs font-semibold uppercase tracking-wide text-teal-ink">
                      {localizedText(offer.destination.name, locale)}
                    </p>
                    <h3 className="mt-2 font-display text-h4 text-ink">
                      {localizedText(offer.title, locale)}
                    </h3>
                    <p className="text-sm text-ink/70">{offer.roomType}</p>
                    <p className="mt-4 text-xl font-semibold text-ink">
                      {featuredUsd(offer, locale)}
                    </p>
                    {ves !== null ? (
                      <p className="text-xs text-ink/70">
                        {labels.rateLabel} {ves}
                      </p>
                    ) : null}
                    <a
                      className="mt-5 inline-flex h-11 items-center rounded-md bg-ink px-4 text-sm font-medium text-bone hover:bg-ink/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
                      href={localizedPath(locale, "/hotels/[id]", { id: offer.id })}
                    >
                      {labels.viewDetail}
                    </a>
                  </article>
                </li>
              );
            })}
          </ul>
        )}

        <ul className="grid gap-3 sm:grid-cols-3">
          {soon.map((label) => (
            <li
              key={label}
              className="scroll-rise flex items-center justify-between gap-3 rounded-lg border border-dashed border-ink/20 px-4 py-3 text-sm text-ink/70"
            >
              <span>{label}</span>
              <span className="rounded-full bg-teal/10 px-2 py-1 text-xs font-semibold text-teal-ink">
                {labels.comingSoon}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Destacados reales: solo se muestran los productos que devuelve la API. */
export function FeaturedStays({ locale, labels }: { locale: Locale; labels: FeaturedLabels }) {
  const [items, setItems] = useState<CatalogOfferView[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");

    fetch(featuredApiUrl(), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseCatalogPageView(await response.json());
      })
      .then((page) => {
        setItems(page?.items.slice(0, FEATURED_LIMIT) ?? []);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setItems([]);
        setStatus("ready");
      });

    return () => controller.abort();
  }, []);

  return (
    <div data-featured-status={status}>
      <FeaturedStaysView items={items} status={status} locale={locale} labels={labels} />
    </div>
  );
}

/** Panel de la portada: textos traducidos y sin destinos ni precios de ejemplo. */
export function FeaturedStaysPanel({ locale }: { locale: Locale }) {
  const t = useTranslations("home");
  const labels: FeaturedLabels = {
    title: t("featuredTitle"),
    subtitle: t("featuredSubtitle"),
    loading: t("featuredLoading"),
    empty: t("featuredEmpty"),
    viewDetail: t("featuredViewDetail"),
    rateLabel: t("featuredRateLabel"),
    tour: t("featuredTour"),
    package: t("featuredPackage"),
    flight: t("featuredFlight"),
    comingSoon: t("featuredComingSoon"),
  };
  return <FeaturedStays locale={locale} labels={labels} />;
}
