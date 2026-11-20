import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "@caribe/shared";
import { describe, expect, it } from "vitest";
import {
  TodayRateBadgeContent,
  type TodayRateBadgeLabels,
} from "../src/components/today-rate-badge";
import {
  parseTodayRateView,
  UNAVAILABLE_RATE,
  type TodayRateView,
} from "../src/lib/today-rate";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

const labels: TodayRateBadgeLabels = {
  label: "Tasa BCV",
  unit: "Bs/$",
  unavailable: "Tasa no disponible",
  loading: "Tasa BCV…",
};

const AVAILABLE_RATE: TodayRateView = {
  available: true,
  rate: "36.0000",
  valueDate: "2026-11-10",
};

function renderBadge(view: TodayRateView | null, locale: Locale): string {
  return renderToStaticMarkup(createElement(TodayRateBadgeContent, { view, locale, labels }));
}

/** Contraste WCAG 2.1 de dos colores hexadecimales opacos. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function brandToken(name: string): string {
  const css = readFileSync(join(appRoot, "src/app/globals.css"), "utf8");
  const match = css.match(new RegExp(`--color-brand-${name}:\\s*(#[0-9a-f]{6})`, "i"));
  const color = match?.[1];
  if (!color) throw new Error(`Falta --color-brand-${name} en globals.css`);
  return color;
}

describe("TodayRateBadge", () => {
  it("muestra la tasa y la fecha valor con formato español", () => {
    const html = renderBadge(AVAILABLE_RATE, "es");
    expect(html).toContain(labels.label);
    expect(html).toContain("36,00");
    expect(html).toContain(labels.unit);
    expect(html).toContain("10/11/2026");
    expect(html).not.toContain(labels.unavailable);
  });

  it("usa el formato del locale en inglés", () => {
    const html = renderBadge(AVAILABLE_RATE, "en");
    expect(html).toContain("36.00");
    expect(html).toContain("11/10/2026");
  });

  it("sin tasa global muestra un estado discreto y anunciable", () => {
    const html = renderBadge(UNAVAILABLE_RATE, "es");
    expect(html).toContain(labels.unavailable);
    expect(html).not.toContain("36,00");
    expect(html).not.toContain("10/11/2026");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("es informativo: no añade controles que capturen foco", () => {
    for (const view of [AVAILABLE_RATE, UNAVAILABLE_RATE, null]) {
      const html = renderBadge(view, "es");
      expect(html).not.toContain("tabindex");
      expect(html).not.toContain("<button");
      expect(html).not.toContain("<input");
      expect(html).not.toContain("<a ");
    }
  });

  it("usa pares de texto y fondo con contraste WCAG AA", () => {
    const available = renderBadge(AVAILABLE_RATE, "es");
    expect(available).toContain("bg-brand-50");
    expect(available).toContain("text-brand-800");
    expect(contrast(brandToken("800"), brandToken("50"))).toBeGreaterThanOrEqual(4.5);

    // Tokens por defecto de Tailwind v4 para slate-100 / slate-700.
    const unavailable = renderBadge(UNAVAILABLE_RATE, "es");
    expect(unavailable).toContain("bg-slate-100");
    expect(unavailable).toContain("text-slate-700");
    expect(contrast("#334155", "#f1f5f9")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("parseTodayRateView", () => {
  it("acepta la respuesta pública con texto decimal y fecha valor", () => {
    expect(parseTodayRateView(AVAILABLE_RATE)).toEqual(AVAILABLE_RATE);
  });

  it("normaliza la respuesta sin tasa global", () => {
    expect(parseTodayRateView({ available: false, rate: null, valueDate: null })).toEqual(
      UNAVAILABLE_RATE,
    );
  });

  it("rechaza respuestas mal formadas en vez de mostrar un número inválido", () => {
    for (const payload of [
      null,
      [],
      { available: "true", rate: "36.0000", valueDate: "2026-11-10" },
      { available: true, rate: 36, valueDate: "2026-11-10" },
      { available: true, rate: "36,0000", valueDate: "2026-11-10" },
      { available: true, rate: "36.0000", valueDate: "10/11/2026" },
    ]) {
      expect(parseTodayRateView(payload)).toBeNull();
    }
  });
});
