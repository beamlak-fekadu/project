'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type OnlineStatus = 'online' | 'offline' | 'checking' | 'unknown';

export type OnlineStatusState = {
  isOnline: boolean;
  status: OnlineStatus;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
};

const HEALTH_CHECK_PATH = '/offline-health.txt';
const MIN_HEALTH_CHECK_INTERVAL_MS = 30_000;

function nowIso() {
  return new Date().toISOString();
}

export function useOnlineStatus(options: { verifyOnline?: boolean } = {}): OnlineStatusState {
  const verifyOnline = options.verifyOnline ?? true;
  const lastCheckRef = useRef(0);
  const [state, setState] = useState<OnlineStatusState>(() => ({
    isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
    status: typeof navigator === 'undefined' ? 'unknown' : navigator.onLine ? 'online' : 'offline',
    lastOnlineAt: null,
    lastOfflineAt: null,
  }));

  const markOffline = useCallback(() => {
    setState((current) => ({
      ...current,
      isOnline: false,
      status: 'offline',
      lastOfflineAt: nowIso(),
    }));
  }, []);

  const markOnline = useCallback(() => {
    setState((current) => ({
      ...current,
      isOnline: true,
      status: 'online',
      lastOnlineAt: nowIso(),
    }));
  }, []);

  const verifyConnectivity = useCallback(async () => {
    if (typeof navigator === 'undefined') return;
    if (!navigator.onLine) {
      markOffline();
      return;
    }

    if (!verifyOnline) {
      markOnline();
      return;
    }

    const elapsed = Date.now() - lastCheckRef.current;
    if (elapsed < MIN_HEALTH_CHECK_INTERVAL_MS) {
      markOnline();
      return;
    }

    lastCheckRef.current = Date.now();
    setState((current) => ({ ...current, status: 'checking' }));

    try {
      const response = await fetch(HEALTH_CHECK_PATH, {
        method: 'HEAD',
        cache: 'no-store',
      });
      if (response.ok) markOnline();
      else markOffline();
    } catch {
      markOffline();
    }
  }, [markOffline, markOnline, verifyOnline]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      void verifyConnectivity();
    };
    const handleOffline = () => markOffline();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const timer = window.setTimeout(() => {
      void verifyConnectivity();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [markOffline, verifyConnectivity]);

  return state;
}
