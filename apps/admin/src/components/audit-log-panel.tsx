"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Table, Tabs, type TableColumnsType } from "antd";
import { AuthApiError, isTwoFactorRequired, type Locale } from "@caribe/shared";
import {
  downloadAdminAuditCsv,
  isAuditOrganizationError,
  listAdminAuditLogs,
  listAuthEvents,
  type AuditLogItem,
  type AuthEventItem,
} from "@/lib/audit-client";
import { saveCsvBlob } from "@/lib/csv-download";

interface AuditLogPanelProps {
  locale: Locale;
  /** Destino validado por la página: path interno localizado. */
  redirectTo: string;
}

type TabKey = "audit" | "auth";

interface AuditDraft {
  action: string;
  entity: string;
  actor: string;
  from: string;
  to: string;
}

interface AuthDraft {
  route: string;
  outcome: "all" | "success" | "error";
  from: string;
  to: string;
}

interface AppliedFilters {
  audit: AuditDraft;
  auth: AuthDraft;
}

type PanelData =
  | { status: "loading"; tab: TabKey }
  | { status: "forbidden" | "organization" | "error"; tab: TabKey }
  | {
      status: "ready";
      tab: "audit";
      items: AuditLogItem[];
      nextCursor: string | null;
      page: number;
    }
  | {
      status: "ready";
      tab: "auth";
      items: AuthEventItem[];
      nextCursor: string | null;
      page: number;
    };

const EMPTY_AUDIT: AuditDraft = { action: "", entity: "", actor: "", from: "", to: "" };
const EMPTY_AUTH: AuthDraft = { route: "", outcome: "all", from: "", to: "" };
const EMPTY_FILTERS: AppliedFilters = { audit: EMPTY_AUDIT, auth: EMPTY_AUTH };

/** Convierte la fecha del control a ISO; el rango se cierra al final del día. */
function isoFromDate(value: string, endOfDay: boolean): string | undefined {
  if (value === "") return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Solo muestra campos de negocio: el API ya redactó antes/after. */
function describeState(value: unknown, fallback: string): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  const parts = ["rate", "status", "reason", "role", "source", "valueDate"]
    .filter((key) => record[key] !== undefined && record[key] !== null)
    .map((key) => `${key}=${String(record[key])}`);
  return parts.length > 0 ? parts.join(", ") : fallback;
}

/**
 * Visor de auditoría y eventos de autenticación (T-F2-15, spec audit del
 * delta): dos pestañas de solo lectura, filtros enviados al servidor, cursor
 * opaco devuelto por la API y matriz de roles resuelta en el servidor. El panel
 * no calcula totales ni construye cursores.
 */
