"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Unico gesto de revelacion del buscador de la portada. Observa una sola vez,
 * se desconecta tras revelar y deja el panel en estado final con movimiento
 * reducido o sin IntersectionObserver.
 */
export function SearchReveal({ children }: { children: React.ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      return;
    }
    const node = container.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={container} className="search-reveal-observer">
      <div data-reveal={revealed ? "visible" : "pending"} className="search-reveal">
        {children}
      </div>
    </div>
  );
}
