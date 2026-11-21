"use client";

import { Suspense } from "react";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { SearchExperience } from "@/components/search-experience";

/**
 * Página de búsqueda. El hook `useSearchParams` vive dentro de `SearchExperience`
 * y se aísla con `Suspense` para que la ruta pueda prerenderizarse en producción.
 */
export default function SearchPage() {
  const t = useTranslations("search");
  const params = useParams<{ locale: string | string[] }>();
  const raw = Array.isArray(params?.locale) ? params.locale[0] : params?.locale;
  const candidate = raw ?? DEFAULT_LOCALE;
  const locale: Locale = isLocale(candidate) ? candidate : DEFAULT_LOCALE;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-12 pt-24 lg:px-10">
      <Suspense
        fallback={
          <p role="status" aria-live="polite" className="text-sm text-ink">
            {t("loading")}
          </p>
        }
      >
        <SearchExperience locale={locale} />
      </Suspense>
    </div>
  );
}
