import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "./language-switcher";
import { SessionNav } from "./session-nav";

/** Cabecera del shell de la web: marca, sesion e idioma. */
export async function SiteHeader() {
  const t = await getTranslations("nav");

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <div>
          <p className="text-lg font-bold text-brand-700">{t("appName")}</p>
          <p className="text-xs text-slate-500">{t("tagline")}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <SessionNav />
        </div>
      </div>
    </header>
  );
}
