"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, Button, Select } from "antd";
import type { AgencyOption } from "@/lib/panel-access";

interface HeaderOrganizationSelectorProps {
  organizations: AgencyOption[];
}

/**
 * Selector compacto de la cabecera cuando la sesión tiene más de una membresía
 * (spec `admin-ui`). Tras activar se recarga la página: así se descarta cualquier
 * dato en memoria de la agencia anterior.
 */
export function HeaderOrganizationSelector({ organizations }: HeaderOrganizationSelectorProps) {
  const t = useTranslations("organization");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(): Promise<void> {
    if (!organizationId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/organization/set-active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("set-active");
      window.location.reload();
    } catch {
      setError(t("selectError"));
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <label htmlFor="header-organization">{t("label")}</label>
      <Select
        id="header-organization"
        aria-label={t("label")}
        size="small"
        placeholder={t("placeholder")}
        style={{ width: 180 }}
        value={organizationId}
        onChange={setOrganizationId}
        options={organizations.map((organization) => ({
          value: organization.id,
          label: organization.name,
        }))}
      />
      <Button size="small" type="primary" disabled={!organizationId || busy} onClick={() => void choose()}>
        {busy ? t("submitting") : t("submit")}
      </Button>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </div>
  );
}
