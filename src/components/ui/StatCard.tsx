'use client';

import { type ReactNode } from 'react';
import AnimatedMetric from './AnimatedMetric';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  trend?: { value: number; label: string };
  color?: string;
  onClick?: () => void;
  active?: boolean;
  sublabel?: string;
  ariaLabel?: string;
}

/**
 * Compact stat tile for KPI strips.
 *
 * Adopts the glass surface from globals.css automatically — the only visible
 * theme work here is choosing the icon tint and the active ring.
 */
export default function StatCard({
  label,
  value,
  icon,
  trend,
  color = 'blue',
  onClick,
  active = false,
  sublabel,
  ariaLabel,
}: StatCardProps) {
  // Token-driven colors so the tints retune cleanly in dark mode.
  const colorMap: Record<string, string> = {
    blue:   'bg-[var(--brand-soft)] text-[var(--brand)]',
    green:  'bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--success)]',
    red:    'bg-[color-mix(in_oklab,var(--danger)_18%,transparent)]  text-[var(--danger)]',
    yellow: 'bg-[color-mix(in_oklab,var(--warning)_18%,transparent)] text-[var(--warning)]',
    purple: 'bg-[color-mix(in_oklab,#7c3aed_18%,transparent)] text-[color-mix(in_oklab,#7c3aed_80%,white)]',
    orange: 'bg-[color-mix(in_oklab,#f97316_18%,transparent)] text-[#f97316]',
    gray:   'bg-[var(--surface-3)] text-[var(--text-muted)]',
  };

  const pressable = Boolean(onClick);

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            {label}
          </p>
          <p className="mt-1.5 text-[28px] font-semibold leading-none tracking-tight text-[var(--foreground)] tabular-nums">
            {typeof value === 'number' ? <AnimatedMetric value={value} /> : value}
          </p>
          {sublabel && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">{sublabel}</p>
          )}
          {trend && (
            <p
              className={`mt-1.5 text-xs font-medium tabular-nums ${
                trend.value >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'
              }`}
            >
              {trend.value >= 0 ? '+' : ''}
              {trend.value}% {trend.label}
            </p>
          )}
        </div>
        <div className={`rounded-lg p-2.5 ${colorMap[color] || colorMap.blue}`}>{icon}</div>
      </div>
    </>
  );

  if (pressable) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={ariaLabel ?? `${label}: ${value}`}
        className={`panel-surface filter-card-pressable min-w-0 text-left rounded-2xl p-4 sm:p-5 w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-0 ${
          active ? 'filter-card-active' : ''
        }`}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`panel-surface min-w-0 rounded-2xl p-4 sm:p-5 ${active ? 'filter-card-active' : ''}`}
    >
      {content}
    </div>
  );
}
