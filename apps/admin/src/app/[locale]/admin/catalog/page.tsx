import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";
import { CatalogPanel } from "@/components/catalog-panel";
import { PanelAccessNotice } from "@/components/panel-access-notice";
import { loadActiveMemberRole, loadPanelAccess } from "@/lib/panel-access";
import { resolveCatalogPanelAccess } from "@/lib/catalog-client";

interface CatalogPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: CatalogPageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "catalog" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: alternateLinks(locale, "/admin/catalog"),
  };
}

/** Catálogo del panel del wireframe aprobado `panel-catalogo.svg` (T-F2-18). */
export default async function CatalogPage({ params }: CatalogPageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "catalog" });
  const cookieStore = await cookies();
  const request = {
    cookieHeader: cookieStore.toString(),
    origin: process.env["ADMIN_URL"] ?? "http://localhost:3001",
  };
  const access = await loadPanelAccess(request);

  if (access.status !== "platform" && access.status !== "ready") {
    return <PanelAccessNotice access={access} />;
  }

  const role = access.status === "platform" ? null : await loadActiveMemberRole(request);
  const catalog = resolveCatalogPanelAccess({
    mode: access.status === "platform" ? "platform" : "agency",
    role,
  });

  if (!catalog.canRead) {
    return (
      <section role="alert" style={{ maxWidth: 520 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>{t("title")}</h1>
        <p style={{ color: "var(--caribe-ink)" }}>{t("forbidden")}</p>
      </section>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <CatalogPanel
        locale={locale}
        access={catalog}
        agencyName={access.status === "ready" ? access.organization.name : undefined}
      />
    </div>
  );
}
