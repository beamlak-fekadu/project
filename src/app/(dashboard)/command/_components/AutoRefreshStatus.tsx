'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity } from 'lucide-react';

const REFRESH_INTERVAL_MS = 10_000;

export function AutoRefreshStatus() {
  const router = useRouter();
  const [secondsAgo, setSecondsAgo] = useState(0);
  const lastRefreshRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    lastRefreshRef.current = Date.now();
    function tick() {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      const elapsed = now - (lastRefreshRef.current ?? now);
      setSecondsAgo(Math.floor(elapsed / 1000));
      if (elapsed >= REFRESH_INTERVAL_MS) {
        lastRefreshRef.current = Date.now();
        setSecondsAgo(0);
        router.refresh();
      }
    }

    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [router]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
      <Activity className="h-3 w-3 animate-pulse text-emerald-400" aria-hidden />
      {secondsAgo === 0 ? 'Just updated' : `Updated ${secondsAgo}s ago`}
      <span className="text-[var(--text-muted)]/60">· Auto-refresh every 10s</span>
    </span>
  );
}
