"use client";

import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { usePathname } from "@/i18n/navigation";
import { languageSwitchHref, type LanguageRouteParams } from "@/lib/language-view";
import { LanguagePill } from "./language-pill";

/**
 * Selector de idioma en píldora. Conserva la ruta fija y sus parámetros; el
 * cambio navega con el router estándar para no duplicar el prefijo que ya
 * devuelve `languageSwitchHref`.
 */
export function LanguageSwitcher() {
  const t = useTranslations("nav");
  const requestedLocale = useLocale();
  const locale: Locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;
  const pathname = usePathname();
  const params = useParams<LanguageRouteParams>();
  const router = useRouter();

  function choose(next: Locale): void {
    if (next !== locale) router.replace(languageSwitchHref(next, pathname, params));
  }

  return (
    <LanguagePill
      locale={locale}
      labels={{ es: t("shortEs"), en: t("shortEn") }}
      ariaLabel={t("language")}
      onSelect={choose}
    />
  );
}
