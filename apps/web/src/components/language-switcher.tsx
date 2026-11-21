"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@caribe/shared";

/** Selector de idioma es/en que conserva la ruta actual. */
export function LanguageSwitcher() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <select
      aria-label={t("language")}
      className="h-9 rounded border border-bone/30 bg-transparent px-2 text-sm text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
      value={locale}
      onChange={(event) => router.replace(pathname, { locale: event.target.value as Locale })}
    >
      <option value="es">{t("spanish")}</option>
      <option value="en">{t("english")}</option>
    </select>
  );
}
