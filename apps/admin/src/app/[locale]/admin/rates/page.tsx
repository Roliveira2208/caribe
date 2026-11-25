import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";
import { PanelAccessNotice } from "@/components/panel-access-notice";
import { RatesPanel } from "@/components/rates-panel";
import { loadPanelAccess, loadRateRole } from "@/lib/panel-access";

interface RatesPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: RatesPageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "rates" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: alternateLinks(locale, "/admin/rates"),
  };
}

/** Panel de tasas del wireframe aprobado `panel-tasas.svg` (T-F2-8/T-F2-9). */
export default async function RatesPage({ params }: RatesPageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);

  const cookieStore = await cookies();
  const access = await loadPanelAccess({
    cookieHeader: cookieStore.toString(),
    origin: process.env["ADMIN_URL"] ?? "http://localhost:3001",
  });

  if (access.status !== "platform" && access.status !== "ready") {
    return <PanelAccessNotice access={access} />;
  }

  const platform = access.status === "platform";
  const role = platform ? "super_admin" : await loadRateRole({
    cookieHeader: cookieStore.toString(),
    origin: process.env["ADMIN_URL"] ?? "http://localhost:3001",
  });

  return (
    <div style={{ width: "100%" }}>
      <RatesPanel
        locale={locale}
        mode={platform ? "platform" : "agency"}
        role={role}
        agencyName={platform ? undefined : access.organization.name}
      />
    </div>
  );
}
