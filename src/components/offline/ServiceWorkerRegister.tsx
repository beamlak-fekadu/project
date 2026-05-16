'use client';

import { useEffect } from 'react';

function canRegisterServiceWorker() {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  const host = window.location.hostname;
  return window.location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1';
}

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!canRegisterServiceWorker()) return;

    let cancelled = false;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (cancelled) return;
        window.dispatchEvent(new CustomEvent('bmerms:service-worker-ready', {
          detail: {
            scope: registration.scope,
            active: !!registration.active,
            waiting: !!registration.waiting,
            installing: !!registration.installing,
          },
        }));
      })
      .catch((error) => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[offline] Service worker registration failed', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
