"use client";

import { useEffect, useState } from "react";

interface HeaderFrameProps {
  brand: React.ReactNode;
  tools: React.ReactNode;
  menuLabel: string;
}

/**
 * Marina de la cabecera. Solo observa el scroll y abre el menu movil; el
 * contenido traducido se pasa como nodos desde el componente servidor.
 */
export function HeaderFrame({ brand, tools, menuLabel }: HeaderFrameProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrolled(window.scrollY > 24);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header className="site-header" data-scrolled={scrolled ? "true" : "false"}>
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3">
        {brand}
        <div
          id="site-tools"
          data-open={menuOpen ? "true" : "false"}
          className="site-tools flex w-full items-center justify-end gap-2 md:w-auto"
        >
          {tools}
        </div>
        <button
          type="button"
          className="h-11 rounded-md border border-bone/30 px-3 text-sm font-medium text-bone md:hidden"
          aria-expanded={menuOpen}
          aria-controls="site-tools"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuLabel}
        </button>
      </div>
    </header>
  );
}
