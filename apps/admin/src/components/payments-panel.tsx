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
} from "@caribe/shared";
import {
  canReviewPayment,
  isReviewConflict,
  listAdminPayments,
  PAYMENT_FILTER_STATUSES,
  reviewAdminPayment,
  validRejectionReason,
  type AdminPayment,
  type AdminPaymentPage,
  type PaymentFilterMethod,
  type PaymentFilterStatus,
  type PaymentPanelAccess,
} from "@/lib/payments-client";

interface PaymentsPanelProps {
  locale: Locale;
  access: PaymentPanelAccess;
  /** Id de la sesión resuelto en el servidor; nunca se fía del cliente. */
  userId: string | null;
}

/** Panel de pagos del wireframe aprobado `panel-pagos.svg` (T-F2-11/T-F2-12). */
export function PaymentsPanel({ locale, access, userId }: PaymentsPanelProps) {
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
  const generation = useRef(0);

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
        if (cause.status === 403) {
          setNotice({ kind: "error", message: t("forbidden") });
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
        if (!access.canReview || !canReviewPayment(access, row.reportedBy, userId)) {
          const reason = access.canReview ? t("selfReview") : t("readOnly");
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
      {notice ? (
        <Alert type={notice.kind} showIcon title={notice.message} style={{ marginBottom: 16 }} />
      ) : null}
      <Table<AdminPayment>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
        size="small"
        locale={{ emptyText: t("empty") }}
      />
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
