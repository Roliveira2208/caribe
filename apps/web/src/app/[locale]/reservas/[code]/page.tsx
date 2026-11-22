import type { Metadata } from "next";
import type { Locale } from "@caribe/shared";
import { DEFAULT_LOCALE, isLocale } from "@caribe/shared";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { alternateLinks } from "@/i18n/metadata";
import { localizedPath } from "@/lib/localized-path";

interface ReservationPageProps {
  params: Promise<{ locale: string; code: string }>;
}

export async function generateMetadata({ params }: ReservationPageProps): Promise<Metadata> {
  const { locale: raw, code } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "reservation" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternateLinks(locale, `/reservas/${encodeURIComponent(code)}`),
  };
}

/**
 * Destino público del QR del voucher. Muestra solo el código: la reserva se
 * consulta en «Mis viajes» con sesión (spec web-ui, "Página sin datos de la
 * reserva").
 */
export default async function ReservationPage({ params }: ReservationPageProps) {
  const { locale: raw, code } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);
  const t = await getTranslations("reservation");
  const tripsPath = localizedPath(locale, "/account/trips");
  const loginHref = `${localizedPath(locale, "/login")}?redirectTo=${encodeURIComponent(tripsPath)}`;

  return (
    <section className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 pb-16 pt-32 lg:px-10">
      <div className="space-y-3">
        <h1 className="font-display text-h1 text-ink">{t("title")}</h1>
        <p className="text-body-lg text-ink/70">{t("subtitle")}</p>
      </div>
      <div className="rounded-lg border border-ink/10 bg-bone p-6 shadow-brand">
        <p className="text-sm text-ink/70">{t("codeLabel")}</p>
        <p data-reservation-code className="break-all font-display text-h3 text-ink">
          {code}
        </p>
      </div>
      <p className="text-base text-ink/80">{t("note")}</p>
      <a
        href={loginHref}
        className="inline-flex min-h-12 items-center justify-center rounded-md bg-amber px-6 font-semibold text-ink hover:bg-amber/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
      >
        {t("signIn")}
      </a>
      <p className="text-sm text-ink/70">{t("privacyNote")}</p>
    </section>
  );
}
