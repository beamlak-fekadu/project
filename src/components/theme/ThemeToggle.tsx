'use client';

import { Laptop, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui';
import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
  const { preference, resolvedTheme, setPreference, toggleTheme } = useTheme();
  const CurrentIcon = resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-10 w-10 rounded-lg sm:hidden"
        onClick={toggleTheme}
        aria-label={`Switch theme. Current theme: ${resolvedTheme}`}
      >
        <CurrentIcon className="h-4 w-4" />
      </Button>
      <div className="hidden items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-1 sm:inline-flex">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-8 w-8 rounded-lg ${preference === 'light' ? 'bg-[var(--surface-3)] text-[var(--foreground)]' : ''}`}
          onClick={() => setPreference('light')}
          aria-label="Switch to light mode"
        >
          <Sun className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-8 w-8 rounded-lg ${preference === 'dark' ? 'bg-[var(--surface-3)] text-[var(--foreground)]' : ''}`}
          onClick={() => setPreference('dark')}
          aria-label="Switch to dark mode"
        >
          <Moon className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-8 w-8 rounded-lg ${preference === 'system' ? 'bg-[var(--surface-3)] text-[var(--foreground)]' : ''}`}
          onClick={() => setPreference('system')}
          aria-label="Follow system theme"
        >
          <Laptop className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-1 hidden rounded-lg px-2 text-xs md:inline-flex"
          onClick={toggleTheme}
        >
          {resolvedTheme === 'dark' ? 'Dark' : 'Light'}
        </Button>
      </div>
    </>
  );
}
