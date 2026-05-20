import type { ReactNode } from 'react';

// Lightweight section header for grouping content inside a page. Pairs with
// PageHeader at the top of the page; SectionHeader sits above each block of
// related cards/tables/charts so the page reads as scannable sections.

type SectionHeaderProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Right-side controls (filter chips, link to drilldown, etc.) */
  action?: ReactNode;
  /** Optional eyebrow text rendered above the title (e.g. role tag). */
  eyebrow?: string;
  className?: string;
};

export default function SectionHeader({
  title,
  description,
  icon,
  action,
  eyebrow,
  className,
}: SectionHeaderProps) {
  return (
    <div className={`mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className ?? ''}`}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--brand)]">
            {eyebrow}
          </p>
        )}
        <div className="flex min-w-0 items-center gap-2">
          {icon && <span className="text-[var(--text-muted)]">{icon}</span>}
          <h2 className="min-w-0 break-words text-base font-semibold tracking-tight text-[var(--foreground)]">
            {title}
          </h2>
        </div>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      {action && <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{action}</div>}
    </div>
  );
}
