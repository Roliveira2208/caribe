import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** 404 localizado (rutas dentro de /es o /en que no existen). */
export default async function NotFoundPage() {
  const t = await getTranslations("notFound");

  return (
    <div className="space-y-4 text-center">
      <h1 className="text-3xl font-bold">{t("title")}</h1>
      <p className="text-slate-600">{t("description")}</p>
      <Link className="text-brand-700 underline" href="/">
        {t("back")}
      </Link>
    </div>
  );
}
