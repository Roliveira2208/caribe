import type { Metadata } from "next";
import { Suspense } from "react";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { alternateLinks } from "@/i18n/metadata";
import { ProductDetailExperience } from "@/components/product-detail-experience";

interface HotelDetailPageProps {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({ params }: HotelDetailPageProps): Promise<Metadata> {
  const { locale: raw, id } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "detail" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternateLinks(locale, `/hoteles/${id}`),
  };
}

/** Detalle público de un tipo de habitación (change f1-visual-identity). */
export default async function HotelDetailPage({ params }: HotelDetailPageProps) {
  const { locale: raw, id } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);
  const t = await getTranslations("detail");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-16 pt-24 lg:px-10">
      <Suspense
        fallback={
          <p role="status" aria-live="polite" className="text-base text-ink/70">
            {t("loading")}
          </p>
        }
      >
        <ProductDetailExperience locale={locale} productId={id} />
      </Suspense>
    </div>
  );
}
