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
      <div className="border-b border-gray-200 dark:border-gray-800">
        <nav className="-mb-px flex gap-4 overflow-x-auto" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={currentActive === tab.id}
              onClick={() => handleChange(tab.id)}
              className={`whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                currentActive === tab.id
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${currentActive === tab.id ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30' : 'bg-gray-100 text-gray-600 dark:bg-gray-800'}`}>
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
