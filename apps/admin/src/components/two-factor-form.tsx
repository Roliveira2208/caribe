"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Form, Input, QRCode, Space, Typography } from "antd";
import {
  AuthApiError,
  enableTwoFactor,
  generateBackupCodes,
  getSession,
  parseOtpauthUri,
  secretFromOtpauthUri,
  twoFactorScreenMode,
  verifyTotp,
  type SessionData,
} from "@caribe/shared";
import { Link } from "@/i18n/navigation";

type Step = "loading" | "verify" | "password" | "qr" | "backupCodes";

interface TwoFactorFormProps {
  /** Destino validado por la pagina: path interno localizado. */
  redirectTo: string;
}

interface PasswordValues {
  password: string;
}

interface CodeValues {
  code: string;
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pantalla de segundo factor (spec auth-access) con dos modos:
 * - login pendiente de 2FA (sin sesion): solo pide el codigo TOTP;
 * - sesion sin TOTP: activacion con password -> QR + clave manual -> codigo
 *   -> aviso y copia de los codigos de recuperacion (se muestran UNA vez).
 *
 * El secreto TOTP y los codigos de recuperacion se renderizan en pantalla y
 * nunca se escriben en logs ni en URLs.
 */
export function TwoFactorForm({ redirectTo }: TwoFactorFormProps) {
  const t = useTranslations("twoFactor");
  const router = useRouter();
  const [step, setStep] = useState<Step>("loading");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [enableForm] = Form.useForm<PasswordValues>();
  const [regenForm] = Form.useForm<PasswordValues>();
  const [verifyForm] = Form.useForm<CodeValues>();

  useEffect(() => {
    let active = true;
    getSession()
      .then((session: SessionData | null) => {
        if (!active) return;
        if (twoFactorScreenMode(session) === "done") {
          router.replace(redirectTo);
          return;
        }
        setStep(twoFactorScreenMode(session) === "activate" ? "password" : "verify");
      })
      .catch(() => {
        if (active) setStep("verify");
      });
    return () => {
      active = false;
    };
  }, [redirectTo, router]);

  function messageFor(cause: unknown): string {
    if (cause instanceof AuthApiError) {
      if (cause.code === "INVALID_TWO_FACTOR_COOKIE" || cause.status === 401) {
        return t("expired");
      }
      if (cause.code === "INVALID_PASSWORD") {
        return t("invalidPassword");
      }
    }
    return t("genericError");
  }

  async function onEnable(values: PasswordValues) {
    setBusy(true);
    setError(null);
    try {
      const result = await enableTwoFactor(values.password);
      setTotpUri(result.totpURI ?? null);
      setBackupCodes(result.backupCodes ?? []);
      enableForm.resetFields();
      setStep("qr");
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(values: CodeValues) {
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(values.code);
      if (step === "qr") {
        setStep("backupCodes");
      } else {
        router.push(redirectTo);
      }
    } catch (cause) {
      setError(
        cause instanceof AuthApiError && cause.code === "INVALID_CODE"
          ? t("invalidCode")
          : messageFor(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onRegenerate(values: PasswordValues) {
    setBusy(true);
    setError(null);
    try {
      const codes = await generateBackupCodes(values.password);
      setBackupCodes(codes);
      regenForm.resetFields();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2000);
    }
  }

  const parsed = totpUri ? parseOtpauthUri(totpUri) : null;
  const secret = totpUri ? secretFromOtpauthUri(totpUri) : null;

  const title =
    step === "verify"
      ? t("verifyTitle")
      : step === "password" || step === "qr"
        ? t("activateTitle")
        : step === "backupCodes"
          ? t("backupCodesTitle")
          : t("title");
  const description =
    step === "verify"
      ? t("verifyDescription")
      : step === "password"
        ? t("activateDescription")
        : step === "qr"
          ? t("scanDescription")
          : step === "backupCodes"
            ? t("backupCodesDescription")
            : t("description");

  const errorAlert = error ? (
    <Alert
      type="error"
      showIcon
      title={error}
      action={error === t("expired") ? <Link href="/login">{t("expiredAction")}</Link> : undefined}
      style={{ marginBottom: 16 }}
    />
  ) : null;

  return (
    <Card title={title} style={{ width: "100%", maxWidth: 420 }}>
      <p style={{ marginTop: 0, color: "#6b7280" }}>{description}</p>

      {step === "loading" ? <Alert type="info" showIcon title={t("loading")} /> : null}

      {step === "verify" ? (
        <>
          {errorAlert}
          <Form<CodeValues> form={verifyForm} layout="vertical" onFinish={onVerify}>
            <Form.Item
              label={t("code")}
              name="code"
              rules={[{ required: true }, { pattern: /^[0-9]+$/, len: 6 }]}
            >
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t("codePlaceholder")}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={busy}>
              {busy ? t("verifying") : t("verify")}
            </Button>
          </Form>
        </>
      ) : null}

      {step === "password" ? (
        <>
          {errorAlert}
          <Form<PasswordValues> form={enableForm} layout="vertical" onFinish={onEnable}>
            <Form.Item label={t("password")} name="password" rules={[{ required: true }]}>
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={busy}>
              {busy ? t("enabling") : t("continue")}
            </Button>
          </Form>
        </>
      ) : null}

      {step === "qr" ? (
        <>
          {errorAlert}
          {totpUri ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
              <QRCode value={totpUri} size={180} />
            </div>
          ) : null}
          <div
            style={{
              background: "#f3f4f6",
              borderRadius: 8,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("manualKeyTitle")}
            </Typography.Text>
            {parsed?.account ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("accountLabel")}: {parsed.account}
              </Typography.Text>
            ) : null}
            {parsed?.issuer ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("issuerLabel")}: {parsed.issuer}
              </Typography.Text>
            ) : null}
            <Space align="center" style={{ justifyContent: "space-between" }}>
              <Typography.Text code copyable={false} style={{ fontSize: 13 }}>
                {secret}
              </Typography.Text>
              <Button size="small" onClick={() => void copy(secret ?? "", "secret")}>
                {copied === "secret" ? t("copied") : t("copy")}
              </Button>
            </Space>
          </div>
          <Form<CodeValues> form={verifyForm} layout="vertical" onFinish={onVerify}>
            <Form.Item
              label={t("code")}
              name="code"
              rules={[{ required: true }, { pattern: /^[0-9]+$/, len: 6 }]}
            >
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t("codePlaceholder")}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={busy}>
              {busy ? t("verifying") : t("verify")}
            </Button>
          </Form>
        </>
      ) : null}