export function AuditLogPanel({ locale, redirectTo }: AuditLogPanelProps) {
  const t = useTranslations("audit");
  const router = useRouter();
  const noticeRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<TabKey>("audit");
  const [draft, setDraft] = useState<AppliedFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AppliedFilters>(EMPTY_FILTERS);
  const [cursorHistory, setCursorHistory] = useState<Record<TabKey, Array<string | null>>>({
    audit: [null],
    auth: [null],
  });
  const [pageRequest, setPageRequest] = useState<{
    tab: TabKey;
    cursor: string | null;
    page: number;
  }>({ tab: "audit", cursor: null, page: 0 });
  const [data, setData] = useState<PanelData>({ status: "loading", tab: "audit" });
  const [downloading, setDownloading] = useState(false);
  const [csvNotice, setCsvNotice] = useState<string | null>(null);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  useEffect(() => {
    let active = true;
    setData({ status: "loading", tab });

    const currentRequest = pageRequest.tab === tab ? pageRequest : { cursor: null, page: 0 };
    const cursor = currentRequest.cursor;
    const request =
      tab === "audit"
        ? listAdminAuditLogs({
            action: applied.audit.action.trim() || undefined,
            entity: applied.audit.entity.trim() || undefined,
            actor: applied.audit.actor.trim() || undefined,
            from: isoFromDate(applied.audit.from, false),
            to: isoFromDate(applied.audit.to, true),
            cursor: cursor ?? undefined,
          })
        : listAuthEvents({
            route: applied.auth.route.trim() || undefined,
            outcome: applied.auth.outcome === "all" ? undefined : applied.auth.outcome,
            from: isoFromDate(applied.auth.from, false),
            to: isoFromDate(applied.auth.to, true),
            cursor: cursor ?? undefined,
          });

    request
      .then((page) => {
        if (!active) return;
        if (tab === "audit") {
          setData({
            status: "ready",
            tab: "audit",
            items: page.items as AuditLogItem[],
            nextCursor: page.nextCursor,
            page: currentRequest.page,
          });
        } else {
          setData({
            status: "ready",
            tab: "auth",
            items: page.items as AuthEventItem[],
            nextCursor: page.nextCursor,
            page: currentRequest.page,
          });
        }
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
            setData({ status: "forbidden", tab });
            return;
          }
          if (isAuditOrganizationError(cause)) {
            setData({ status: "organization", tab });
            return;
          }
        }
        setData({ status: "error", tab });
      });

    return () => {
      active = false;
    };
  }, [tab, applied, pageRequest, locale, redirectTo, router]);

  useEffect(() => {
    if (data.status !== "ready" && data.status !== "loading") noticeRef.current?.focus();
  }, [data.status]);

  function resetPagination(key: TabKey): void {
    setCursorHistory((previous) => ({ ...previous, [key]: [null] }));
    setPageRequest((previous) =>
      previous.tab === key ? { tab: key, cursor: null, page: 0 } : previous,
    );
  }

  function changeTab(next: string): void {
    if (next !== "audit" && next !== "auth") return;
    setTab(next);
    setCursorHistory((previous) => ({ ...previous, [next]: [null] }));
    setPageRequest({ tab: next, cursor: null, page: 0 });
    setData({ status: "loading", tab: next });
  }

  async function downloadCsv(): Promise<void> {
    setDownloading(true);
    setCsvNotice(null);
    try {
      const blob = await downloadAdminAuditCsv(applied.audit, locale);
      saveCsvBlob(blob, t("csvFileName"));
    } catch {
      setCsvNotice(t("csvError"));
    } finally {
      setDownloading(false);
    }
  }

  function applyFilters(key: TabKey): void {
    setApplied((previous) =>
      key === "audit"
        ? { ...previous, audit: { ...draft.audit } }
        : { ...previous, auth: { ...draft.auth } },
    );
    resetPagination(key);
    if (tab === key) setData({ status: "loading", tab: key });
  }

  function clearFilters(key: TabKey): void {
    setDraft((previous) =>
      key === "audit"
        ? { ...previous, audit: { ...EMPTY_AUDIT } }
        : { ...previous, auth: { ...EMPTY_AUTH } },
    );
    setApplied((previous) =>
      key === "audit"
        ? { ...previous, audit: { ...EMPTY_AUDIT } }
        : { ...previous, auth: { ...EMPTY_AUTH } },
    );
    resetPagination(key);
    if (tab === key) setData({ status: "loading", tab: key });
  }

  function nextPage(): void {
    if (data.status !== "ready" || data.nextCursor === null) return;
    const cursor = data.nextCursor;
    setCursorHistory((previous) => ({
      ...previous,
      [tab]: [...previous[tab].slice(0, data.page + 1), cursor],
    }));
    setPageRequest({ tab, cursor, page: data.page + 1 });
  }

  function previousPage(): void {
    if (data.status !== "ready" || data.page === 0) return;
    const cursor = cursorHistory[tab][data.page - 1] ?? null;
    setPageRequest({ tab, cursor, page: data.page - 1 });
  }

  const notice =
    data.status === "loading"
      ? { kind: "info" as const, title: t("loading") }
      : data.status === "forbidden"
        ? { kind: "warning" as const, title: t("forbidden") }
        : data.status === "organization"
          ? { kind: "warning" as const, title: t("organizationError") }
          : data.status === "error"
            ? { kind: "error" as const, title: t("genericError") }
            : null;

  const formatDate = (value: string): string => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
  };
  const actorOrUnknown = (value: string | null): string => value ?? t("ipUnknown");
  const ipOrUnknown = (value: string | null): string => value ?? t("ipUnknown");
  const scopeOf = (tenantId: string | null): string =>
    tenantId === null ? t("scopePlatform") : t("scopeAgency");

  const auditColumns: TableColumnsType<AuditLogItem> = [
    {
      title: t("colAt"),
      dataIndex: "at",
      key: "at",
      render: (value: string) => formatDate(value),
    },
    {
      title: t("colActor"),
      dataIndex: "actorId",
      key: "actorId",
      render: (value: string | null) => actorOrUnknown(value),
    },
    { title: t("colActionRoute"), dataIndex: "action", key: "action" },
    {
      title: t("colEntity"),
      key: "entity",
      render: (_: unknown, row: AuditLogItem) => `${row.entity}: ${row.entityId}`,
    },
    {
      title: t("colChange"),
      key: "change",
      render: (_: unknown, row: AuditLogItem) =>
        `${describeState(row.before, t("noChange"))} → ${describeState(row.after, t("noChange"))}`,
    },
    {
      title: t("colIp"),
      dataIndex: "ip",
      key: "ip",
      render: (value: string | null) => ipOrUnknown(value),
    },
    { title: t("colResult"), key: "result", render: () => t("resultOk") },
    {
      title: t("colScope"),
      dataIndex: "tenantId",
      key: "tenantId",
      render: (value: string | null) => scopeOf(value),
    },
  ];

  const authColumns: TableColumnsType<AuthEventItem> = [
    {
      title: t("colAt"),
      dataIndex: "at",
      key: "at",
      render: (value: string) => formatDate(value),
    },
    {
      title: t("colActor"),
      dataIndex: "actorId",
      key: "actorId",
      render: (value: string | null) => actorOrUnknown(value),
    },
    {
      title: t("colActionRoute"),
      key: "route",
      render: (_: unknown, row: AuthEventItem) => `${row.method} ${row.route}`,
    },
    {
      title: t("colEntity"),
      key: "entity",
      render: (_: unknown, row: AuthEventItem) => {
        const entity = row.entity ?? row.correlationId;
        return row.entityId === null ? entity : `${entity}: ${row.entityId}`;
      },
    },
    {
      title: t("colCorrelation"),
      dataIndex: "correlationId",
      key: "correlationId",
    },
    {
      title: t("colChange"),
      dataIndex: "phase",
      key: "phase",
    },
    {
      title: t("colIp"),
      dataIndex: "ip",
      key: "ip",
      render: (value: string | null) => ipOrUnknown(value),
    },
    {
      title: t("colResult"),
      key: "result",
      render: (_: unknown, row: AuthEventItem) => {
        if (row.error !== null) return row.error.code;
        return row.outcome === "success" ? t("resultOk") : actorOrUnknown(row.outcome);
      },
    },
    {
      title: t("colScope"),
      dataIndex: "tenantId",
      key: "tenantId",
      render: (value: string | null) => scopeOf(value),
    },
  ];

  const currentPage = data.status === "ready" ? data.page : 0;
  const hasNext = data.status === "ready" && data.nextCursor !== null;

  function pagination(): ReactNode {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        <Button aria-label={t("previousPage")} disabled={currentPage === 0} onClick={previousPage}>
          {t("previousPage")}
        </Button>
        <span>{t("page", { current: currentPage + 1 })}</span>
        <Button aria-label={t("nextPage")} disabled={!hasNext} onClick={nextPage}>
          {t("nextPage")}
        </Button>
      </div>
    );
  }

  return (
    <Card title={t("tabAudit")} style={{ width: "100%" }}>
      <p style={{ marginTop: 0, color: "var(--caribe-ink)" }}>{t("description")}</p>
      <div ref={noticeRef} tabIndex={-1}>
        {notice ? <Alert type={notice.kind} showIcon title={notice.title} /> : null}
      </div>
      <Tabs
        activeKey={tab}
        onChange={changeTab}
        items={[
          {
            key: "audit",
            label: t("tabAudit"),
            children: (
              <div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyFilters("audit");
                  }}
                  style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}
                >
                  <div>
                    <label htmlFor="audit-action">{t("filterAction")}</label>
                    <input
                      id="audit-action"
                      value={draft.audit.action}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          audit: { ...previous.audit, action: event.target.value },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="audit-entity">{t("filterEntity")}</label>
                    <input
                      id="audit-entity"
                      value={draft.audit.entity}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          audit: { ...previous.audit, entity: event.target.value },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="audit-actor">{t("filterActor")}</label>
                    <input
                      id="audit-actor"
                      value={draft.audit.actor}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          audit: { ...previous.audit, actor: event.target.value },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="audit-from">{t("filterFrom")}</label>
                    <input
                      id="audit-from"
                      type="date"
                      value={draft.audit.from}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          audit: { ...previous.audit, from: event.target.value },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="audit-to">{t("filterTo")}</label>
                    <input
                      id="audit-to"
                      type="date"
                      value={draft.audit.to}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          audit: { ...previous.audit, to: event.target.value },
                        }))
                      }
                    />
                  </div>
                  <Button type="primary" htmlType="submit">
                    {t("apply")}
                  </Button>
                  <Button htmlType="button" onClick={() => clearFilters("audit")}>
                    {t("clear")}
                  </Button>
                </form>
                <Button
                  aria-label={t("downloadCsv")}
                  disabled={downloading}
                  onClick={() => void downloadCsv()}
                  style={{ marginTop: 12 }}
                >
                  {t("downloadCsv")}
                </Button>
                {csvNotice ? (
                  <Alert
                    type="error"
                    showIcon
                    title={csvNotice}
                    style={{ marginTop: 12 }}
                  />
                ) : null}
                {data.status === "ready" && data.tab === "audit" ? (
                  <>
                    <Table<AuditLogItem>
                      rowKey="id"
                      columns={auditColumns}
                      dataSource={data.items}
                      pagination={false}
                      locale={{ emptyText: t("empty") }}
                      size="small"
                    />
                    {pagination()}
                  </>
                ) : null}
              </div>
            ),
          },
          {
            key: "auth",
            label: t("tabAuth"),
            children: (
              <div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyFilters("auth");
                  }}
                  style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}
                >
                  <div>
                    <label htmlFor="auth-route">{t("filterRoute")}</label>
                    <input
                      id="auth-route"
                      value={draft.auth.route}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          auth: { ...previous.auth, route: event.target.value },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="auth-outcome">{t("filterOutcome")}</label>
                    <select
                      id="auth-outcome"
                      value={draft.auth.outcome}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          auth: {
                            ...previous.auth,
                            outcome: event.target.value as AuthDraft["outcome"],
                          },
                        }))
                      }
                    >
                      <option value="all">{t("outcomeAll")}</option>
                      <option value="success">{t("outcomeSuccess")}</option>
                      <option value="error">{t("outcomeError")}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="auth-from">{t("filterFrom")}</label>
                    <input
                      id="auth-from"
                      type="date"
                      value={draft.auth.from}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          auth: { ...previous.auth, from: event.target.value },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="auth-to">{t("filterTo")}</label>
                    <input
                      id="auth-to"
                      type="date"
                      value={draft.auth.to}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          auth: { ...previous.auth, to: event.target.value },
                        }))
                      }
                    />
                  </div>
                  <Button type="primary" htmlType="submit">
                    {t("apply")}
                  </Button>
                  <Button htmlType="button" onClick={() => clearFilters("auth")}>
                    {t("clear")}
                  </Button>
                </form>
                {data.status === "ready" && data.tab === "auth" ? (
                  <>
                    <Table<AuthEventItem>
                      rowKey="id"
                      columns={authColumns}
                      dataSource={data.items}
                      pagination={false}
                      locale={{ emptyText: t("empty") }}
                      size="small"
                    />
                    {pagination()}
                  </>
                ) : null}
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}
