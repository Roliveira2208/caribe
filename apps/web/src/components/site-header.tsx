import { DEFAULT_LOCALE, isLocale } from "@caribe/shared";
import { getLocale, getTranslations } from "next-intl/server";
import { loadTodayRateLabels } from "@/lib/today-rate-labels";
import { LanguageSwitcher } from "./language-switcher";
import { SessionNav } from "./session-nav";
import { TodayRateBadge } from "./today-rate-badge";

/** Cabecera del shell de la web: marca, tasa del día, sesion e idioma. */
export async function SiteHeader() {
  const [t, labels, requestedLocale] = await Promise.all([
    getTranslations("nav"),
    loadTodayRateLabels(),
    getLocale(),
  ]);
  const locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-lg font-bold text-brand-700">{t("appName")}</p>
          <p className="text-xs text-slate-500">{t("tagline")}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <TodayRateBadge locale={locale} labels={labels} />
          <LanguageSwitcher />
          <SessionNav />
        </div>
      </div>
    </header>
  );
}
