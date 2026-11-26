"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Input, Select, Space, Table, Tag, type TableColumnsType } from "antd";
import {
  AuthApiError,
  isTwoFactorRequired,
  todayInCaracas,
  type Locale,
} from "@caribe/shared";
import {
  downloadSalesReportCsv,
  getSalesReport,
  listReportAgencies,
  resolveReportsAccess,
  type ReportAgencyOption,
  type ReportsMode,
  type SalesReport,
  type SalesReportFilters,
  type SalesReportRow,
} from "@/lib/reports-client";

interface ReportsPanelProps {
  locale: Locale;
  mode: ReportsMode;
  role: string | null;
  agencyName?: string;
}

type Notice = { kind: "success" | "error"; message: string };

const EMPTY_TOTALS: SalesReport["totals"] = {
  count: 0,
  amountUsd: "0.00",
  amountVes: "0.00",
};

function defaultFilters(): SalesReportFilters {
  const to = todayInCaracas();
  return { from: `${to.slice(0, 7)}-01`, to };
}

function sameFilters(left: SalesReportFilters, right: SalesReportFilters): boolean {
  return left.from === right.from && left.to === right.to && left.agencyId === right.agencyId;
}

/**
 * Panel del wireframe aprobado `panel-reportes.svg` (T-F2-23). Los importes y
 * los totales son texto que entrega la API; este componente solo los muestra.
 */
