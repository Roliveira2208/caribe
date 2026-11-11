import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "./language-switcher";
import { SessionNav } from "./session-nav";

/** Cabecera del shell del admin: marca, sesion e idioma. */
export async function SiteHeader() {
  const t = await getTranslations("nav");

  return (
    <header
      style={{
        borderBottom: "1px solid #e5e7eb",
        background: "#ffffff",
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
        <div>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1f2937" }}>
            {t("appName")}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{t("tagline")}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <LanguageSwitcher />
          <SessionNav />
        </div>
      </div>
    </header>
  );
}
