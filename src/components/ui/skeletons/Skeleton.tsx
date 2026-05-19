'use client';

import type { CSSProperties } from 'react';

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}

/**
 * Base shimmer block. Uses theme tokens so it retunes in dark mode.
 * The shimmer respects prefers-reduced-motion (animation is dropped to a
 * static muted surface).
 */
export default function Skeleton({ className = '', style, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`skeleton-shimmer rounded-md bg-[var(--surface-3)] ${className}`}
      style={style}
      {...rest}
    />
  );
}
