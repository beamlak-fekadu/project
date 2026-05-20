'use client';

import { useState, type ReactNode } from 'react';

interface Tab {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  activeTab?: string;
  onChange?: (tabId: string) => void;
}

export default function Tabs({ tabs, defaultTab, activeTab, onChange }: TabsProps) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.id);
  const currentActive = activeTab ?? active;

  const handleChange = (id: string) => {
    if (!activeTab) setActive(id);
    onChange?.(id);
  };

  const renderedActiveTab = tabs.find((t) => t.id === currentActive) ?? tabs[0];

  return (
    <div>
      <div className="border-b border-[var(--border-subtle)]">
        <nav className="-mb-px flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-px sm:gap-4" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={currentActive === tab.id}
              onClick={() => handleChange(tab.id)}
              className={`min-h-10 shrink-0 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                currentActive === tab.id
                  ? 'border-[var(--brand)] text-[var(--brand)]'
                  : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--foreground)]'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${currentActive === tab.id ? 'bg-[var(--brand-soft)] text-[var(--brand)]' : 'bg-[var(--surface-3)] text-[var(--text-muted)]'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
      <div className="pt-4">{renderedActiveTab?.content}</div>
    </div>
  );
}
