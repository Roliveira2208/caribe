"use client";

import { useLocale, useTranslations } from "next-intl";
import { Select } from "antd";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@caribe/shared";

/** Selector de idioma es/en que conserva la ruta actual. */
export function LanguageSwitcher() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Select
      aria-label={t("language")}
      size="small"
      value={locale}
      style={{ width: 130 }}
      onChange={(value) => router.replace(pathname, { locale: value as Locale })}
      options={[
        { value: "es", label: t("spanish") },
        { value: "en", label: t("english") },
      ]}
    />
  );
}
