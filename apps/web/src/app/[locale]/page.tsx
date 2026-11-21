import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { Link } from "@/i18n/navigation";
import { alternateLinks } from "@/i18n/metadata";
import { HomeSearchPanel } from "@/components/home-search-panel";
import { KineticComposition } from "@/components/kinetic-composition";
import { SearchReveal } from "@/components/search-reveal";

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

/** Portada de Caribe: heroe asimetrico y buscador revelado una sola vez. */
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
    <div className="w-full">
      <section className="min-h-dvh overflow-hidden bg-ink pt-20 text-bone">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 pb-16 lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-10 lg:pb-24 lg:pt-28">
          <div className="order-1 max-w-2xl space-y-6 lg:col-start-1 lg:row-start-1">
            <h1 className="max-w-3xl font-display text-display text-bone">{t("title")}</h1>
            <p className="max-w-xl text-body-lg text-bone/80">{t("subtitle")}</p>
          </div>
          <div className="order-2 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <KineticComposition />
          </div>
          <div className="order-3 lg:col-start-1 lg:row-start-2">
            <Link
              href={`/${locale}/buscar`}
              className="inline-flex h-12 items-center rounded-md bg-amber px-6 font-semibold text-ink hover:bg-amber/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
            >
              {t("cta")}
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-bone py-16">
        <noscript>
          <style>{`.search-reveal[data-reveal="pending"]{opacity:1;clip-path:none;transform:none}.search-reveal .reveal-field{opacity:1;transform:none}`}</style>
        </noscript>
        <SearchReveal>
          <div className="mx-auto max-w-6xl space-y-6 px-5 lg:px-10">
            <h2 className="font-display text-h2 text-ink">{t("searchTitle")}</h2>
            <HomeSearchPanel locale={locale} />
          </div>
        </SearchReveal>
      </section>

      <section className="border-t border-ink/10 bg-bone py-14">
        <div className="mx-auto max-w-6xl px-5 lg:px-10">
          <ul className="grid gap-6 sm:grid-cols-3">
            {features.map((feature) => (
              <li key={feature.title} className="space-y-2 border-t-4 border-teal pt-4">
                <h3 className="font-display text-h4 text-ink">{feature.title}</h3>
                <p className="text-sm text-ink/70">{feature.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
