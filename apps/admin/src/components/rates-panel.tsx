"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Input, Modal, Space, Tag } from "antd";
import {
  AuthApiError,
  isTwoFactorRequired,
  isValidRateText,
  type Locale,
} from "@caribe/shared";
import {
  getCurrentRate,
  resolveRateAccess,
  setRateOverride,
  type ExchangeRateView,
  type RateAccessMode,
} from "@/lib/rates-client";

interface RatesPanelProps {
  locale: Locale;
  mode: RateAccessMode;
  role: string | null;
  agencyName?: string;
}

/** Tasa vigente y override con motivo (T-F2-8, wireframe panel-tasas.svg). */
export function RatesPanel({ locale, mode, role, agencyName }: RatesPanelProps) {
  const t = useTranslations("rates");
  const router = useRouter();
  const access = useMemo(() => resolveRateAccess({ mode, role }), [mode, role]);
  const redirectTo = `/${locale}/admin/rates`;

  const [current, setCurrent] = useState<ExchangeRateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
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
    getCurrentRate()
      .then((rate) => {
        if (active) setCurrent(rate);
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
  }, [access.visible, reload, handleError]);

  function closeModal(): void {
    setModalOpen(false);
    setRateInput("");
    setReason("");
    setValueDate("");
  }

  async function saveOverride(): Promise<void> {
    if (!isValidRateText(rateInput) || reason.trim() === "") {
      setNotice({ kind: "error", message: t("invalidRate") });
      return;
    }
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
          <Button
            type="primary"
            disabled={loading || current === null}
            onClick={() => {
              setNotice(null);
              setRateInput(current?.rate ?? "");
              setReason("");
              setValueDate(current?.valueDate ?? "");
              setModalOpen(true);
            }}
          >
            {t("edit")}
          </Button>
        ) : null}
      </Card>
      <Modal
        open={modalOpen}
        title={t("confirmTitle")}
        okText={t("confirmOverride")}
        cancelText={t("cancel")}
        confirmLoading={busy}
        okButtonProps={{ disabled: !isValidRateText(rateInput) || reason.trim() === "" }}
        onCancel={closeModal}
        onOk={() => void saveOverride()}
      >
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
      </Modal>
    </Card>
  );
}
