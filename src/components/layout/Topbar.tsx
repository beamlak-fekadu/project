'use client';

import { motion } from 'framer-motion';
import { LogOut, Menu, Search, User } from 'lucide-react';
import { APP_NAME_SHORT, HOSPITAL_NAME } from '@/constants';
import Dropdown from '@/components/ui/Dropdown';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { AssistantLauncher } from '@/components/assistant/AssistantLauncher';
import { formatRoleName } from '@/utils/roles';
import SyncStatusIndicator from '@/components/offline/SyncStatusIndicator';
import NotificationBell from '@/components/notifications/NotificationBell';
import { transitions } from '@/lib/ui/motion-presets';

interface TopbarProps {
  userName?: string;
  userRole?: string;
  userJobTitle?: string | null;
  userRoles?: string[];
  onMenuToggle?: () => void;
  onLogout?: () => void;
}

export default function Topbar({
  userName = 'User',
  userRole = '',
  userJobTitle,
  userRoles = [],
  onMenuToggle,
  onLogout,
}: TopbarProps) {
  // Top-right secondary line shows the user's job title (e.g. "Radiologist",
  // "ICU Head", "Clinical Engineer"). Job titles are FREE TEXT in
  // profiles.job_title and are display-only — they do not control
  // authorization. If a profile has no job_title we fall back to the
  // formatted database role (e.g. "BME Head") so raw lowercase role names
  // like "bme_head" never appear in the Topbar.
  const subtitle = userJobTitle?.trim() ? userJobTitle : formatRoleName(userRole);
  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transitions.default}
      className="panel-surface-muted flex h-16 min-w-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 sm:px-4 lg:gap-3 lg:px-6">
      <div className="flex min-w-0 shrink items-center gap-2 sm:gap-3">
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            aria-label="Open navigation menu"
            className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-1)] lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0">
          <p className="truncate text-[10px] uppercase tracking-[0.12em] text-[var(--text-subtle)]">
            {HOSPITAL_NAME}
          </p>
          <h2 className="truncate text-sm font-semibold tracking-tight text-[var(--foreground)]">
            {APP_NAME_SHORT}
          </h2>
        </div>
      </div>

      {/* Search bar — capped width, shrinks gracefully on tablet, icon-only on mobile.
          The desktop tile keeps the ⌘K hint but never dominates the topbar. */}
      <button
        type="button"
        aria-label="Search equipment, requests, work orders"
        className="ml-auto hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--foreground)] sm:flex md:hidden"
      >
        <Search className="h-4 w-4" />
      </button>
      <div className="ml-auto hidden min-w-0 max-w-[280px] flex-1 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-muted)] backdrop-blur md:flex lg:max-w-[360px] xl:max-w-[420px]">
        <Search className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          <span className="hidden lg:inline">Search equipment, requests, work orders…</span>
          <span className="lg:hidden">Search…</span>
        </span>
        <span className="ml-auto hidden shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-subtle)] lg:inline">
          ⌘K
        </span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2 md:ml-2">
        <SyncStatusIndicator userRoles={userRoles} />
        <AssistantLauncher />
        <ThemeToggle />
        <NotificationBell />

        <Dropdown
          trigger={
            <button
              aria-label={`Account: ${userName}`}
              className="flex max-w-[40vw] items-center gap-2 rounded-lg px-2 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--surface-1)] sm:max-w-none sm:px-3"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white" style={{ background: 'var(--brand-gradient)' }}>
                <User className="h-4 w-4" />
              </div>
              <div className="hidden min-w-0 text-left md:block">
                <p className="truncate font-medium">{userName}</p>
                <p className="truncate text-xs text-[var(--text-muted)]">{subtitle}</p>
              </div>
            </button>
          }
          items={[
            { label: 'Sign Out', onClick: () => onLogout?.(), icon: <LogOut className="h-4 w-4" />, destructive: true },
          ]}
        />
      </div>
    </motion.header>
  );
}
