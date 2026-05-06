'use client';

import { Bell, Bot, LogOut, Menu, Search, User } from 'lucide-react';
import { APP_NAME_SHORT, ASSISTANT_NAME, HOSPITAL_NAME } from '@/constants';
import Button from '@/components/ui/Button';
import Dropdown from '@/components/ui/Dropdown';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useAssistantContext } from '@/components/assistant/AssistantProvider';

interface TopbarProps {
  userName?: string;
  userRole?: string;
  alertCount?: number;
  onMenuToggle?: () => void;
  onLogout?: () => void;
}

export default function Topbar({ userName = 'User', userRole = '', alertCount = 0, onMenuToggle, onLogout }: TopbarProps) {
  const { isOpen, openAssistant } = useAssistantContext();

  return (
    <header className="panel-surface-muted flex h-16 items-center justify-between border-b px-4 lg:px-6">
      <div className="min-w-0 flex items-center gap-3">
        {onMenuToggle && (
          <button
            type="button"
            onClick={onMenuToggle}
            className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-2)] lg:hidden"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-[var(--foreground)]">{APP_NAME_SHORT}</h2>
          <p className="hidden truncate text-xs text-[var(--text-muted)] sm:block">{HOSPITAL_NAME}</p>
        </div>
      </div>

      <div className="hidden min-w-[260px] items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-muted)] md:flex lg:min-w-[360px]">
        <Search className="h-4 w-4" />
        <span>Search equipment, requests, work orders...</span>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        {!isOpen && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="hidden rounded-lg px-3 xl:inline-flex"
            onClick={() => openAssistant()}
            aria-label={`Open ${ASSISTANT_NAME}`}
          >
            <Bot className="h-4 w-4 text-[var(--assistant-accent)]" />
            Ask Assistant
          </Button>
        )}
        {!isOpen && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="xl:hidden"
            onClick={() => openAssistant()}
            aria-label={`Open ${ASSISTANT_NAME}`}
          >
            <Bot className="h-5 w-5 text-[var(--assistant-accent)]" />
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon" className="relative" aria-label="View alerts">
          <Bell className="h-5 w-5 text-[var(--text-muted)]" />
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {alertCount > 9 ? '9+' : alertCount}
            </span>
          )}
        </Button>

        <Dropdown
          trigger={
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--surface-2)]"
              aria-label="Open user account menu"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand)]/20 text-[var(--brand)]">
                <User className="h-4 w-4" />
              </div>
              <div className="hidden text-left md:block">
                <p className="font-medium">{userName}</p>
                <p className="text-xs text-[var(--text-muted)]">{userRole}</p>
              </div>
            </button>
          }
          items={[
            { label: 'Sign Out', onClick: () => onLogout?.(), icon: <LogOut className="h-4 w-4" />, destructive: true },
          ]}
        />
      </div>
    </header>
  );
}