export function ReportsPanel({ locale, mode, role, agencyName }: ReportsPanelProps) {
  const t = useTranslations("reports");
  const tPayments = useTranslations("payments");
  const tStatus = useTranslations("payments.status");
  const router = useRouter();
  const access = useMemo(() => resolveReportsAccess(mode, role), [mode, role]);
  const redirectTo = `/${locale}/admin/reports`;

  const initial = useMemo(defaultFilters, []);
  const [draft, setDraft] = useState<SalesReportFilters>(initial);
  const [applied, setApplied] = useState<SalesReportFilters>(initial);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [agencies, setAgencies] = useState<ReportAgencyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reload, setReload] = useState(0);

  const handleError = useCallback(
    (cause: unknown, fallback: string) => {
      if (cause instanceof AuthApiError) {
        if (cause.status === 401) {
          router.replace(`/${locale}/login?redirectTo=${encodeURIComponent(redirectTo)}`);
          return;
        }
        if (isTwoFactorRequired(cause)) {
          setNotice({ kind: "error", message: t("twoFactorRequired") });
          router.replace(`/${locale}/two-factor?redirectTo=${encodeURIComponent(redirectTo)}`);
          return;
        }
        if (cause.status === 422) {
          setNotice({ kind: "error", message: t("validationError") });
          return;
        }
        if (cause.status === 403) {
          setNotice({ kind: "error", message: t("forbidden") });
          return;
        }
      }
      setNotice({ kind: "error", message: fallback });
    },
    [locale, redirectTo, router, t],
  );

  useEffect(() => {
    if (!access.visible) return;
    let active = true;
    setLoading(true);
    setNotice(null);
    getSalesReport(applied)
      .then((value) => {
        if (active) setReport(value);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setReport(null);
        handleError(cause, t("genericError"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [access.visible, applied, handleError, reload, t]);

  useEffect(() => {
    if (!access.canSelectAgency) return;
    let active = true;
    listReportAgencies()
      .then((options) => {
        if (active) setAgencies(options);
      })
      .catch(() => {
        if (active) setAgencies([]);
      });
    return () => {
      active = false;
    };
  }, [access.canSelectAgency]);

  function applyFilters(): void {
    const next: SalesReportFilters = {
      from: draft.from,
      to: draft.to,
      ...(access.canSelectAgency && draft.agencyId ? { agencyId: draft.agencyId } : {}),
    };
    setNotice(null);
    setApplied((current) => (sameFilters(current, next) ? { ...current } : next));
    setReload((value) => value + 1);
  }

  async function downloadCsv(): Promise<void> {
    setDownloading(true);
    setNotice(null);
    try {
      const blob = await downloadSalesReportCsv(applied, locale);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = t("csvFileName");
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (cause) {
      handleError(cause, t("csvError"));
    } finally {
      setDownloading(false);
    }
  }

  function methodLabel(method: string): string {
    switch (method) {
      case "PAGO_MOVIL":
        return tPayments("methodMobile");
      case "ZELLE":
        return tPayments("methodZelle");
      case "BINANCE_PAY":
        return tPayments("methodBinance");
      default:
        return method;
    }
  }

  function statusLabel(status: string): string {
    switch (status) {
      case "PENDING":
        return tStatus("pending");
      case "IN_REVIEW":
        return tStatus("inreview");
      case "APPROVED":
        return tStatus("approved");
      case "REJECTED":
        return tStatus("rejected");
      case "REFUNDED":
        return tStatus("refunded");
      case "PARTIALLY_REFUNDED":
        return tStatus("partiallyrefunded");
      default:
        return status;
    }
  }

  const columns: TableColumnsType<SalesReportRow> = [
    {
      title: t("colMethod"),
      key: "method",
      render: (_value: unknown, row: SalesReportRow) => methodLabel(row.method),
    },
    {
      title: t("colStatus"),
      key: "status",
      render: (_value: unknown, row: SalesReportRow) => <Tag>{statusLabel(row.status)}</Tag>,
    },
    {
      title: t("colCount"),
      key: "count",
      render: (_value: unknown, row: SalesReportRow) => row.count,
    },
    {
      title: t("colAmountUsd"),
      key: "amountUsd",
      render: (_value: unknown, row: SalesReportRow) => row.amountUsd,
    },
    {
      title: t("colAmountVes"),
      key: "amountVes",
      render: (_value: unknown, row: SalesReportRow) => row.amountVes,
    },
  ];

  if (!access.visible) {
    return (
      <Card title={t("title")} style={{ width: "100%" }}>
        <Alert type="warning" showIcon message={t("forbidden")} />
      </Card>
    );
  }

  const totals = report?.totals ?? EMPTY_TOTALS;
  const rows = report?.breakdown ?? [];

  return (
    <div style={{ width: "100%" }}>
      <Card
        title={t("title")}
        extra={agencyName ? t("activeAgency", { agency: agencyName }) : null}
      >
        <p style={{ marginTop: 0 }}>{t("description")}</p>
        {notice ? <Alert type={notice.kind} showIcon message={notice.message} /> : null}

        <Space wrap style={{ marginBottom: 12 }}>
          <div>
            <label htmlFor="report-from">{t("filterFrom")}</label>
            <Input
              id="report-from"
              type="date"
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </div>
          <div>
            <label htmlFor="report-to">{t("filterTo")}</label>
            <Input
              id="report-to"
              type="date"
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </div>
          {access.canSelectAgency ? (
            <div>
              <label htmlFor="report-agency">{t("filterAgency")}</label>
              <Select
                id="report-agency"
                style={{ width: 220 }}
                value={draft.agencyId ?? ""}
                onChange={(value: string) =>
                  setDraft({ ...draft, agencyId: value === "" ? undefined : value })
                }
                options={[
                  { value: "", label: t("allAgencies") },
                  ...agencies.map((agency) => ({ value: agency.id, label: agency.name })),
                ]}
              />
            </div>
          ) : null}
          <Button type="primary" onClick={applyFilters}>
            {t("apply")}
          </Button>
          <Button onClick={() => void downloadCsv()} loading={downloading}>
            {t("downloadCsv")}
          </Button>
        </Space>

        <p style={{ color: "var(--caribe-ink)" }}>{t("rangeNote")}</p>
        <p style={{ color: "var(--caribe-ink)" }}>
          {access.scope === "platform" ? t("scopeNotePlatform") : t("scopeNoteAgency")}
        </p>

        <h2>{t("totalsTitle")}</h2>
        <Space wrap style={{ marginBottom: 16 }}>
          <Card size="small" title={t("totalUsd")}>
            {loading ? t("loading") : totals.amountUsd}
          </Card>
          <Card size="small" title={t("totalVes")}>
            {loading ? t("loading") : totals.amountVes}
          </Card>
          <Card size="small" title={t("paymentCount")}>
            {loading ? t("loading") : totals.count}
          </Card>
        </Space>

        <h2>{t("breakdownTitle")}</h2>
        <Table
          rowKey={(row) => `${row.method}-${row.status}`}
          columns={columns}
          dataSource={rows}
          pagination={false}
          loading={loading}
          locale={{ emptyText: t("empty") }}
        />
      </Card>
    </div>
  );
}
