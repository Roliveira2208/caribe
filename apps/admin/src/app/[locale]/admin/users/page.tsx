import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";
import { UsersPanel } from "@/components/users-panel";
import { PanelAccessNotice } from "@/components/panel-access-notice";
import { loadActiveMemberRole, loadPanelAccess } from "@/lib/panel-access";
import { resolveUsersPanelAccess } from "@/lib/users-client";

interface UsersPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: UsersPageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "users" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: alternateLinks(locale, "/admin/users"),
  };
}

/** Usuarios y roles del wireframe aprobado `panel-usuarios-roles.svg` (T-F2-21). */
export default async function UsersPage({ params }: UsersPageProps) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "users" });
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
  const users = resolveUsersPanelAccess(
    access.status === "platform" ? "platform" : "agency",
    role,
  );

  if (!users.visible) {
    return (
      <section role="alert" style={{ maxWidth: 520 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>{t("title")}</h1>
        <p style={{ color: "var(--caribe-ink)" }}>{t("accessDenied")}</p>
      </section>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <UsersPanel
        locale={locale}
        access={users}
        agencyName={access.status === "ready" ? access.organization.name : undefined}
      />
    </div>
  );
}
