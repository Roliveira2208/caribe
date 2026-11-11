"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Alert, Card, Table, type TableColumnsType } from "antd";
import { AuthApiError, fetchJson, isTwoFactorRequired, type Locale } from "@caribe/shared";

interface AuditLogPanelProps {
  locale: Locale;
  /** Destino validado por la pagina: path interno localizado. */
  redirectTo: string;
}

interface AuditLogRow {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  at: string;
}

type PanelState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; rows: AuditLogRow[] };

/**
 * Tabla de auditoria (GET /api/v1/admin/audit-logs, spec audit "Consulta"):
 * sin sesion lleva al login, un 403 TWO_FACTOR_REQUIRED lleva a la pantalla de
 * activacion de TOTP (spec auth-access) y cualquier otro 403 se explica como
 * falta de permiso. Las fechas se formatean con Intl en el idioma activo.
 */
export function AuditLogPanel({ locale, redirectTo }: AuditLogPanelProps) {
  const t = useTranslations("panel");
  const router = useRouter();
  const [state, setState] = useState<PanelState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    fetchJson("/api/v1/admin/audit-logs")
      .then((body) => {
        if (!active) return;
        const items = (body as { items?: AuditLogRow[] }).items ?? [];
        setState({ status: "ready", rows: items });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof AuthApiError) {
          if (cause.status === 401) {
            router.replace(`/${locale}/login?redirectTo=${encodeURIComponent(redirectTo)}`);
            return;
          }
          if (isTwoFactorRequired(cause)) {
            router.replace(`/${locale}/two-factor?redirectTo=${encodeURIComponent(redirectTo)}`);
            return;
          }
          if (cause.status === 403) {
            setState({ status: "forbidden" });
            return;
          }
        }
        setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [locale, redirectTo, router]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  const columns: TableColumnsType<AuditLogRow> = [
    { title: t("colAction"), dataIndex: "action", key: "action" },
    { title: t("colEntity"), dataIndex: "entity", key: "entity" },
    { title: t("colEntityId"), dataIndex: "entityId", key: "entityId" },
    {
      title: t("colAt"),
      dataIndex: "at",
      key: "at",
      render: (value: AuditLogRow["at"]) => dateFormatter.format(new Date(value)),
    },
  ];

  return (
    <Card title={t("auditTitle")} style={{ width: "100%" }}>
      <p style={{ marginTop: 0, color: "#6b7280" }}>{t("auditDescription")}</p>
      {state.status === "loading" ? <Alert type="info" showIcon title={t("loading")} /> : null}
      {state.status === "forbidden" ? (
        <Alert type="warning" showIcon title={t("forbidden")} />
      ) : null}
      {state.status === "error" ? <Alert type="error" showIcon title={t("genericError")} /> : null}
      {state.status === "ready" ? (
        <Table<AuditLogRow>
          rowKey="id"
          columns={columns}
          dataSource={state.rows}
          pagination={false}
          locale={{ emptyText: t("empty") }}
          size="small"
        />
      ) : null}
    </Card>
  );
}
