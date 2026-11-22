"use client";

import { useEffect, useState } from "react";

interface HeaderFrameProps {
  brand: React.ReactNode;
  products: React.ReactNode;
  tools: React.ReactNode;
  menuLabel: string;
  productsLabel: string;
}

/**
 * Barra flotante de la cabecera. Solo observa el scroll y abre el menú móvil;
 * el contenido traducido se pasa como nodos desde el componente servidor.
 */
export function HeaderFrame({
  brand,
  products,
  tools,
  menuLabel,
  productsLabel,
}: HeaderFrameProps) {
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
      <div className="site-bar mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2">
        {brand}
        <button
          type="button"
          className="site-menu ms-auto inline-flex size-11 items-center justify-center rounded-full border border-bone/30 text-bone transition-colors duration-300 hover:bg-bone/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber lg:hidden"
          aria-label={menuLabel}
          aria-expanded={menuOpen}
          aria-controls="site-tools"
          data-open={menuOpen ? "true" : "false"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="site-menu-icon size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="4" y1="8" x2="20" y2="8" />
            <line x1="4" y1="16" x2="20" y2="16" />
          </svg>
        </button>
        <div
          id="site-tools"
          data-open={menuOpen ? "true" : "false"}
          className="site-tools flex w-full flex-col gap-3 border-t border-bone/15 pt-3 lg:w-auto lg:flex-1 lg:flex-row lg:items-center lg:justify-between lg:border-t-0 lg:pt-0"
        >
          <nav aria-label={productsLabel} className="site-products flex flex-wrap items-center gap-1">
            {products}
          </nav>
          <div className="flex flex-wrap items-center gap-2">{tools}</div>
        </div>
      </div>
    </header>
  );
}
