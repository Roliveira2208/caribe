"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import type { Locale } from "@caribe/shared";
import { languageSwitchHref, type LanguageRouteParams } from "@/lib/language-view";

const LANGUAGE_OPTIONS = [
  { locale: "es", labelKey: "spanish", flag: "/images/flags/ve.svg" },
  { locale: "en", labelKey: "english", flag: "/images/flags/us.svg" },
] as const;

const LIST_ID = "language-options";

/**
 * Selector de idioma desplegable con banderas locales. Conserva la ruta fija y
 * sus parámetros; el cambio navega con el router estándar para no duplicar el
 * prefijo que ya devuelve `languageSwitchHref`.
 */
export function LanguageSwitcher() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const params = useParams<LanguageRouteParams>();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const active =
    LANGUAGE_OPTIONS.find((option) => option.locale === locale) ?? LANGUAGE_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function choose(next: Locale): void {
    setOpen(false);
    trigger.current?.focus();
    if (next !== locale) router.replace(languageSwitchHref(next, pathname, params));
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    if (event.key === "Escape") {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const current = options.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = options[(current + step + options.length) % options.length];
    next?.focus();
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={t("language")}
        aria-expanded={open}
        aria-controls={LIST_ID}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex h-10 items-center gap-2 rounded-full border border-bone/30 bg-ink/40 px-3 text-sm text-bone transition-colors duration-300 hover:bg-bone/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
      >
        <img src={active.flag} alt="" aria-hidden="true" className="size-5 rounded-full object-cover" />
        <span>{t(active.labelKey)}</span>
        <svg aria-hidden="true" viewBox="0 0 12 8" className="size-2.5 fill-current">
          <path d="M6 8 0 0h12z" />
        </svg>
      </button>

      {open ? (
        <ul
          ref={list}
          id={LIST_ID}
          role="listbox"
          aria-label={t("language")}
          onKeyDown={onListKeyDown}
          className="absolute end-0 top-full z-50 mt-2 w-44 rounded-xl border border-bone/20 bg-ink p-1 shadow-brand"
        >
          {LANGUAGE_OPTIONS.map((option) => {
            const selected = option.locale === locale;
            return (
              <li key={option.locale} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-current={selected ? "true" : undefined}
                  tabIndex={-1}
                  onClick={() => choose(option.locale)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ${
                    selected ? "bg-bone font-semibold text-ink" : "text-bone hover:bg-bone/10"
                  }`}
                >
                  <img src={option.flag} alt="" aria-hidden="true" className="size-5 rounded-full object-cover" />
                  <span>{t(option.labelKey)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
