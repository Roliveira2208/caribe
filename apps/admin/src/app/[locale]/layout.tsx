import type { Metadata } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { alternateLinks, siteUrl } from "@/i18n/metadata";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import "../globals.css";

// Las fuentes se sirven desde el paquete compartido @caribe/fonts; la ruta es
// relativa al archivo que llama a localFont (guía de Next 16).
const clashDisplay = localFont({
  src: [
    { path: "../../../../../packages/fonts/fonts/clash-display-500.woff2", weight: "500" },
    { path: "../../../../../packages/fonts/fonts/clash-display-600.woff2", weight: "600" },
    { path: "../../../../../packages/fonts/fonts/clash-display-700.woff2", weight: "700" },
  ],
  variable: "--font-clash-display",
  display: "swap",
  fallback: ["sans-serif"],
});

const generalSans = localFont({
  src: [
    { path: "../../../../../packages/fonts/fonts/general-sans-400.woff2", weight: "400" },
    { path: "../../../../../packages/fonts/fonts/general-sans-500.woff2", weight: "500" },
    { path: "../../../../../packages/fonts/fonts/general-sans-600.woff2", weight: "600" },
    { path: "../../../../../packages/fonts/fonts/general-sans-700.woff2", weight: "700" },
  ],
  variable: "--font-general-sans",
  display: "swap",
  fallback: ["sans-serif"],
});

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
 * `connection()` fuerza renderizado por petición: con CSP por nonces una página
 * prerenderizada no tendría el nonce de la respuesta actual (guía de Next 16).
 */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const messages = await getMessages();
  return (
    <html lang={locale} className={`${clashDisplay.variable} ${generalSans.variable}`}>
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
