import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@caribe/shared";
import { alternateLinks } from "@/i18n/metadata";
import { Link } from "@/i18n/navigation";
import { AuditLogPanel } from "@/components/audit-log-panel";
import { OrganizationSelector } from "@/components/organization-selector";
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

  if (access.status === "login") {
    return (
      <section style={{ maxWidth: 520 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>{tOrg("loginTitle")}</h1>
        <p style={{ color: "#6b7280" }}>{tOrg("loginDescription")}</p>
        <Link href="/login">{tOrg("loginAction")}</Link>
      </section>
    );
  }

  if (access.status === "error") {
    return (
      <p role="alert" style={{ color: "#b42318" }}>
        {tOrg("loadError")}
      </p>
    );
  }

  if (access.status === "choose") {
    return <OrganizationSelector organizations={access.organizations} />;
  }

  if (access.status === "no-membership") {
    return (
      <section style={{ maxWidth: 520, border: "1px solid #d1d5db", borderRadius: 8, padding: 24 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>{tOrg("noMembershipTitle")}</h1>
        <p style={{ color: "#6b7280" }}>{tOrg("noMembershipDescription")}</p>
        <Link href="/">{tOrg("webLink")}</Link>
      </section>
    );
  }

  const isPlatform = access.status === "platform";

  return (
    <div style={{ width: "100%" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 700, color: "#1f2937" }}>
        {isPlatform ? tOrg("platformTitle") : t("title")}
      </h1>
      <p style={{ margin: "0 0 16px", color: "#6b7280" }}>
        {isPlatform
          ? tOrg("platformDescription")
          : tOrg("activeAgency", { agency: access.organization.name })}
      </p>
      <AuditLogPanel locale={locale} redirectTo={`/${locale}`} />
    </div>
  );
}
