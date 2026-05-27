'use client';

import { useEffect } from 'react';

function canRegisterServiceWorker() {
  if (typeof window === 'undefined') return false;
  if (process.env.NODE_ENV !== 'production') return false;
  if (!('serviceWorker' in navigator)) return false;
  const host = window.location.hostname;
  return window.location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1';
}

function clearDevelopmentServiceWorkers() {
  if (typeof window === 'undefined') return;
  if (process.env.NODE_ENV === 'production') return;
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => undefined);

  if ('caches' in window) {
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('bmedis-')).map((key) => caches.delete(key))))
      .catch(() => undefined);
  }
}

export default function ServiceWorkerRegister() {
  useEffect(() => {
    clearDevelopmentServiceWorkers();
    if (!canRegisterServiceWorker()) return;

    let cancelled = false;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (cancelled) return;
        window.dispatchEvent(new CustomEvent('bmedis:service-worker-ready', {
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
