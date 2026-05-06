'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
}

export default function SearchInput({ value: externalValue, onChange, placeholder = 'Search...', debounceMs = 300 }: SearchInputProps) {
  const [local, setLocal] = useState(externalValue || '');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isControlled = externalValue !== undefined;
  const displayValue = isControlled ? externalValue : local;

  const debouncedChange = useCallback((val: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => onChange(val), debounceMs);
  }, [onChange, debounceMs]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleChange = (val: string) => {
    if (!isControlled) {
      setLocal(val);
    }
    debouncedChange(val);
  };

  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
      <input
        type="text"
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] py-2 pl-10 pr-8 text-sm text-[var(--foreground)] shadow-sm transition-colors placeholder:text-[var(--text-muted)] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {displayValue && (
        <button onClick={() => handleChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--foreground)]">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
