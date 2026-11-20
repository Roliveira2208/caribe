"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@caribe/shared";
import { formatRate, formatValueDate } from "@/lib/catalog-view";
import { parseTodayRateView, UNAVAILABLE_RATE, type TodayRateView } from "@/lib/today-rate";

/** Textos visibles del badge, ya traducidos por el servidor. */
export interface TodayRateBadgeLabels {
  label: string;
  unit: string;
  unavailable: string;
  loading: string;
}

interface BadgeProps {
  view: TodayRateView | null;
  locale: Locale;
  labels: TodayRateBadgeLabels;
}

const BASE_CLASSES =
  "inline-flex items-center rounded-md border px-2 py-1 text-xs leading-6 min-h-8";
const AVAILABLE_CLASSES = `${BASE_CLASSES} border-brand-200 bg-brand-50 font-medium text-brand-800`;
const MUTED_CLASSES = `${BASE_CLASSES} border-slate-200 bg-slate-100 text-slate-700`;

/**
 * Parte presentacional del badge. Es pura y se renderiza en el servidor en los
 * tests con `react-dom/server`: no consulta el DOM ni usa hooks.
 */
export function TodayRateBadgeContent({ view, locale, labels }: BadgeProps) {
  if (view?.available && view.rate !== null && view.valueDate !== null) {
    const text = `${labels.label} ${formatRate(view.rate, locale)} ${labels.unit} · ${formatValueDate(view.valueDate, locale)}`;
    return (
      <p role="status" aria-live="polite" className={AVAILABLE_CLASSES}>
        {text}
      </p>
    );
  }

  const text = view === null ? labels.loading : labels.unavailable;
  return (
    <p role="status" aria-live="polite" className={MUTED_CLASSES}>
      {text}
    </p>
  );
}

/**
 * Badge de la tasa BCV del día en la cabecera. Lee el endpoint público por el
 * rewrite de primera parte (`/api/v1/rates/today`) y nunca dispara al
 * proveedor: una lectura anónima no tiene efectos. Si la red falla, muestra el
 * mismo estado discreto que cuando no hay tasa global.
 */
export function TodayRateBadge({ locale, labels }: Omit<BadgeProps, "view">) {
  const [view, setView] = useState<TodayRateView | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/v1/rates/today", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return { ...UNAVAILABLE_RATE };
        return parseTodayRateView(await response.json()) ?? { ...UNAVAILABLE_RATE };
      })
      .then((next) => {
        if (!controller.signal.aborted) setView(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setView({ ...UNAVAILABLE_RATE });
      });

    return () => controller.abort();
  }, []);

  return <TodayRateBadgeContent view={view} locale={locale} labels={labels} />;
}
