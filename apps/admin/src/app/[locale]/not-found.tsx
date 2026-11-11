import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** 404 localizado (rutas dentro de /es o /en que no existen). */
export default async function NotFoundPage() {
  const t = await getTranslations("notFound");

  return (
    <div style={{ textAlign: "center" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>{t("title")}</h1>
      <p style={{ color: "#6b7280" }}>{t("description")}</p>
      <Link href="/" style={{ color: "#0d7d6c", textDecoration: "underline" }}>
        {t("back")}
      </Link>
    </div>
  );
}
