'use client';

import { useState, useMemo, type ReactNode } from 'react';
import Table from './Table';
import SearchInput from './SearchInput';
import Pagination from './Pagination';

interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  searchable?: boolean;
  render?: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField?: string;
  pageSize?: number;
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  actions?: ReactNode;
  loading?: boolean;
  emptyMessage?: string;
  filters?: ReactNode;
}

export default function DataTable<T extends Record<string, unknown> = Record<string, unknown>>({
  columns, data, keyField = 'id', pageSize = 20, searchPlaceholder, onRowClick, actions, loading, emptyMessage, filters,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const searchableKeys = columns.filter((c) => c.searchable !== false).map((c) => c.key);

  const filtered = useMemo(() => {
    if (!search) return data;
    const lower = search.toLowerCase();
    return data.filter((row) =>
      searchableKeys.some((key) => {
        const val = row[key];
        return val != null && String(val).toLowerCase().includes(lower);
      })
    );
  }, [data, search, searchableKeys]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div className="min-w-0">
      <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={searchPlaceholder} />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {filters}
          {actions}
        </div>
      </div>
      <Table
        columns={columns}
        data={paged}
        keyField={keyField}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        onRowClick={onRowClick}
        loading={loading}
        emptyMessage={emptyMessage}
      />
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalItems={sorted.length} pageSize={pageSize} />
    </div>
  );
}
