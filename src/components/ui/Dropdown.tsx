'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';

interface DropdownItem {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  destructive?: boolean;
}

interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
}

export default function Dropdown({ trigger, items, align = 'right' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div className={`absolute z-50 mt-1 min-w-[180px] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] py-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { item.onClick(); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-2)] ${
                item.destructive ? 'text-red-600 dark:text-red-400' : 'text-[var(--foreground)]'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
