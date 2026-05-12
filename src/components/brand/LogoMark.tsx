'use client';

import { useId } from 'react';

interface LogoMarkProps {
  /** Pixel size; rendered at 64×64 viewBox. Defaults to 28. */
  size?: number;
  /** Pass a CSS color (e.g. "#fff", "currentColor") to render flat single-color. Omit for the brand gradient. */
  mono?: string;
  /** Override the gradient stop colors. Defaults to the brand → violet pair. */
  c1?: string;
  c2?: string;
  /** Accessible label. */
  title?: string;
  className?: string;
}

/**
 * BMERMS Stacked logomark.
 *
 * Three concentric-offset rounded squares — bottom, middle, top — with a soft
 * gradient on the top layer and a glass highlight that gives the mark depth
 * without breaking at 16px favicon scale (the bottom layer is auto-dropped
 * below 18px so the silhouette stays legible).
 *
 * Pass `mono="currentColor"` (or a specific color) to render in a single tone —
 * useful for monochrome contexts, print, or letting the surrounding text color
 * drive the mark.
 */
export default function LogoMark({
  size = 28,
  mono,
  c1 = '#2563eb',
  c2 = '#7c3aed',
  title = 'BMERMS',
  className,
}: LogoMarkProps) {
  const rawId = useId();
  const id = rawId.replace(/:/g, '');
  const gradId = `lm-grad-${id}`;
  const highlightId = `lm-hi-${id}`;

  const isMono = !!mono;
  const tiny = size <= 18;
  const topFill = isMono ? mono : `url(#${gradId})`;
  const layerFill = isMono ? mono : '#2563eb';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c1} />
          <stop offset="100%" stopColor={c2} />
        </linearGradient>
        <linearGradient id={highlightId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
          <stop offset="40%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      {/* Bottom layer (dropped below 18px) */}
      {!tiny && (
        <rect
          x="8"
          y="20"
          width="36"
          height="36"
          rx="10"
          fill={layerFill}
          opacity={isMono ? 0.22 : 0.28}
        />
      )}

      {/* Middle layer */}
      <rect
        x="14"
        y="14"
        width="36"
        height="36"
        rx="10"
        fill={layerFill}
        opacity={isMono ? 0.52 : 0.55}
      />

      {/* Top layer — gradient + glass highlight */}
      <rect x="20" y="8" width="36" height="36" rx="10" fill={topFill} />
      {!isMono && (
        <rect
          x="20"
          y="8"
          width="36"
          height="36"
          rx="10"
          fill={`url(#${highlightId})`}
          style={{ mixBlendMode: 'overlay' }}
        />
      )}

      {/* Subtle inner stroke for definition on any background */}
      <rect
        x="20.5"
        y="8.5"
        width="35"
        height="35"
        rx="9.5"
        fill="none"
        stroke="rgba(255,255,255,0.30)"
        strokeWidth="1"
      />
    </svg>
  );
}

/** Mark + wordmark, kerned and vertically centered. */
export function LogoLockup({
  size = 28,
  mono,
  name = 'BMERMS',
  color,
  gap = 10,
  className,
}: {
  size?: number;
  mono?: string;
  name?: string;
  color?: string;
  gap?: number;
  className?: string;
}) {
  const fontSize = Math.round(size * 0.62);
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      <LogoMark size={size} mono={mono} />
      <span
        style={{
          fontSize,
          fontWeight: 600,
          letterSpacing: -0.6,
          color: color || 'currentColor',
          lineHeight: 1,
        }}
      >
        {name}
      </span>
    </span>
  );
}
