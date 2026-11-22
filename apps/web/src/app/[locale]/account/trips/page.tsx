import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";
import { TripsExperience } from "@/components/trips-experience";

interface TripsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: TripsPageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "account" });
  return {
    title: t("tripsTitle"),
    alternates: alternateLinks(locale, "/account/trips"),
  };
}

/** Área de cuenta del cliente: reservas propias con estados accesibles. */
export default async function TripsPage({ params }: TripsPageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);

  return (
    <section className="mx-auto w-full max-w-5xl flex-1 px-5 pb-16 pt-8 lg:px-10">
      <TripsExperience locale={locale} />
    </section>
  );
}
