import { DEFAULT_LOCALE, isLocale } from "@caribe/shared";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadTodayRateLabels } from "@/lib/today-rate-labels";
import { HeaderFrame } from "./header-frame";
import { LanguageSwitcher } from "./language-switcher";
import { SessionNav } from "./session-nav";
import { TodayRateBadge } from "./today-rate-badge";

/** Cabecera de la web: wordmark de texto, tasa, idioma y sesion. */
export async function SiteHeader() {
  const [t, labels, requestedLocale] = await Promise.all([
    getTranslations("nav"),
    loadTodayRateLabels(),
    getLocale(),
  ]);
  const locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;

  return (
    <HeaderFrame
      menuLabel={t("menu")}
      brand={
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
        >
          <span className="size-2 bg-amber" aria-hidden="true" />
          <span className="font-display text-2xl font-semibold tracking-tight text-bone">
            {t("appName")}
          </span>
        </Link>
      }
      tools={
        <>
          <TodayRateBadge locale={locale} labels={labels} />
          <LanguageSwitcher />
          <SessionNav />
        </>
      }
    />
  );
}
