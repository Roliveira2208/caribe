/**
 * Composicion cinetica del hero: bandas desfasadas y ritmo modular dibujados
 * con SVG local. No hay imagenes externas ni texto, por eso es aria-hidden.
 */
export function KineticComposition() {
  const tiles = Array.from({ length: 9 }, (_, index) => ({
    x: 130 + index * 52,
    y: 96 + index * 34,
    size: 10 + (index % 3) * 6,
  }));

  return (
    <div
      aria-hidden="true"
      className="hero-composition relative h-40 w-full overflow-hidden lg:h-[520px]"
      role="presentation"
    >
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 600 520"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          <clipPath id="cinetica-corte">
            <path d="M110 0 H600 V400 L265 520 H0 V140 Z" />
          </clipPath>
        </defs>
        <g clipPath="url(#cinetica-corte)">
          <rect width="600" height="520" fill="var(--color-teal)" />
          <path d="M-40 342 L640 118 V272 L-40 496 Z" fill="var(--color-amber)" />
          <path d="M-40 404 L640 180 V214 L-40 438 Z" fill="var(--color-bone)" />
          <path d="M-40 462 L640 238 V262 L-40 486 Z" fill="var(--color-ink)" />
          {tiles.map((tile) => (
            <rect
              key={`${tile.x}-${tile.y}`}
              x={tile.x}
              y={tile.y}
              width={tile.size}
              height={tile.size}
              fill={tile.size > 16 ? "var(--color-ink)" : "var(--color-bone)"}
              opacity="0.85"
            />
          ))}
        </g>
        <path d="M64 56 V464" stroke="var(--color-amber)" strokeWidth="4" />
        <path d="M64 464 H520" stroke="var(--color-bone)" strokeOpacity="0.45" strokeWidth="2" />
        <path d="M330 30 L560 240" stroke="var(--color-bone)" strokeOpacity="0.28" strokeWidth="2" />
      </svg>
    </div>
  );
}
