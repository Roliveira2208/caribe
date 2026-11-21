import { DEFAULT_LOCALE, isLocale } from "@caribe/shared";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadTodayRateLabels } from "@/lib/today-rate-labels";
import { HeaderFrame } from "./header-frame";
import { LanguageSwitcher } from "./language-switcher";
import { SessionNav } from "./session-nav";
import { TodayRateBadge } from "./today-rate-badge";

const PRODUCT_LINKS = [
  { key: "hotels", type: "hotel" },
  { key: "tours", type: "tour" },
  { key: "packages", type: "package" },
  { key: "flights", type: "flight" },
] as const;

/** Cabecera flotante: productos, tasa, idioma,sesión y wordmark. */
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
      productsLabel={t("products")}
      brand={
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
        >
          <span className="size-2 rounded-full bg-amber" aria-hidden="true" />
          <span className="font-display text-2xl font-semibold tracking-tight text-bone">
            {t("appName")}
          </span>
        </Link>
      }
      products={
        <>
          {PRODUCT_LINKS.map(({ key, type }) => (
            <Link
              key={type}
              href={{ pathname: "/search", query: { type } }}
              className="inline-flex min-h-9 items-center rounded-full px-3 text-sm text-bone transition-colors duration-300 hover:bg-bone/10 hover:text-bone"
            >
              {t(key)}
            </Link>
          ))}
        </>
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
