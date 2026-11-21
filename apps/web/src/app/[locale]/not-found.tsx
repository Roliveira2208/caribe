import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** 404 localizado (rutas dentro de /es o /en que no existen). */
export default async function NotFoundPage() {
  const t = await getTranslations("notFound");

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center space-y-4 px-5 pb-12 pt-24 text-center">
      <h1 className="font-display text-h2 text-ink">{t("title")}</h1>
      <p className="text-ink/70">{t("description")}</p>
      <Link className="text-teal-ink underline underline-offset-4" href="/">
        {t("back")}
      </Link>
    </div>
  );
}
