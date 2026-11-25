import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";
import { SessionNav } from "./session-nav";

/** Cabecera del shell del admin: marca, navegacion, idioma y sesion. */
export async function SiteHeader() {
  const t = await getTranslations("nav");

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
          <Link href="/admin/payments" style={{ fontSize: 14, color: "var(--caribe-ink)" }}>
            {t("payments")}
          </Link>
          <Link href="/admin/rates" style={{ fontSize: 14, color: "var(--caribe-ink)" }}>
            {t("rates")}
          </Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <LanguageSwitcher />
          <SessionNav />
        </div>
      </div>
    </header>
  );
}
