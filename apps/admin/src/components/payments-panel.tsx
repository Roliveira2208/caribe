"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  listAdminPayments,
  PAYMENT_FILTER_STATUSES,
  reviewAdminPayment,
  validRejectionReason,
  type AdminPayment,
  type PaymentFilterMethod,
  type PaymentFilterStatus,
} from "@/lib/payments-client";

interface PaymentsPanelProps {
  locale: Locale;
}

/** Panel mínimo de revisión de pagos (T-F1-9c, wireframe panel-pagos.svg). */
export function PaymentsPanel({ locale }: PaymentsPanelProps) {
  const t = useTranslations("payments");
  const router = useRouter();
  const [status, setStatus] = useState<PaymentFilterStatus>("IN_REVIEW");
  const [method, setMethod] = useState<PaymentFilterMethod>("ALL");
  const [rows, setRows] = useState<AdminPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const redirectTo = `/${locale}/admin/payments`;

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
          setNotice(t("forbidden"));
          return;
        }
        if (cause.status === 409 && cause.code === "PAYMENT_ALREADY_REVIEWED") {
          setNotice(t("alreadyReviewed"));
          setReload((value) => value + 1);
          return;
        }
        if (cause.status === 410 && cause.code === "HOLD_EXPIRED") {
          setNotice(t("holdExpired"));
          return;
        }
        if (cause.status === 422) {
          setNotice(t("validationError"));
          return;
        }
      }
      setNotice(t("genericError"));
    },
    [locale, redirectTo, router, t],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotice(null);
    listAdminPayments({ status, method })
      .then((page) => {
        if (active) setRows(page.items);
      })
      .catch((cause: unknown) => {
        if (active) handleError(cause);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, method, reload, handleError]);

  const moneyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      }),
    [locale],
  );
  const vesFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [locale],
  );

  async function review(paymentId: string, action: "approve" | "reject", rejectionReason = "") {
    setBusy(true);
    setNotice(null);
    try {
      await reviewAdminPayment(paymentId, action, rejectionReason);
      setNotice(action === "approve" ? t("approvedNotice") : t("rejectedNotice"));
      setRejectingId(null);
      setReason("");
      setReload((value) => value + 1);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
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
      render: (value: AdminPayment["method"]) =>
        value === "PAGO_MOVIL"
          ? t("methodMobile")
          : value === "ZELLE"
            ? "Zelle"
            : value === "BINANCE_PAY"
              ? "Binance Pay"
              : t("methodCard"),
    },
    {
      title: t("colAmountUsd"),
      dataIndex: "amountUsd",
      key: "amountUsd",
      render: (value: AdminPayment["amountUsd"]) => moneyFormatter.format(Number(value)),
    },
    {
      title: t("colAmountVes"),
      key: "amountVes",
      render: (_value: unknown, row: AdminPayment) =>
        `${vesFormatter.format(Number(row.amountVes))} · ${row.rate}`,
    },
    {
      title: t("colStatus"),
      dataIndex: "status",
      key: "status",
      render: (value: AdminPayment["status"]) => (
        <Tag color={value === "APPROVED" ? "green" : value === "REJECTED" ? "red" : "gold"}>
          {t(`status.${value.toLowerCase().replace(/_/g, "")}`)}
        </Tag>
      ),
    },
    {
      title: t("colActions"),
      key: "actions",
      render: (_value: unknown, row: AdminPayment) =>
        row.status === "IN_REVIEW" ? (
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
        ) : (
          "—"
        ),
    },
  ];

  return (
    <Card title={t("title")} style={{ width: "100%" }}>
      <p style={{ marginTop: 0, color: "#6b7280" }}>{t("description")}</p>
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
                label: t(`status.${value.toLowerCase().replace(/_/g, "")}`),
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
                label:
                  value === "PAGO_MOVIL"
                    ? t("methodMobile")
                    : value === "BINANCE_PAY"
                      ? "Binance Pay"
                      : value === "CARD"
                        ? t("methodCard")
                        : "Zelle",
              })),
            ]}
          />
        </div>
      </Space>
      {notice ? <Alert type="info" showIcon title={notice} style={{ marginBottom: 16 }} /> : null}
      <Table<AdminPayment>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        size="small"
        locale={{ emptyText: t("empty") }}
      />
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
