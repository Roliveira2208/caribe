import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { PanelAccess } from "@/lib/panel-access";
import { OrganizationSelector } from "./organization-selector";

/**
 * Estados de acceso que impiden mostrar una pantalla del panel (T-F1-9b).
 * Las rutas que requieren agencia activa comparten este fallo de acceso para
 * que entrar directo a /admin/payments resuelva las membresías igual que el panel.
 */
export async function PanelAccessNotice({ access }: { access: PanelAccess }) {
  const tOrg = await getTranslations("organization");

  if (access.status === "choose") {
    return <OrganizationSelector organizations={access.organizations} />;
  }

  if (access.status === "login") {
    return (
      <section style={{ maxWidth: 520 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>{tOrg("loginTitle")}</h1>
        <p style={{ color: "var(--caribe-ink)" }}>{tOrg("loginDescription")}</p>
        <Link href="/login">{tOrg("loginAction")}</Link>
      </section>
    );
  }

  if (access.status === "no-membership") {
    return (
      <section style={{ maxWidth: 520, border: "1px solid #d1d5db", borderRadius: 8, padding: 24 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>{tOrg("noMembershipTitle")}</h1>
        <p style={{ color: "var(--caribe-ink)" }}>{tOrg("noMembershipDescription")}</p>
        <Link href="/">{tOrg("webLink")}</Link>
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

  return null;
}
