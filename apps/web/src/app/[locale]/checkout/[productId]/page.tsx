import type { Metadata } from "next";
import { Suspense } from "react";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { alternateLinks } from "@/i18n/metadata";
import { CheckoutExperience } from "@/components/checkout-experience";

interface CheckoutPageProps {
  params: Promise<{ locale: string; productId: string }>;
}

export async function generateMetadata({ params }: CheckoutPageProps): Promise<Metadata> {
  const { locale: raw, productId } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "checkout" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternateLinks(locale, `/checkout/${productId}`),
  };
}

/** Checkout público de F1 (change f1-visual-identity). */
export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { locale: raw, productId } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);
  const t = await getTranslations("checkout");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-16 pt-24 lg:px-10">
      <Suspense
        fallback={
          <p role="status" aria-live="polite" className="text-base text-ink/70">
            {t("loading")}
          </p>
        }
      >
        <CheckoutExperience locale={locale} productId={productId} />
      </Suspense>
    </div>
  );
}
