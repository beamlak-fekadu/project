'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Button from './Button';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  pageSize?: number;
}

export default function Pagination({ page, totalPages, onPageChange, totalItems, pageSize = 20 }: PaginationProps) {
  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems || page * pageSize);

  return (
    <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3">
      {totalItems !== undefined && (
        <p className="text-sm text-[var(--text-muted)]">
          Showing {start}–{end} of {totalItems}
        </p>
      )}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Go to previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
          let pageNum: number;
          if (totalPages <= 7) {
            pageNum = i + 1;
          } else if (page <= 4) {
            pageNum = i + 1;
          } else if (page >= totalPages - 3) {
            pageNum = totalPages - 6 + i;
          } else {
            pageNum = page - 3 + i;
          }
          return (
            <Button
              key={pageNum}
              variant={page === pageNum ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => onPageChange(pageNum)}
              aria-label={`Go to page ${pageNum}`}
              aria-current={page === pageNum ? 'page' : undefined}
            >
              {pageNum}
            </Button>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Go to next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
