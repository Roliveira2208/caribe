import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

const LINK_CLASSES =
  "inline-flex min-h-11 items-center rounded-sm px-3 text-sm font-medium text-ink hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber";

/** Navegación del área de cliente: viajes y configuración de seguridad. */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const [tAccount, tNav] = await Promise.all([
    getTranslations("account"),
    getTranslations("nav"),
  ]);

  return (
    <div className="flex w-full flex-1 flex-col">
      <nav aria-label={tAccount("title")} className="border-b border-ink/10 bg-bone/70">
        <div className="mx-auto flex w-full max-w-5xl gap-2 px-5 pt-24 lg:px-10">
          <Link href="/account/trips" className={`${LINK_CLASSES} border-b-2 border-amber`} aria-current="page">
            {tAccount("tripsTitle")}
          </Link>
          <Link href="/two-factor" className={LINK_CLASSES}>
            {tNav("security")}
          </Link>
        </div>
      </nav>
      {children}
    </div>
  );
}
