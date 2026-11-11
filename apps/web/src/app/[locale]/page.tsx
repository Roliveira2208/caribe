import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";

interface HomePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: HomePageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "home" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: alternateLinks(locale, ""),
  };
}

/** Portada del shell: resumen de la OTA mientras llega el buscador (F1). */
export default async function HomePage({ params }: HomePageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  const features = [
    { title: t("featureCatalogTitle"), description: t("featureCatalogDescription") },
    { title: t("featureRatesTitle"), description: t("featureRatesDescription") },
    { title: t("featureOfflineTitle"), description: t("featureOfflineDescription") },
  ];

  return (
    <div className="w-full max-w-5xl space-y-10">
      <section className="space-y-3 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-brand-800">{t("title")}</h1>
        <p className="text-lg text-slate-600">{t("subtitle")}</p>
        <p className="text-sm text-slate-400">{t("notReady")}</p>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {features.map((feature) => (
          <div key={feature.title} className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-brand-700">{feature.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{feature.description}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
