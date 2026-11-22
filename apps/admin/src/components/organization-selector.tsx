"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Select } from "antd";
import type { AgencyOption } from "@/lib/panel-access";

interface OrganizationSelectorProps {
  organizations: AgencyOption[];
}

/** Selector de agencia cuando la sesión tiene más de una membresía (T-F1-9b). */
export function OrganizationSelector({ organizations }: OrganizationSelectorProps) {
  const t = useTranslations("organization");
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose() {
    if (!organizationId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/organization/set-active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!response.ok) {
        setError(t("selectError"));
        return;
      }
      router.refresh();
    } catch {
      setError(t("selectError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("title")} style={{ width: "100%", maxWidth: 520 }}>
      <p style={{ marginTop: 0, color: "#6b7280" }}>{t("description")}</p>
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <label htmlFor="organization-select" style={{ display: "block", marginBottom: 8 }}>
        {t("label")}
      </label>
      <Select<string>
        id="organization-select"
        style={{ width: "100%" }}
        placeholder={t("placeholder")}
        value={organizationId}
        onChange={setOrganizationId}
        options={organizations.map((organization) => ({
          value: organization.id,
          label: organization.name,
        }))}
      />
      <Button
        type="primary"
        block
        style={{ marginTop: 16 }}
        disabled={!organizationId}
        loading={busy}
        onClick={() => void choose()}
      >
        {busy ? t("submitting") : t("submit")}
      </Button>
    </Card>
  );
}
