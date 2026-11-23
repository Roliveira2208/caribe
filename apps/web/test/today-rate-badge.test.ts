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
  label: "BCV",
  unavailable: "Tasa no disponible",
  loading: "BCV…",
};

const enLabels: TodayRateBadgeLabels = {
  label: "BCV",
  unavailable: "Rate unavailable",
  loading: "BCV…",
};

const AVAILABLE_RATE: TodayRateView = {
  available: true,
  rate: "36.0000",
  valueDate: "2026-11-10",
};

function renderBadge(
  view: TodayRateView | null,
  locale: Locale,
  badgeLabels: TodayRateBadgeLabels = labels,
): string {
  return renderToStaticMarkup(
    createElement(TodayRateBadgeContent, { view, locale, labels: badgeLabels }),
  );
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
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"));
  const color = match?.[1];
  if (!color) throw new Error(`Falta --color-${name} en globals.css`);
  return color;
}

describe("TodayRateBadge", () => {
  it("muestra solo BCV y el monto en espanol", () => {
    const html = renderBadge(AVAILABLE_RATE, "es");
    expect(html).toContain("BCV 36,00");
    expect(html).not.toContain("Bs/$");
    expect(html).not.toContain("del");
    expect(html).not.toContain("10 nov");
    expect(html).not.toContain("·");
    expect(html).not.toContain(labels.unavailable);
  });

  it("usa el formato del locale en ingles sin fecha valor", () => {
    const html = renderBadge(AVAILABLE_RATE, "en", enLabels);
    expect(html).toContain("BCV 36.00");
    expect(html).not.toContain("VES/USD");
    expect(html).not.toContain("Nov 10");
    expect(html).not.toContain(" on ");
    expect(html).not.toContain("·");
  });

  it("sin tasa global muestra un estado discreto y anunciable", () => {
    const html = renderBadge(UNAVAILABLE_RATE, "es");
    expect(html).toContain(labels.unavailable);
    expect(html).not.toContain("36,00");
    expect(html).not.toContain("10 nov");
    expect(html).not.toContain("Bs/$");
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
    expect(available).toContain("bg-ink/70");
    expect(available).toContain("text-amber");
    expect(contrast(brandToken("amber"), brandToken("ink"))).toBeGreaterThanOrEqual(4.5);

    const unavailable = renderBadge(UNAVAILABLE_RATE, "es");
    expect(unavailable).toContain("bg-ink/70");
    expect(unavailable).toContain("text-bone");
    expect(contrast(brandToken("bone"), brandToken("ink"))).toBeGreaterThanOrEqual(4.5);
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
