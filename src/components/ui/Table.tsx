'use client';

import { type ReactNode } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (row: T) => ReactNode;
  className?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField?: string;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  loading?: boolean;
}

export default function Table<T extends Record<string, unknown> = Record<string, unknown>>({
  columns, data, keyField = 'id', sortKey, sortDir, onSort, onRowClick, emptyMessage = 'No records available for the selected filters', loading,
}: TableProps<T>) {
  return (
    <div className="panel-surface-muted overflow-x-auto rounded-2xl">
      <table className="min-w-full divide-y divide-[var(--border-subtle)]">
        <thead className="bg-[var(--surface-3)]/60">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] ${col.sortable ? 'cursor-pointer select-none hover:text-[var(--foreground)]' : ''} ${col.className || ''}`}
                onClick={() => col.sortable && onSort?.(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === col.key && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-subtle)] bg-transparent">
          {loading ? (
            <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Loading records...</td></tr>
          ) : data.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">{emptyMessage}</td></tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={(row[keyField] as string) ?? i}
                className={`transition-colors hover:bg-[var(--surface-3)]/40 ${onRowClick ? 'cursor-pointer' : ''}`}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`whitespace-nowrap px-4 py-3 text-sm text-[var(--foreground)] ${col.className || ''}`}>
                    {col.render ? col.render(row) : (row[col.key] as ReactNode) ?? '—'}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
