import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { alternateLinks, siteUrl } from "@/i18n/metadata";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import "../globals.css";

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: Pick<LocaleLayoutProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  const active = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: active, namespace: "metadata" });
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: t("title"), template: t("titleTemplate") },
    description: t("description"),
    alternates: alternateLinks(active, ""),
  };
}

/**
 * Shell del admin con rutas /es y /en (next-intl, espanol por defecto). AntdRegistry
 * extrae los estilos cssinjs de antd en SSR y Providers fija su paquete de idioma.
 */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body>
        <AntdRegistry>
          <Providers locale={locale}>
            <NextIntlClientProvider locale={locale} messages={messages}>
              <SiteHeader />
              <main
                style={{ width: "100%", maxWidth: 1080, margin: "0 auto", padding: "24px 16px" }}
              >
                {children}
              </main>
            </NextIntlClientProvider>
          </Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
