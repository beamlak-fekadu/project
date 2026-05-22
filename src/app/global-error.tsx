"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";

// Recognise the Next.js chunk-load failure that surfaces when the service
// worker serves cached HTML referencing JS chunks from a different build.
function isChunkLoadError(error: Error): boolean {
  const msg = error?.message ?? '';
  const name = error?.name ?? '';
  return (
    name === 'ChunkLoadError' ||
    /loading (css )?chunk/i.test(msg) ||
    /failed to load chunk/i.test(msg) ||
    /dynamically imported module/i.test(msg)
  );
}

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const [isOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const chunkError = isChunkLoadError(error);
  const heading = chunkError
    ? isOffline
      ? 'Offline — app needs to reload'
      : 'A page resource failed to load'
    : 'Something went wrong';

  const message = chunkError
    ? isOffline
      ? 'BMEDIS is offline and a required page script was not cached. Please reconnect to the internet and reload the page.'
      : 'A required page script could not be loaded. This can happen after a new deployment. Please reload the page.'
    : 'An unexpected error occurred. Please reload the page to continue.';

  return (
    <html lang="en">
      <body style={{
        margin: 0,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: '#111827',
        color: '#f8fafc',
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
      }}>
        <section style={{
          maxWidth: 520,
          textAlign: 'center',
          border: '1px solid rgba(99,102,241,0.35)',
          borderRadius: 12,
          background: 'rgba(99,102,241,0.08)',
          padding: '32px 28px',
        }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            BMEDIS
          </p>
          <h1 style={{ margin: '0 0 14px', fontSize: 22, color: '#e0e7ff' }}>
            {heading}
          </h1>
          <p style={{ margin: '0 0 24px', color: '#94a3b8', lineHeight: 1.6, fontSize: 15 }}>
            {message}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: '1px solid rgba(99,102,241,0.6)',
                borderRadius: 8,
                padding: '10px 20px',
                background: 'rgba(99,102,241,0.2)',
                color: '#e0e7ff',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={() => { window.location.href = '/'; }}
              style={{
                border: '1px solid rgba(148,163,184,0.3)',
                borderRadius: 8,
                padding: '10px 20px',
                background: 'transparent',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Go to home
            </button>
          </div>
          {isOffline && (
            <p style={{ marginTop: 20, fontSize: 12, color: '#64748b' }}>
              You are currently offline. Actions queued while offline will sync automatically when connection returns.
            </p>
          )}
        </section>
      </body>
    </html>
  );
}
