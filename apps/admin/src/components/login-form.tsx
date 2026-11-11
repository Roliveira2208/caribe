"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Form, Input } from "antd";
import { signInEmail, twoFactorSignInPending, AuthApiError, type Locale } from "@caribe/shared";

interface LoginFormProps {
  locale: Locale;
  /** Destino validado por la pagina: path interno localizado. */
  redirectTo: string;
}

interface LoginValues {
  email: string;
  password: string;
}

/**
 * Login con email/password. Si Better Auth deja el login pendiente del segundo
 * factor (twoFactorRedirect), lleva a la pantalla TOTP con el mismo destino.
 */
export function LoginForm({ locale, redirectTo }: LoginFormProps) {
  const t = useTranslations("login");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFinish(values: LoginValues) {
    setBusy(true);
    setError(null);
    try {
      const result = await signInEmail(values.email, values.password);
      if (twoFactorSignInPending(result)) {
        router.push(`/${locale}/two-factor?redirectTo=${encodeURIComponent(redirectTo)}`);
        return;
      }
      router.push(redirectTo);
    } catch (cause) {
      setError(
        cause instanceof AuthApiError && cause.status === 401
          ? t("invalidCredentials")
          : t("genericError"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("title")} style={{ width: "100%", maxWidth: 380 }}>
      <p style={{ marginTop: 0, color: "#6b7280" }}>{t("description")}</p>
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Form<LoginValues> layout="vertical" requiredMark={false} onFinish={onFinish}>
        <Form.Item label={t("email")} name="email" rules={[{ required: true }, { type: "email" }]}>
          <Input type="email" autoComplete="email" />
        </Form.Item>
        <Form.Item label={t("password")} name="password" rules={[{ required: true }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          {busy ? t("submitting") : t("submit")}
        </Button>
      </Form>
    </Card>
  );
}
