import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";

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

/**
 * Área de cuenta del cliente. La vista de reservas se completa en T-NAV-9;
 * esta entrega deja la ruta pública fija y accesible en ambos idiomas.
 */
export default async function TripsPage({ params }: TripsPageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);
  const t = await getTranslations("account");

  return (
    <section className="mx-auto w-full max-w-5xl flex-1 px-5 pb-16 pt-8 lg:px-10">
      <h1 className="font-display text-h2 text-ink">{t("tripsTitle")}</h1>
      <p className="mt-4 text-body-lg text-ink/80">{t("tripsPlaceholder")}</p>
    </section>
  );
}
