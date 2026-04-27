'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  THEME_STORAGE_KEY,
  THEME_COOKIE_KEY,
  THEME_COOKIE_MAX_AGE_SECONDS,
  isThemePreference,
  resolveTheme,
  type ThemePreference,
  type ResolvedTheme,
} from './theme-contract';

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readCookiePreference(): ThemePreference | undefined {
  if (typeof document === 'undefined') return undefined;
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${THEME_COOKIE_KEY}=`));
  if (!cookie) return undefined;
  const value = decodeURIComponent(cookie.slice(THEME_COOKIE_KEY.length + 1));
  return isThemePreference(value) ? value : undefined;
}

function writeCookiePreference(preference: ThemePreference) {
  if (typeof document === 'undefined') return;
  document.cookie = `${THEME_COOKIE_KEY}=${encodeURIComponent(preference)}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

function readInitialPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const cookiePreference = readCookiePreference();
  if (cookiePreference) {
    localStorage.setItem(THEME_STORAGE_KEY, cookiePreference);
    return cookiePreference;
  }
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (isThemePreference(stored)) {
    writeCookiePreference(stored);
    return stored;
  }
  return 'system';
}

function applyThemeToDocument(resolvedTheme: ResolvedTheme) {
  if (typeof document === 'undefined') return 'dark';
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.classList.toggle('dark', resolvedTheme === 'dark');
  window.dispatchEvent(new CustomEvent('bmerms-theme-change', { detail: { resolvedTheme } }));
  return resolvedTheme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readInitialPreference());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const resolvedTheme = useMemo<ResolvedTheme>(
    () => resolveTheme(preference, systemPrefersDark),
    [preference, systemPrefersDark]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      setSystemPrefersDark(media.matches);
    };
    media.addEventListener('change', onSystemChange);
    return () => media.removeEventListener('change', onSystemChange);
  }, []);

  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
  }, [resolvedTheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, next);
      writeCookiePreference(next);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    setPreference(next);
  }, [resolvedTheme, setPreference]);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference, toggleTheme }),
    [preference, resolvedTheme, setPreference, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
