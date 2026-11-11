"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { getSession, signOut, type SessionData } from "@caribe/shared";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

/** Acciones de sesion en la cabecera: entrar, seguridad (TOTP) o salir. */
export function SessionNav() {
  const t = useTranslations("nav");
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    getSession()
      .then((result) => {
        if (active) setSession(result);
      })
      .catch(() => {
        /* sin sesion: se muestra el acceso */
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!ready) {
    return null;
  }

  if (!session) {
    return (
      <Button asChild size="sm">
        <Link href="/login">{t("login")}</Link>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button asChild size="sm" variant="secondary">
        <Link href="/two-factor">{t("security")}</Link>
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          void signOut().finally(() => {
            setSession(null);
            router.refresh();
          });
        }}
      >
        {t("logout")}
      </Button>
    </div>
  );
}
