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
  Space,
  Table,
  Tag,
  type TableColumnsType,
} from "antd";
import {
  AuthApiError,
  isTwoFactorRequired,
  isValidRateText,
  type Locale,
} from "@caribe/shared";
import {
  getCurrentRate,
  listRateAudits,
  resolveRateAccess,
  setRateOverride,
  type ExchangeRateView,
  type RateAccessMode,
  type RateAudit,
} from "@/lib/rates-client";

interface RatesPanelProps {
  locale: Locale;
  mode: RateAccessMode;
  role: string | null;
  agencyName?: string;
}

type ModalStage = "form" | "confirm";

function text(value: unknown, pending: string): string {
  return typeof value === "string" && value !== "" ? value : pending;
}

/** Panel de tasas del wireframe aprobado `panel-tasas.svg` (T-F2-8/T-F2-9). */
export function RatesPanel({ locale, mode, role, agencyName }: RatesPanelProps) {
  const t = useTranslations("rates");
  const router = useRouter();
  const access = useMemo(() => resolveRateAccess({ mode, role }), [mode, role]);
  const redirectTo = `/${locale}/admin/rates`;

  const [current, setCurrent] = useState<ExchangeRateView | null>(null);
  const [history, setHistory] = useState<RateAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [stage, setStage] = useState<ModalStage>("form");
  const [rateInput, setRateInput] = useState("");
  const [reason, setReason] = useState("");
  const [valueDate, setValueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const handleError = useCallback(
    (cause: unknown) => {
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
        if (cause.status === 403) {
          setNotice({ kind: "error", message: t("forbidden") });
          return;
        }
        if (cause.status === 404 || cause.status === 503) {
          setNotice({ kind: "error", message: t("rateUnavailable") });
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
    if (!access.visible) return;
    let active = true;
    setLoading(true);
    setNotice(null);
    Promise.all([
      getCurrentRate(),
      access.canViewHistory ? listRateAudits() : Promise.resolve<RateAudit[]>([]),
    ])
      .then(([rate, audits]) => {
        if (!active) return;
        setCurrent(rate);
        setHistory(audits);
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
  }, [access.visible, access.canViewHistory, reload, handleError]);

  function closeModal(): void {
    setModalOpen(false);
    setStage("form");
    setRateInput("");
    setReason("");
    setValueDate("");
  }

  function openModal(): void {
    setNotice(null);
    setStage("form");
    setRateInput(current?.rate ?? "");
    setReason("");
    setValueDate(current?.valueDate ?? "");
    setModalOpen(true);
  }

  function goToConfirm(): void {
    if (!isValidRateText(rateInput)) {
      setNotice({ kind: "error", message: t("invalidRate") });
      return;
    }
    if (reason.trim() === "") {
      setNotice({ kind: "error", message: t("validationError") });
      return;
    }
    setNotice(null);
    setStage("confirm");
  }

  async function confirmOverride(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const saved = await setRateOverride(
        {
          rate: rateInput,
          reason,
          ...(valueDate !== "" ? { valueDate } : {}),
        },
        { platform: mode === "platform" },
      );
      setCurrent(saved);
      setNotice({ kind: "success", message: t("savedNotice") });
      closeModal();
      setReload((value) => value + 1);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  const historyColumns: TableColumnsType<RateAudit> = [
    {
      title: t("colValueDate"),
      key: "valueDate",
      render: (_value: unknown, row: RateAudit) =>
        text(row.after?.["valueDate"] ?? row.before?.["valueDate"], t("pending")),
    },
    {
      title: t("colRate"),
      key: "rate",
      render: (_value: unknown, row: RateAudit) =>
        text(row.after?.["rate"] ?? row.before?.["rate"], t("pending")),
    },
    {
      title: t("colSource"),
      key: "source",
      render: (_value: unknown, row: RateAudit) => text(row.after?.["source"], t("pending")),
    },
    {
      title: t("colScope"),
      key: "scope",
      render: (_value: unknown, row: RateAudit) =>
        row.after?.["scope"] === "platform" ? t("scopePlatform") : t("scopeAgency"),
    },
    {
      title: t("colOverride"),
      key: "isOverride",
      render: (_value: unknown, row: RateAudit) =>
        row.after?.["isOverride"] === true ? t("yes") : t("no"),
    },
    {
      title: t("colReason"),
      key: "reason",
      render: (_value: unknown, row: RateAudit) => text(row.after?.["reason"], t("pending")),
    },
    {
      title: t("colActor"),
      key: "actorId",
      render: (_value: unknown, row: RateAudit) =>
        row.actorId === null ? t("actorUnknown") : row.actorId,
    },
  ];

  if (!access.visible) {
    return (
      <Card title={t("title")} style={{ width: "100%" }}>
        <Alert type="warning" showIcon title={t("forbidden")} />
      </Card>
    );
  }

  return (
    <Card title={t("title")} style={{ width: "100%" }}>
      <p style={{ marginTop: 0, color: "var(--caribe-ink)" }}>{t("description")}</p>
      {notice ? (
        <Alert type={notice.kind} showIcon title={notice.message} style={{ marginBottom: 16 }} />
      ) : null}
      <Card title={t("currentTitle")} size="small">
        {agencyName ? (
          <p style={{ marginTop: 0 }}>{t("activeAgency", { agency: agencyName })}</p>
        ) : null}
        {current ? (
          <>
            <p
              style={{
                margin: "8px 0 16px",
                fontSize: 26,
                fontWeight: 700,
                color: "var(--caribe-ink)",
              }}
            >
              {current.rate}
            </p>
            <Space wrap style={{ marginBottom: 16 }}>
              <Tag>{t("sourceValue", { source: current.source })}</Tag>
              <Tag>{t("valueDateValue", { valueDate: current.valueDate })}</Tag>
              <Tag>
                {t("scopeValue", {
                  scope: current.scope === "platform" ? t("scopePlatform") : t("scopeAgency"),
                })}
              </Tag>
              <Tag>{t("overrideValue", { value: current.isOverride ? t("yes") : t("no") })}</Tag>
            </Space>
          </>
        ) : (
          <p>{t("loading")}</p>
        )}
        {access.canOverride ? (
          <Button type="primary" onClick={openModal} disabled={loading || current === null}>
            {t("edit")}
          </Button>
        ) : null}
      </Card>
      {access.canViewHistory ? (
        <Card title={t("historyTitle")} size="small" style={{ marginTop: 16 }}>
          <p style={{ marginTop: 0 }}>{t("historyDescription")}</p>
          <Table<RateAudit>
            rowKey="id"
            loading={loading}
            columns={historyColumns}
            dataSource={history}
            pagination={{ pageSize: 10 }}
            size="small"
            locale={{ emptyText: t("emptyHistory") }}
          />
        </Card>
      ) : null}
      <Modal
        open={modalOpen}
        title={t("confirmTitle")}
        okText={stage === "confirm" ? t("confirmOverride") : t("continue")}
        cancelText={t("cancel")}
        confirmLoading={busy}
        okButtonProps={{
          disabled:
            stage === "confirm" ? busy : !isValidRateText(rateInput) || reason.trim() === "",
        }}
        onCancel={closeModal}
        onOk={() => {
          if (stage === "confirm") void confirmOverride();
          else goToConfirm();
        }}
      >
        <p>{t("confirmDescription")}</p>
        <p>{t("confirmStep", { current: stage === "confirm" ? 2 : 1, total: 2 })}</p>
        {stage === "confirm" ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <div>
              {t("beforeValue", {
                rate: current?.rate ?? t("pending"),
                source: current?.source ?? t("pending"),
              })}
            </div>
            <div>{t("afterValue", { rate: rateInput })}</div>
          </Space>
        ) : (
          <Space direction="vertical" style={{ width: "100%" }}>
            <div>
              <label htmlFor="rates-rate" style={{ display: "block", marginBottom: 4 }}>
                {t("rateLabel")}
              </label>
              <Input
                id="rates-rate"
                value={rateInput}
                onChange={(event) => setRateInput(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="rates-reason" style={{ display: "block", marginBottom: 4 }}>
                {t("reasonLabel")}
              </label>
              <Input.TextArea
                id="rates-reason"
                value={reason}
                maxLength={200}
                rows={3}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="rates-value-date" style={{ display: "block", marginBottom: 4 }}>
                {t("valueDateLabel")}
              </label>
              <Input
                id="rates-value-date"
                value={valueDate}
                placeholder={t("valueDatePlaceholder")}
                onChange={(event) => setValueDate(event.target.value)}
              />
            </div>
          </Space>
        )}
        <p style={{ marginBottom: 0 }}>{t("cancelHint")}</p>
      </Modal>
    </Card>
  );
}
