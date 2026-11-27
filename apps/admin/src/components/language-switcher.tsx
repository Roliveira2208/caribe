"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, Select } from "antd";
import { updateUserLocale, type Locale } from "@caribe/shared";
import { usePathname, useRouter } from "@/i18n/navigation";

/** Selector de idioma es/en que guarda el perfil y conserva la ruta actual. */
export function LanguageSwitcher() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(next: Locale): Promise<void> {
    if (next === locale || busy) return;
    setBusy(true);
    setError(null);
    try {
      // El perfil se escribe ANTES de navegar: si falla, no se anuncia un cambio
      // que no sobreviviría a un nuevo inicio de sesión.
      await updateUserLocale(next);
      router.replace(pathname, { locale: next });
    } catch {
      setError(t("localeError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Select
        aria-label={t("language")}
        size="small"
        value={locale}
        disabled={busy}
        style={{ width: 130 }}
        onChange={(value) => void change(value as Locale)}
        options={[
          { value: "es", label: t("spanish") },
          { value: "en", label: t("english") },
        ]}
      />
      {error ? (
        <Alert type="error" showIcon title={error} style={{ maxWidth: 260 }} />
      ) : null}
    </div>
  );
}
