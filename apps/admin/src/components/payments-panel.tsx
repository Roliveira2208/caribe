"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  type TableColumnsType,
} from "antd";
import {
  AuthApiError,
  isTwoFactorRequired,
  PAYMENT_METHODS,
  type Locale,
  type PaymentModeValue,
} from "@caribe/shared";
import {
  canReviewPayment,
  downloadAdminPaymentsCsv,
  isReviewConflict,
  listAdminPayments,
  loadPaymentColumns,
  PAYMENT_COLUMN_KEYS,
  PAYMENT_FILTER_STATUSES,
  reviewAdminPayment,
  storePaymentColumns,
  validRejectionReason,
  type AdminPayment,
  type AdminPaymentPage,
  type PaymentColumnKey,
  type PaymentFilterMethod,
  type PaymentFilterStatus,
  type PaymentPanelAccess,
} from "@/lib/payments-client";
import { saveCsvBlob } from "@/lib/csv-download";
import { deniedStatusOf } from "@/lib/denied-data";

interface PaymentsPanelProps {
  locale: Locale;
  access: PaymentPanelAccess;
  /** Id de la sesión resuelto en el servidor; nunca se fía del cliente. */
  userId: string | null;
  /** Modo leído de la API; `null` oculta las acciones de revisión. */
  paymentMode: PaymentModeValue | null;
}

