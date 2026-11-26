import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";
import { PanelAccessNotice } from "@/components/panel-access-notice";
import { ReportsPanel } from "@/components/reports-panel";
import { loadActiveMemberRole, loadPanelAccess } from "@/lib/panel-access";

interface ReportsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: ReportsPageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "reports" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: alternateLinks(locale, "/admin/reports"),
  };
}

/** Reporte de ventas del wireframe aprobado `panel-reportes.svg` (T-F2-23). */
export default async function ReportsPage({ params }: ReportsPageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);

  const cookieStore = await cookies();
  const options = {
    cookieHeader: cookieStore.toString(),
    origin: process.env["ADMIN_URL"] ?? "http://localhost:3001",
  };
  const access = await loadPanelAccess(options);
  if (access.status !== "platform" && access.status !== "ready") {
    return <PanelAccessNotice access={access} />;
  }

  const platform = access.status === "platform";
  const role = platform ? "super_admin" : await loadActiveMemberRole(options);

  return (
    <div style={{ width: "100%" }}>
      <ReportsPanel
        locale={locale}
        mode={platform ? "platform" : "agency"}
        role={role}
        agencyName={platform ? undefined : access.organization.name}
      />
    </div>
  );
}
