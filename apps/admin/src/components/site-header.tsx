import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadAuditActor, loadOrganizationChoice } from "@/lib/panel-access";
import {
  PANEL_MODULES,
  resolvePanelModules,
  type PanelModule,
} from "@/lib/panel-navigation";
import { HeaderOrganizationSelector } from "./header-organization-selector";
import { LanguageSwitcher } from "./language-switcher";
import { PaymentModeNotice } from "./payment-mode-notice";
import { SessionNav } from "./session-nav";

/** Cabecera del shell del admin: marca, navegacion, idioma y sesion. */
export async function SiteHeader() {
  const t = await getTranslations("nav");
  const cookieStore = await cookies();
  const request = {
    cookieHeader: cookieStore.toString(),
    origin: process.env["ADMIN_URL"] ?? "http://localhost:3001",
  };
  const actor = await loadAuditActor(request);
  const choice = await loadOrganizationChoice(request);
  const modules = resolvePanelModules(actor.status, actor.role);
  const navLink = (module: PanelModule) =>
    modules.includes(module) ? (
      <Link
        key={module}
        href={`/admin/${module}`}
        style={{ fontSize: 14, color: "var(--caribe-ink)" }}
      >
        {t(module)}
      </Link>
    ) : null;

  return (
    <header
      style={{
        borderBottom: "1px solid var(--caribe-teal)",
        background: "var(--caribe-bone)",
      }}
    >
      <div
        style={{
          maxWidth: "1080px",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "12px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Link href="/" style={{ textDecoration: "none" }}>
            <p
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: "var(--caribe-ink)",
                fontFamily: "var(--font-clash-display), sans-serif",
              }}
            >
              {t("appName")}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "var(--caribe-ink)" }}>
              {t("tagline")}
            </p>
          </Link>
          {PANEL_MODULES.map(navLink)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <LanguageSwitcher />
          <SessionNav />
        </div>
      </div>
      {choice.status === "choose" ? (
        <div style={{ maxWidth: "1080px", margin: "0 auto", padding: "0 16px 12px" }}>
          <HeaderOrganizationSelector organizations={choice.organizations} />
        </div>
      ) : null}
      {choice.status === "fixed" ? (
        <div style={{ maxWidth: "1080px", margin: "0 auto", padding: "0 16px 12px" }}>
          <PaymentModeNotice visible />
        </div>
      ) : null}
    </header>
  );
}
