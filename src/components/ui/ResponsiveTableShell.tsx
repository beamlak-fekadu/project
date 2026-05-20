import type { ReactNode } from 'react';

// Wraps a table (or any wide-content block) so it scrolls horizontally on
// mobile without pushing the whole page sideways. The shell also rounds the
// corners and adds the BMEDIS panel border so dropping a raw `<table>` inside
// still looks at home on the rest of the app.
//
// Use this anywhere a DataTable / Table is the primary content of a card.

type ResponsiveTableShellProps = {
  children: ReactNode;
  className?: string;
  /** Removes the surrounding panel chrome — for tables already inside a Card. */
  bare?: boolean;
  /** Optional caption above the scroll area, e.g. a count summary. */
  caption?: ReactNode;
};

export default function ResponsiveTableShell({
  children,
  className,
  bare = false,
  caption,
}: ResponsiveTableShellProps) {
  return (
    <div
      className={`${
        bare
          ? ''
          : 'panel-surface rounded-2xl border border-[var(--border-subtle)]'
      } min-w-0 max-w-full ${className ?? ''}`}
    >
      {caption && (
        <div className="border-b border-[var(--border-subtle)] px-4 py-2 text-xs text-[var(--text-muted)]">
          {caption}
        </div>
      )}
      <div className="max-w-full overflow-x-auto overscroll-x-contain">
        {/* Inner wrapper gets a min-width so columns don't collapse on mobile */}
        <div className="min-w-full">{children}</div>
      </div>
    </div>
  );
}
