'use client';

import { Wifi, WifiOff } from 'lucide-react';
import { useOfflineSync } from './SyncEngineProvider';

export default function OfflineSubmitBanner({ actionLabel }: { actionLabel: string }) {
  const { isOnline, summary } = useOfflineSync();
  return (
    <div className={`rounded-lg border p-3 text-xs ${
      isOnline
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
    }`}>
      <div className="flex items-start gap-2">
        {isOnline ? <Wifi className="mt-0.5 h-4 w-4 shrink-0" /> : <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />}
        <p>
          {isOnline
            ? `${actionLabel} will submit online now. If the network drops during submit, it can be saved locally.`
            : `${actionLabel} will be saved offline and queued for sync.`}
          {summary.queued > 0 ? ` ${summary.queued} action${summary.queued === 1 ? '' : 's'} already pending on this device.` : ''}
        </p>
      </div>
    </div>
  );
}
