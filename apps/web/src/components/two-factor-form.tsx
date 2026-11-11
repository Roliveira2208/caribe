"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Step = "loading" | "verify" | "password" | "qr" | "backupCodes";

interface TwoFactorFormProps {
  /** Destino validado por la pagina: path interno localizado. */
  redirectTo: string;
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
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [regenPassword, setRegenPassword] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

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

  async function onEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await enableTwoFactor(password);
      setTotpUri(result.totpURI ?? null);
      setBackupCodes(result.backupCodes ?? []);
      setPassword("");
      setStep("qr");
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(code);
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

  async function onRegenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const codes = await generateBackupCodes(regenPassword);
      setBackupCodes(codes);
      setRegenPassword("");
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

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          {step === "verify"
            ? t("verifyTitle")
            : step === "password" || step === "qr"
              ? t("activateTitle")
              : step === "backupCodes"
                ? t("backupCodesTitle")
                : t("title")}
        </CardTitle>
        <CardDescription>
          {step === "verify"
            ? t("verifyDescription")
            : step === "password"
              ? t("activateDescription")
              : step === "qr"
                ? t("scanDescription")
                : step === "backupCodes"
                  ? t("backupCodesDescription")
                  : t("description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "loading" ? <p className="text-sm text-slate-500">{t("loading")}</p> : null}

        {step === "verify" ? (
          <form className="space-y-4" onSubmit={onVerify}>
            <div className="space-y-2">
              <Label htmlFor="totp-code">{t("code")}</Label>
              <Input
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                required
                placeholder={t("codePlaceholder")}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            {error ? (
              <div role="alert" className="space-y-1 text-sm text-red-600">
                <p>{error}</p>
                {error === t("expired") ? (
                  <Link className="underline" href="/login">
                    {t("expiredAction")}
                  </Link>
                ) : null}
              </div>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t("verifying") : t("verify")}
            </Button>
          </form>
        ) : null}

        {step === "password" ? (
          <form className="space-y-4" onSubmit={onEnable}>
            <div className="space-y-2">
              <Label htmlFor="totp-password">{t("password")}</Label>
              <Input
                id="totp-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t("enabling") : t("continue")}
            </Button>
          </form>
        ) : null}

        {step === "qr" ? (
          <div className="space-y-4">
            {totpUri ? (
              <div className="flex justify-center rounded-lg bg-white p-4">
                <QRCode value={totpUri} size={180} />
              </div>
            ) : null}
            <div className="space-y-1 rounded-md bg-slate-100 p-3">
              <p className="text-xs font-medium text-slate-500">{t("manualKeyTitle")}</p>
              {parsed?.account ? (
                <p className="text-xs text-slate-500">
                  {t("accountLabel")}: {parsed.account}
                </p>
              ) : null}
              {parsed?.issuer ? (
                <p className="text-xs text-slate-500">
                  {t("issuerLabel")}: {parsed.issuer}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <code className="overflow-x-auto text-sm">{secret}</code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copy(secret ?? "", "secret")}
                >
                  {copied === "secret" ? t("copied") : t("copy")}
                </Button>
              </div>
            </div>
            <form className="space-y-4" onSubmit={onVerify}>
              <div className="space-y-2">
                <Label htmlFor="totp-confirm">{t("code")}</Label>
                <Input
                  id="totp-confirm"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  required
                  placeholder={t("codePlaceholder")}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </div>
              {error ? (
                <div role="alert" className="space-y-1 text-sm text-red-600">
                  <p>{error}</p>
                  {error === t("expired") ? (
                    <Link className="underline" href="/login">
                      {t("expiredAction")}
                    </Link>
                  ) : null}
                </div>
              ) : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? t("verifying") : t("verify")}
              </Button>
            </form>
          </div>
        ) : null}

        {step === "backupCodes" ? (
          <div className="space-y-4">
            <p role="alert" className="rounded-md bg-coral-500/10 p-3 text-sm text-coral-600">
              {t("backupCodesWarning")}
            </p>
            {backupCodes.length > 0 ? (
              <div className="space-y-2">
                <ul className="space-y-1 rounded-md bg-slate-100 p-3 font-mono text-sm">
                  {backupCodes.map((backupCode) => (
                    <li key={backupCode}>{backupCode}</li>
                  ))}
                </ul>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copy(backupCodes.join("\n"), "codes")}
                >
                  {copied === "codes" ? t("copied") : t("copyAll")}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">{t("backupCodesEmpty")}</p>
            )}
            <form className="space-y-2" onSubmit={onRegenerate}>
              <Label htmlFor="regen-password">{t("regenerateDescription")}</Label>
              <div className="flex gap-2">
                <Input
                  id="regen-password"
                  type="password"
                  autoComplete="current-password"
                  value={regenPassword}
                  onChange={(event) => setRegenPassword(event.target.value)}
                />
                <Button type="submit" variant="outline" disabled={busy || !regenPassword}>
                  {busy ? t("regenerating") : t("regenerate")}
                </Button>
              </div>
            </form>
            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}
            <Button type="button" className="w-full" onClick={() => router.push(redirectTo)}>
              {t("finish")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
