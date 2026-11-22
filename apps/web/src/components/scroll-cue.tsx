"use client";

import { useEffect, useRef, useState } from "react";

interface ScrollCueProps {
  targetId: string;
  label: string;
  /** Color del gesto según la sección que lo contiene. */
  tone?: "on-dark" | "on-light";
}

/**
 * Gesto de bajada siempre dentro del viewport. Al pulsarlo, el control baja de
 * forma gradual y vuelve a subir, sin escalas ni impactos, para acompañar el
 * desplazamiento suave hacia la sección (o el salto inmediato con movimiento
 * reducido).
 */
export function ScrollCue({ targetId, label, tone = "on-dark" }: ScrollCueProps) {
  const sentinel = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
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
    },
    [],
  );

  function markPressed() {
    setPressed(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPressed(false), 620);
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
        onClick={markPressed}
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
