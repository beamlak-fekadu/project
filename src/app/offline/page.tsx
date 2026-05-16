import LogoMark from '@/components/brand/LogoMark';
import OfflineFallbackClient from '@/components/offline/OfflineFallbackClient';
import CachedSnapshotList from '@/components/offline/CachedSnapshotList';
import { APP_NAME_SHORT, HOSPITAL_NAME } from '@/constants';

export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-10 text-[var(--foreground)]">
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <LogoMark size={64} />
        <p className="mt-4 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">
          {APP_NAME_SHORT}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{HOSPITAL_NAME}</p>

        <h1 className="mt-8 text-3xl font-semibold tracking-tight">BMERMS is offline</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
          Cached pages and queued actions may still be available. Reconnect to sync changes.
        </p>

        <OfflineFallbackClient />
        <CachedSnapshotList />
      </div>
    </main>
  );
}
