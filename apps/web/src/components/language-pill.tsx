import type { Locale } from "@caribe/shared";

interface LanguagePillProps {
  locale: Locale;
  labels: Record<Locale, string>;
  ariaLabel: string;
  onSelect?: (locale: Locale) => void;
}

const OPTIONS: readonly Locale[] = ["es", "en"];

/**
 * Píldora de dos idiomas sin banderas. Sin hooks para poder renderizarla también
 * en pruebas estáticas; el estado y la navegación viven en `LanguageSwitcher`.
 */
export function LanguagePill({ locale, labels, ariaLabel, onSelect }: LanguagePillProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex h-10 items-center gap-1 rounded-full border border-bone/30 bg-ink/40 p-1"
    >
      {OPTIONS.map((option) => {
        const selected = option === locale;
        return (
          <button
            key={option}
            type="button"
            aria-current={selected ? "true" : undefined}
            onClick={() => onSelect?.(option)}
            className={`inline-flex min-h-8 min-w-11 items-center justify-center rounded-full px-2.5 text-sm font-semibold transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ${
              selected ? "bg-bone text-ink" : "text-bone hover:bg-bone/10"
            }`}
          >
            {labels[option]}
          </button>
        );
      })}
    </div>
  );
}
