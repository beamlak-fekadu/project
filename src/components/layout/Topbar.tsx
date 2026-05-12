'use client';

import { Bell, LogOut, Menu, Search, User } from 'lucide-react';
import { APP_NAME_SHORT, HOSPITAL_NAME } from '@/constants';
import Button from '@/components/ui/Button';
import Dropdown from '@/components/ui/Dropdown';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

interface TopbarProps {
  userName?: string;
  userRole?: string;
  alertCount?: number;
  onMenuToggle?: () => void;
  onLogout?: () => void;
}

export default function Topbar({
  userName = 'User',
  userRole = '',
  alertCount = 0,
  onMenuToggle,
  onLogout,
}: TopbarProps) {
  return (
    <header className="panel-surface-muted flex h-16 items-center justify-between border-b border-[var(--border-subtle)] px-4 lg:px-6">
      <div className="flex items-center gap-3">
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-1)] lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-subtle)]">
            {HOSPITAL_NAME}
          </p>
          <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
            {APP_NAME_SHORT}
          </h2>
        </div>
      </div>

      <div className="hidden min-w-[260px] items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-muted)] backdrop-blur md:flex lg:min-w-[360px]">
        <Search className="h-4 w-4" />
        <span>Search equipment, requests, work orders...</span>
        <span className="ml-auto rounded border border-[var(--border-subtle)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-subtle)]">
          ⌘K
        </span>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5 text-[var(--text-muted)]" />
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--danger)] text-[10px] font-bold text-white">
              {alertCount > 9 ? '9+' : alertCount}
            </span>
          )}
        </Button>

        <Dropdown
          trigger={
            <button className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--surface-1)]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full text-white" style={{ background: 'var(--brand-gradient)' }}>
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
