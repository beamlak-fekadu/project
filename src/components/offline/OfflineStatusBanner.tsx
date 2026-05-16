'use client';

import { AlertTriangle, WifiOff } from 'lucide-react';
import { useOfflineSync } from './SyncEngineProvider';

export default function OfflineStatusBanner() {
  const sync = useOfflineSync();

  if (sync.isOnline && sync.summary.failed === 0 && sync.summary.conflict === 0) return null;

  if (!sync.isOnline) {
    return (
      <div className="no-print border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-100 lg:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <WifiOff className="h-4 w-4" />
          <span className="font-semibold">Offline</span>
          <span>
            Cached pages and queued actions may still be available. Reconnect to sync changes.
            {sync.summary.queued > 0 ? ` ${sync.summary.queued} action${sync.summary.queued === 1 ? '' : 's'} queued on this device.` : ''}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="no-print border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-100 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-semibold">Sync attention needed</span>
        <span>
          {sync.summary.failed > 0 ? `${sync.summary.failed} failed action${sync.summary.failed === 1 ? '' : 's'}. ` : ''}
          {sync.summary.conflict > 0 ? `${sync.summary.conflict} conflict${sync.summary.conflict === 1 ? '' : 's'} need review. ` : ''}
          No queued action is marked synced until the server confirms it.
        </span>
      </div>
    </div>
  );
}
