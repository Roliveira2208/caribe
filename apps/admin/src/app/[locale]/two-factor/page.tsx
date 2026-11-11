import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, safeLocalizedRedirectPath, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";
import { TwoFactorForm } from "@/components/two-factor-form";

interface TwoFactorPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: TwoFactorPageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "twoFactor" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternateLinks(locale, "/two-factor"),
  };
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Pantalla del segundo factor: verificacion (login pendiente) o activacion
 * de TOTP con QR y clave manual (spec auth-access, escenario "Admin sin TOTP").
 */
export default async function TwoFactorPage({ params, searchParams }: TwoFactorPageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);

  const { redirectTo } = await searchParams;
  const target = safeLocalizedRedirectPath(firstParam(redirectTo), locale) ?? `/${locale}`;

  return <TwoFactorForm redirectTo={target} />;
}
