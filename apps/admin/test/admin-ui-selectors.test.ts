import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contrato de los tres deseables de `admin-ui` que faltaban en T-F2-25:
 * selector de agencia en la cabecera, bandera de modo y persistencia del
 * idioma. Los componentes son de servidor/cliente de Next 16, así que se
 * comprueba el contrato sobre el código y los catálogos es/en.
 */
const appRoot = fileURLToPath(new URL("..", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

function messages(locale: "es" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

const header = read("src/components/site-header.tsx");
const selector = read("src/components/header-organization-selector.tsx");
const notice = read("src/components/payment-mode-notice.tsx");
const switcher = read("src/components/language-switcher.tsx");
const login = read("src/components/login-form.tsx");
const twoFactor = read("src/components/two-factor-form.tsx");
const payments = read("src/components/payments-panel.tsx");
const paymentsPage = read("src/app/[locale]/admin/payments/page.tsx");

describe('admin-ui › "Selector de agencia en la cabecera" (T-F2-25)', () => {
  it("ofrece solo las membresías de la sesión y descarta datos al cambiar", () => {
    expect(header).toContain("loadOrganizationChoice(request)");
    expect(header).toContain("<HeaderOrganizationSelector");
    expect(read("src/lib/panel-access.ts")).toContain("loadPanelAccess");
    expect(selector).toContain("organizations.map(");
    expect(selector).toContain("/api/auth/organization/set-active");
    expect(selector).toContain("window.location.reload()");
  });

  it("etiqueta el selector y localiza todos sus textos", () => {
    expect(selector).toContain('htmlFor="header-organization"');
    expect(selector).toContain('aria-label={t("label")}');
    for (const locale of ["es", "en"] as const) {
      const namespace = messages(locale)["organization"] as Record<string, unknown>;
      for (const key of ["label", "placeholder", "submit", "submitting", "selectError"]) {
        expect(namespace[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });
});

describe('admin-ui › "Bandera del modo de aprobación" (T-F2-25)', () => {
  it("muestra el modo de la API y un valor indeterminado como no disponible", () => {
    expect(header).toContain("<PaymentModeNotice");
    expect(header).toContain('choice.status === "fixed"');
    expect(notice).toContain('t("unavailable")');
    expect(notice).toContain('t(settings.paymentMode === "AUTO" ? "automatic" : "manual")');
    expect(paymentsPage).toContain("getTenantSettings(request)");
  });

  it("solo habilita revisiones en MANUAL y al rol autorizado", () => {
    expect(payments).toContain('paymentMode === "MANUAL"');
    expect(payments).toContain("canReviewPayment(access, row.reportedBy, userId)");
    expect(payments).toContain('t("modeUnavailable")');
    expect(payments).toContain('t("automaticOnly")');
    for (const locale of ["es", "en"] as const) {
      const namespace = messages(locale)["paymentMode"] as Record<string, unknown>;
      const panel = messages(locale)["payments"] as Record<string, unknown>;
      for (const key of ["automatic", "manual", "unavailable"]) {
        expect(namespace[key], `${locale}.paymentMode.${key}`).toBeTruthy();
      }
      for (const key of ["modeUnavailable", "automaticOnly"]) {
        expect(panel[key], `${locale}.payments.${key}`).toBeTruthy();
      }
    }
  });
});

describe('admin-ui › "Idioma persistido" (T-F2-25)', () => {
  it("guarda el perfil antes de cambiar la URL y no anuncia un fallo como éxito", () => {
    expect(switcher).toContain("await updateUserLocale(next)");
    expect(switcher).toContain("router.replace(pathname, { locale: next })");
    expect(switcher).toContain('t("localeError")');
    for (const locale of ["es", "en"] as const) {
      const namespace = messages(locale)["nav"] as Record<string, unknown>;
      expect(namespace["localeError"], `${locale}.nav.localeError`).toBeTruthy();
    }
  });

  it("aplica el perfil al volver a iniciar sesión, incluso con 2FA", () => {
    expect(login).toContain("getSession()");
    expect(login).toContain("preferredLocale(session?.user.locale)");
    expect(login).toContain("replacePathLocale(redirectTo");
    expect(twoFactor).toContain("destinationFor(redirectTo, session)");
    expect(twoFactor).toContain("preferredLocale(session?.user.locale)");
  });
});
