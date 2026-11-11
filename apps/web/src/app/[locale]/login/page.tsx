import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, safeLocalizedRedirectPath, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";
import { LoginForm } from "@/components/login-form";

interface LoginPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: LoginPageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "login" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternateLinks(locale, "/login"),
  };
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Login del shell: redirige al destino pedido (validado) o a la portada. */
export default async function LoginPage({ params, searchParams }: LoginPageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);

  const { redirectTo } = await searchParams;
  const target = safeLocalizedRedirectPath(firstParam(redirectTo), locale) ?? `/${locale}`;

  return <LoginForm locale={locale} redirectTo={target} />;
}
