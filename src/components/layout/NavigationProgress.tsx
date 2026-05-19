'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Subtle top-of-page progress bar that pulses while a Next.js route
 * navigation is in flight. There's no first-class App-Router event for
 * pending navigation, so we approximate:
 *
 * 1. Listen for clicks on any same-origin `<a>` that isn't a download or
 *    new-tab navigation — flip the bar on.
 * 2. When `usePathname()` / `useSearchParams()` change, flip the bar off
 *    on the next tick. If a navigation never lands (clicked link that the
 *    browser cancels) we still clear after a short safety timeout.
 *
 * No third-party progress library; honors `prefers-reduced-motion` via
 * the CSS keyframes.
 */
export default function NavigationProgress() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPathnameRef = useRef(pathname);

  // Clear pending on the next tick when the route actually changes. Using a
  // microtask (queueMicrotask) keeps us off the synchronous render path so
  // `react-hooks/set-state-in-effect` stays happy.
  useEffect(() => {
    if (lastPathnameRef.current !== pathname) {
      lastPathnameRef.current = pathname;
      if (safetyTimer.current) {
        clearTimeout(safetyTimer.current);
        safetyTimer.current = null;
      }
      queueMicrotask(() => setPending(false));
    }
  }, [pathname]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      // Only react to plain left-clicks.
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      // Skip non-app links.
      if (href.startsWith('#')) return;
      if (anchor.target && anchor.target !== '' && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      if (anchor.getAttribute('rel')?.includes('external')) return;

      // Resolve to URL to compare origin / pathname.
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }

      setPending(true);
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
      // Fallback so the bar can't get stuck if the navigation never lands.
      safetyTimer.current = setTimeout(() => setPending(false), 8000);
    };

    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  if (!pending) return null;
  return <div className="nav-progress-bar no-print" aria-hidden="true" />;
}