/** Panel de pagos del wireframe aprobado `panel-pagos.svg` (T-F2-11/T-F2-12). */
export function PaymentsPanel({ locale, access, userId, paymentMode }: PaymentsPanelProps) {
  const t = useTranslations("payments");
  const router = useRouter();
  const [status, setStatus] = useState<PaymentFilterStatus>("IN_REVIEW");
  const [method, setMethod] = useState<PaymentFilterMethod>("ALL");
  const [pages, setPages] = useState<AdminPaymentPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<PaymentColumnKey[]>(() =>
    loadPaymentColumns(typeof window === "undefined" ? undefined : window.localStorage),
  );
  const generation = useRef(0);
  const noticeRef = useRef<HTMLDivElement>(null);

  const redirectTo = `/${locale}/admin/payments`;
  const current = pages[pageIndex];
  const rows = current?.items ?? [];
  const nextCursor = current?.nextCursor ?? null;

  const handleError = useCallback(
    (cause: unknown) => {
      if (cause instanceof AuthApiError) {
        if (cause.status === 401) {
          router.replace(`/${locale}/login?redirectTo=${encodeURIComponent(redirectTo)}`);
          return;
        }
        if (isTwoFactorRequired(cause)) {
          router.replace(`/${locale}/two-factor?redirectTo=${encodeURIComponent(redirectTo)}`);
          return;
        }
        if (cause.code === "ACTIVE_ORGANIZATION_REQUIRED") {
          setPages([]);
          setNotice({ kind: "error", message: t("organizationError") });
          return;
        }
        const denied = deniedStatusOf(cause);
        if (denied !== null) {
          setPages([]);
          setNotice({
            kind: "error",
            message: denied === "forbidden" ? t("forbidden") : t("genericError"),
          });
          return;
        }
        if (isReviewConflict(cause)) {
          setNotice({ kind: "error", message: t("alreadyReviewed") });
          setReload((value) => value + 1);
          return;
        }
        if (cause.status === 410 && cause.code === "HOLD_EXPIRED") {
          setNotice({ kind: "error", message: t("holdExpired") });
          return;
        }
        if (cause.status === 422) {
          setNotice({ kind: "error", message: t("validationError") });
          return;
        }
      }
      setNotice({ kind: "error", message: t("genericError") });
    },
    [locale, redirectTo, router, t],
  );

  useEffect(() => {
    const token = ++generation.current;
    let active = true;
    setLoading(true);
    setNotice(null);
    setPages([]);
    setPageIndex(0);
    listAdminPayments({ status, method, cursor: null })
      .then((page) => {
        if (active && token === generation.current) setPages([page]);
      })
      .catch((cause: unknown) => {
        if (active && token === generation.current) handleError(cause);
      })
      .finally(() => {
        if (active && token === generation.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, method, reload, handleError]);

  // Los avisos de error y el estado vacío reciben el foco y son anunciados.
  useEffect(() => {
    if (notice !== null || (!loading && rows.length === 0)) noticeRef.current?.focus();
  }, [notice, loading, rows.length]);

  async function goNext(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    const target = pageIndex + 1;
    if (pages[target]) {
      setPageIndex(target);
      return;
    }
    const token = generation.current;
    setLoadingMore(true);
    setNotice(null);
    try {
      const page = await listAdminPayments({ status, method, cursor: nextCursor });
      if (token !== generation.current) return;
      setPages((previous) => [...previous.slice(0, target), page]);
      setPageIndex(target);
    } catch (cause) {
      if (token === generation.current) handleError(cause);
    } finally {
      if (token === generation.current) setLoadingMore(false);
    }
  }

  async function review(paymentId: string, action: "approve" | "reject", rejectionReason = "") {
    setBusy(true);
    setNotice(null);
    try {
      await reviewAdminPayment(paymentId, action, rejectionReason);
      setNotice({
        kind: "success",
        message: action === "approve" ? t("approvedNotice") : t("rejectedNotice"),
      });
      setRejectingId(null);
      setReason("");
      setReload((value) => value + 1);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  function statusLabel(value: string): string {
    return t(`status.${value.toLowerCase().replace(/_/g, "")}`);
  }

  function methodLabel(value: string): string {
    if (value === "PAGO_MOVIL") return t("methodMobile");
    if (value === "ZELLE") return t("methodZelle");
    if (value === "BINANCE_PAY") return t("methodBinance");
    return t("methodCard");
  }

  function columnLabelKey(key: PaymentColumnKey): string {
    return {
      id: "colPayment",
      bookingId: "colBooking",
      reportedBy: "colCustomer",
      method: "colMethod",
      amountUsd: "colAmountUsd",
      amountVes: "colAmountVes",
      exchangeRateId: "colRateId",
      valueDate: "colValueDate",
      status: "colStatus",
    }[key];
  }

  function toggleColumn(key: PaymentColumnKey): void {
    setSelectedColumns((previous) => {
      const next = previous.includes(key)
        ? previous.filter((item) => item !== key)
        : [...previous, key];
      // Al menos una columna de datos: la tabla nunca queda sin contenido.
      if (next.length === 0) return previous;
      storePaymentColumns(next, typeof window === "undefined" ? undefined : window.localStorage);
      return next;
    });
  }

  async function downloadCsv(): Promise<void> {
    setDownloading(true);
    setNotice(null);
    try {
      const blob = await downloadAdminPaymentsCsv({ status, method }, locale);
      saveCsvBlob(blob, t("csvFileName"));
    } catch {
      setNotice({ kind: "error", message: t("csvError") });
    } finally {
      setDownloading(false);
    }
  }

  const columns: TableColumnsType<AdminPayment> = [
    { title: t("colPayment"), dataIndex: "id", key: "id" },
    { title: t("colBooking"), dataIndex: "bookingId", key: "bookingId" },
    { title: t("colCustomer"), dataIndex: "reportedBy", key: "reportedBy" },
    {
      title: t("colMethod"),
      dataIndex: "method",
      key: "method",
      render: (value: AdminPayment["method"]) => methodLabel(value),
    },
    { title: t("colAmountUsd"), dataIndex: "amountUsd", key: "amountUsd" },
    {
      title: t("colAmountVes"),
      dataIndex: "amountVes",
      key: "amountVes",
      render: (_value: unknown, row: AdminPayment) => `${row.amountVes} · ${row.rate}`,
    },
    {
      title: t("colRateId"),
      key: "exchangeRateId",
      render: (_value: unknown, row: AdminPayment) => row.exchangeRateId,
    },
    {
      title: t("colValueDate"),
      key: "valueDate",
      render: (_value: unknown, row: AdminPayment) => row.valueDate,
    },
    {
      title: t("colStatus"),
      dataIndex: "status",
      key: "status",
      render: (value: AdminPayment["status"]) => (
        <Tag color={value === "APPROVED" ? "green" : value === "REJECTED" ? "red" : "gold"}>
          {statusLabel(value)}
        </Tag>
      ),
    },
    {
      title: t("colActions"),
      key: "actions",
      render: (_value: unknown, row: AdminPayment) => {
        if (row.status !== "IN_REVIEW") return t("noActions");
        const canReviewHere =
          access.canReview &&
          paymentMode === "MANUAL" &&
          canReviewPayment(access, row.reportedBy, userId);
        if (!canReviewHere) {
          const reason = !access.canReview
            ? t("readOnly")
            : paymentMode === null
              ? t("modeUnavailable")
              : paymentMode === "AUTO"
                ? t("automaticOnly")
                : t("selfReview");
          return (
            <Space size="small">
              <Button size="small" type="primary" disabled title={reason}>
                {t("approve")}
              </Button>
              <Button size="small" danger disabled title={reason}>
                {t("reject")}
              </Button>
              <span>{reason}</span>
            </Space>
          );
        }
        return (
          <Space size="small">
            <Popconfirm
              title={t("approveTitle")}
              description={t("approveDescription")}
              okText={t("approve")}
              cancelText={t("cancel")}
              onConfirm={() => void review(row.id, "approve")}
            >
              <Button size="small" type="primary" disabled={busy}>
                {t("approve")}
              </Button>
            </Popconfirm>
            <Button size="small" danger disabled={busy} onClick={() => setRejectingId(row.id)}>
              {t("reject")}
            </Button>
          </Space>
        );
      },
    },
  ];

  // Solo se ocultan columnas de datos; las acciones siguen disponibles.
  const visibleColumns = columns.filter(
    (column) => column.key === "actions" || selectedColumns.includes(column.key as PaymentColumnKey),
  );

  return (
    <Card title={t("title")} style={{ width: "100%" }}>
      <p style={{ marginTop: 0, color: "var(--caribe-ink)" }}>{t("description")}</p>
      <Space wrap style={{ marginBottom: 16 }}>
        <div>
          <label htmlFor="payments-status" style={{ display: "block", marginBottom: 4 }}>
            {t("statusLabel")}
          </label>
          <Select<PaymentFilterStatus>
            id="payments-status"
            style={{ width: 180 }}
            value={status}
            onChange={setStatus}
            options={[
              { value: "ALL", label: t("all") },
              ...PAYMENT_FILTER_STATUSES.map((value) => ({
                value,
                label: statusLabel(value),
              })),
            ]}
          />
        </div>
        <div>
          <label htmlFor="payments-method" style={{ display: "block", marginBottom: 4 }}>
            {t("methodLabel")}
          </label>
          <Select<PaymentFilterMethod>
            id="payments-method"
            style={{ width: 180 }}
            value={method}
            onChange={setMethod}
            options={[
              { value: "ALL", label: t("all") },
              ...PAYMENT_METHODS.map((value) => ({
                value,
                label: methodLabel(value),
              })),
            ]}
          />
        </div>
      </Space>
      <details style={{ marginBottom: 16 }}>
        <summary>{t("columnsLabel")}</summary>
        <p style={{ marginBottom: 8 }}>{t("columnsHint")}</p>
        <div
          role="group"
          aria-label={t("columnsLabel")}
          style={{ display: "flex", flexWrap: "wrap", gap: 12 }}
        >
          {PAYMENT_COLUMN_KEYS.map((key) => (
            <label key={key} htmlFor={`payments-column-${key}`}>
              <input
                id={`payments-column-${key}`}
                type="checkbox"
                checked={selectedColumns.includes(key)}
                onChange={() => toggleColumn(key)}
              />
              {t(columnLabelKey(key))}
            </label>
          ))}
        </div>
      </details>
      <Button
        aria-label={t("downloadCsv")}
        disabled={downloading}
        onClick={() => void downloadCsv()}
        style={{ marginBottom: 16 }}
      >
        {t("downloadCsv")}
      </Button>
      <div ref={noticeRef} tabIndex={-1}>
        {notice ? (
          <Alert type={notice.kind} showIcon title={notice.message} style={{ marginBottom: 16 }} />
        ) : null}
        {!loading && rows.length === 0 && notice === null ? (
          <div role="status" style={{ marginBottom: 16 }}>
            {t("empty")}
          </div>
        ) : null}
      </div>
      {loading || rows.length > 0 ? (
        <Table<AdminPayment>
          rowKey="id"
          loading={loading}
          columns={visibleColumns}
          dataSource={rows}
          pagination={false}
          size="small"
          locale={{ emptyText: t("empty") }}
        />
      ) : null}
      {rows.length > 0 ? (
        <Space wrap style={{ marginTop: 16 }}>
          <Button disabled={pageIndex === 0 || loading} onClick={() => setPageIndex((v) => v - 1)}>
            {t("previousPage")}
          </Button>
          <span aria-live="polite">{t("page", { current: pageIndex + 1 })}</span>
          <Button disabled={!nextCursor || loadingMore} onClick={() => void goNext()}>
            {t("nextPage")}
          </Button>
          {loadingMore ? <span role="status">{t("loadingMore")}</span> : null}
        </Space>
      ) : null}
      <Modal
        open={rejectingId !== null}
        title={t("rejectTitle")}
        okText={t("reject")}
        cancelText={t("cancel")}
        confirmLoading={busy}
        okButtonProps={{ disabled: !validRejectionReason(reason) }}
        onCancel={() => {
          setRejectingId(null);
          setReason("");
        }}
        onOk={() => {
          if (rejectingId && validRejectionReason(reason)) {
            void review(rejectingId, "reject", reason);
          }
        }}
      >
        <label htmlFor="rejection-reason" style={{ display: "block", marginBottom: 8 }}>
          {t("reasonLabel")}
        </label>
        <Input.TextArea
          id="rejection-reason"
          value={reason}
          maxLength={500}
          rows={4}
          onChange={(event) => setReason(event.target.value)}
        />
      </Modal>
    </Card>
  );
}
