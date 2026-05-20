'use client';

import Select from './Select';
import Button from './Button';
import { RotateCcw } from 'lucide-react';

interface FilterOption {
  value: string;
  label: string;
}

interface FilterDef {
  key: string;
  label: string;
  options: FilterOption[];
  placeholder?: string;
}

interface FilterBarProps {
  filters: FilterDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onReset: () => void;
}

export default function FilterBar({ filters, values, onChange, onReset }: FilterBarProps) {
  const hasActiveFilters = Object.values(values).some((v) => v !== '');

  return (
    <div className="flex w-full min-w-0 flex-wrap items-end gap-3">
      {filters.map((f) => (
        <div key={f.key} className="min-w-[9rem] flex-1 sm:w-44 sm:flex-none">
          <Select
            label={f.label}
            options={f.options}
            placeholder={f.placeholder || `All ${f.label}`}
            value={values[f.key] || ''}
            onChange={(e) => onChange(f.key, e.target.value)}
          />
        </div>
      ))}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>
      )}
    </div>
  );
}
