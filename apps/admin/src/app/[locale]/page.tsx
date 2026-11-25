import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";
import { AuditLogPanel } from "@/components/audit-log-panel";
import { PanelAccessNotice } from "@/components/panel-access-notice";
import { loadPanelAccess } from "@/lib/panel-access";

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
 * Panel del admin: auditoría de la agencia mientras llegan catálogo y reservas
 * (F1). Antes de mostrarlo, el servidor resuelve la organización activa según
 * las membresías de la sesión (spec auth-access "Organización activa en el panel").
 */
export default async function PanelPage({ params }: PanelPageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);
  const t = await getTranslations("panel");
  const tOrg = await getTranslations("organization");

  const cookieStore = await cookies();
  const access = await loadPanelAccess({
    cookieHeader: cookieStore.toString(),
    origin: process.env["ADMIN_URL"] ?? "http://localhost:3001",
  });

  if (access.status !== "platform" && access.status !== "ready") {
    return <PanelAccessNotice access={access} />;
  }

  const isPlatform = access.status === "platform";

  return (
    <div style={{ width: "100%" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 700, color: "var(--caribe-ink)" }}>
        {isPlatform ? tOrg("platformTitle") : t("title")}
      </h1>
      <p style={{ margin: "0 0 16px", color: "var(--caribe-ink)" }}>
        {isPlatform
          ? tOrg("platformDescription")
          : tOrg("activeAgency", { agency: access.organization.name })}
      </p>
      <AuditLogPanel locale={locale} redirectTo={`/${locale}`} />
    </div>
  );
}
