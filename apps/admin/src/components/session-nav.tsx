"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRouter as useAppRouter } from "@/i18n/navigation";
import { Button, Space } from "antd";
import { getSession, signOut, type SessionData } from "@caribe/shared";

/** Acciones de sesion en la cabecera: entrar, seguridad (TOTP) o salir. */
export function SessionNav() {
  const t = useTranslations("nav");
  const router = useRouter();
  const appRouter = useAppRouter();
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
      <Button type="primary" size="small" onClick={() => appRouter.push("/login")}>
        {t("login")}
      </Button>
    );
  }

  return (
    <Space size="small">
      <Button size="small" onClick={() => appRouter.push("/two-factor")}>
        {t("security")}
      </Button>
      <Button
        size="small"
        onClick={() => {
          void signOut().finally(() => {
            setSession(null);
            router.refresh();
          });
        }}
      >
        {t("logout")}
      </Button>
    </Space>
  );
}
