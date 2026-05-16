'use client';

import { Wifi, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export default function NetworkStatusPill({ className = '' }: { className?: string }) {
  const { isOnline, status } = useOnlineStatus({ verifyOnline: false });
  const Icon = isOnline ? Wifi : WifiOff;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        isOnline
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
      } ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {status === 'checking' ? 'Checking' : isOnline ? 'Online' : 'Offline'}
    </span>
  );
}