      {step === "backupCodes" ? (
        <>
          <Alert
            type="warning"
            showIcon
            title={t("backupCodesWarning")}
            style={{ marginBottom: 16 }}
          />
          {backupCodes.length > 0 ? (
            <div
              style={{
                background: "#f3f4f6",
                borderRadius: 8,
                padding: 12,
                fontFamily: "monospace",
                fontSize: 13,
              }}
            >
              {backupCodes.map((backupCode) => (
                <div key={backupCode}>{backupCode}</div>
              ))}
            </div>
          ) : (
            <p style={{ color: "#6b7280" }}>{t("backupCodesEmpty")}</p>
          )}
          {backupCodes.length > 0 ? (
            <Button
              block
              style={{ marginTop: 8 }}
              onClick={() => void copy(backupCodes.join("\n"), "codes")}
            >
              {copied === "codes" ? t("copied") : t("copyAll")}
            </Button>
          ) : null}
          <Form<PasswordValues> form={regenForm} layout="vertical" onFinish={onRegenerate}>
            <Form.Item
              label={t("regenerateDescription")}
              name="password"
              rules={[{ required: true }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Button htmlType="submit" loading={busy}>
              {busy ? t("regenerating") : t("regenerate")}
            </Button>
          </Form>
          {errorAlert}
          <Button
            type="primary"
            block
            style={{ marginTop: 8 }}
            onClick={() => router.push(redirectTo)}
          >
            {t("finish")}
          </Button>
        </>
      ) : null}
    </Card>
  );
}
