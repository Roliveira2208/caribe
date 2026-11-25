import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";
import { AuditLogPanel } from "@/components/audit-log-panel";
import { PanelAccessNotice } from "@/components/panel-access-notice";
import { resolveAuditAccess } from "@/lib/audit-client";
import { loadActiveMemberRole, loadPanelAccess } from "@/lib/panel-access";

interface AuditPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: AuditPageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "audit" });
  return {
    title: t("tabAudit"),
    description: t("description"),
    alternates: alternateLinks(locale, "/admin/audit"),
  };
}

/**
 * Visor de auditoría (T-F2-15). La matriz se resuelve en el servidor con la
 * misma sesión y membresía activa que el resto del panel: agentes y `member`
 * no reciben el visor ni sus enlaces.
 */
export default async function AuditPage({ params }: AuditPageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "audit" });
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
  const audit = resolveAuditAccess(access.status === "platform" ? "platform" : "ready", role);

  if (!audit.canRead) {
    return (
      <section role="alert" style={{ maxWidth: 520 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>{t("tabAudit")}</h1>
        <p style={{ color: "var(--caribe-ink)" }}>{t("forbidden")}</p>
      </section>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <AuditLogPanel locale={locale} redirectTo={`/${locale}/admin/audit`} />
    </div>
  );
}
