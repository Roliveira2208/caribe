import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";
import { PanelAccessNotice } from "@/components/panel-access-notice";
import { PaymentsPanel } from "@/components/payments-panel";
import { loadActiveMemberRole, loadPanelAccess, loadSessionUser } from "@/lib/panel-access";
import { resolvePaymentPanelAccess } from "@/lib/payments-client";

interface PaymentsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PaymentsPageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "payments" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: alternateLinks(locale, "/admin/payments"),
  };
}

/** Revisión de pagos del panel (T-F1-9c; matriz y cursor en T-F2-11). */
export default async function PaymentsPage({ params }: PaymentsPageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "payments" });
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
  const userId = await loadSessionUser(request);
  const payments = resolvePaymentPanelAccess(
    access.status === "platform" ? "platform" : "ready",
    role,
  );

  if (!payments.canRead) {
    return (
      <section role="alert" style={{ maxWidth: 520 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>{t("title")}</h1>
        <p style={{ color: "var(--caribe-ink)" }}>{t("listForbidden")}</p>
      </section>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <PaymentsPanel locale={locale} access={payments} userId={userId} />
    </div>
  );
}
