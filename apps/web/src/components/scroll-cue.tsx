"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

interface ScrollCueProps {
  targetId: string;
  label: string;
  /** Color del gesto según la sección que lo contiene. */
  tone?: "on-dark" | "on-light";
}

const SCROLL_DURATION_MS = 760;
const PRESS_DURATION_MS = 620;

/** Curva ease-in-out cúbica: arranca y termina suave, sin golpe en los extremos. */
function easeInOutCubic(progress: number): number {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

/** Destino teniendo en cuenta la cabecera flotante que puede tapar el encabezado. */
function destinationTop(id: string): number | null {
  const node = document.getElementById(id);
  if (!node) return null;
  const margin = Number.parseFloat(window.getComputedStyle(node).scrollMarginTop);
  const offset = Number.isFinite(margin) ? margin : 0;
  return Math.max(0, node.getBoundingClientRect().top + window.scrollY - offset);
}

/**
 * Gesto de bajada siempre dentro del viewport. Intercepta el ancla para animar
 * el desplazamiento fotograma a fotograma: `scroll-behavior: smooth` depende del
 * navegador y Next puede anularlo durante una transición de ruta, mientras que
 * aquí la curva y la duración están bajo nuestro control.
 */
export function ScrollCue({ targetId, label, tone = "on-dark" }: ScrollCueProps) {
  const sentinel = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const removeListeners = useRef<Array<() => void>>([]);
  const [visible, setVisible] = useState(true);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "0px 0px -55% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      removeListeners.current.forEach((remove) => remove());
    },
    [],
  );

  function stopScroll() {
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    removeListeners.current.forEach((remove) => remove());
    removeListeners.current = [];
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    setPressed(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPressed(false), PRESS_DURATION_MS);

    // Modificadores y clic no principal conservan el comportamiento nativo.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    stopScroll();

    const destination = destinationTop(targetId);
    if (destination === null) return;
    const top: number = destination;
    window.history.pushState(null, "", `#${targetId}`);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.scrollTo({ top, behavior: "instant" });
      return;
    }

    const start = window.scrollY;
    if (Math.abs(top - start) < 2) return;
    const startedAt = performance.now();

    const cancelOnInput = () => stopScroll();
    for (const name of ["wheel", "touchstart", "keydown"] as const) {
      window.addEventListener(name, cancelOnInput, { passive: true });
      removeListeners.current.push(() => window.removeEventListener(name, cancelOnInput));
    }

    function step(now: number) {
      const progress = Math.min(1, (now - startedAt) / SCROLL_DURATION_MS);
      window.scrollTo({
        top: start + (top - start) * easeInOutCubic(progress),
        behavior: "instant",
      });
      if (progress < 1) {
        frame.current = window.requestAnimationFrame(step);
      } else {
        frame.current = null;
        removeListeners.current.forEach((remove) => remove());
        removeListeners.current = [];
      }
    }
    frame.current = window.requestAnimationFrame(step);
  }

  const colors =
    tone === "on-dark" ? "text-bone hover:bg-bone/10" : "text-ink hover:bg-ink/10";

  return (
    <>
      <span ref={sentinel} aria-hidden="true" className="pointer-events-none absolute inset-0" />
      <a
        href={`#${targetId}`}
        aria-label={label}
        data-visible={visible}
        data-pressed={pressed}
        onClick={handleClick}
        className={`scroll-cue inline-flex size-12 min-h-11 min-w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ${colors}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="scroll-cue-icon size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </a>
    </>
  );
}
