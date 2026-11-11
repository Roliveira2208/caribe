import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";
import { AuditLogPanel } from "@/components/audit-log-panel";

interface PanelPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PanelPageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "panel" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: alternateLinks(locale, ""),
  };
}

/**
 * Panel del admin: auditoria de la agencia mientras llegan catalogo y reservas
 * (F1). La tabla exige sesion y segundo factor (specs audit "Consulta" y
 * auth-access "Admin sin TOTP"); sin TOTP activo redirige a la activacion.
 */
export default async function PanelPage({ params }: PanelPageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);
  const t = await getTranslations("panel");

  return (
    <div style={{ width: "100%" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 700, color: "#1f2937" }}>
        {t("title")}
      </h1>
      <p style={{ margin: "0 0 16px", color: "#6b7280" }}>{t("description")}</p>
      <AuditLogPanel locale={locale} redirectTo={`/${locale}`} />
    </div>
  );
}
