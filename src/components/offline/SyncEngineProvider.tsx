'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { OFFLINE_QUEUE_CHANGED_EVENT } from '@/lib/offline/db';
import { getOfflineQueueSummary } from '@/lib/offline/queue';
import { syncOfflineQueue, type OfflineSyncRunResult } from '@/lib/offline/sync-engine';
import type { OfflineQueueSummary } from '@/types/offline';

type SyncEngineContextValue = {
  isOnline: boolean;
  onlineStatus: 'online' | 'offline' | 'checking' | 'unknown';
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
  summary: OfflineQueueSummary;
  isSyncing: boolean;
  lastSyncAttemptAt: string | null;
  lastSyncError: string | null;
  lastSyncResult: OfflineSyncRunResult | null;
  refreshSummary: () => Promise<void>;
  startSync: () => Promise<OfflineSyncRunResult | null>;
};

const emptySummary: OfflineQueueSummary = {
  total: 0,
  queued: 0,
  syncing: 0,
  synced: 0,
  failed: 0,
  conflict: 0,
  under_review: 0,
  resolved_discarded: 0,
  needs_review: 0,
  lastCreatedAt: null,
  lastAttemptedAt: null,
  lastSyncedAt: null,
  lastError: null,
};

const SyncEngineContext = createContext<SyncEngineContextValue | null>(null);

export function SyncEngineProvider({ children }: { children: ReactNode }) {
  const online = useOnlineStatus();
  const syncingRef = useRef(false);
  const [summary, setSummary] = useState<OfflineQueueSummary>(emptySummary);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAttemptAt, setLastSyncAttemptAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<OfflineSyncRunResult | null>(null);

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await getOfflineQueueSummary());
    } catch (error) {
      setLastSyncError(error instanceof Error ? error.message : 'Failed to read offline queue');
    }
  }, []);

  const startSync = useCallback(async () => {
    if (!online.isOnline || syncingRef.current) return null;
    syncingRef.current = true;
    setIsSyncing(true);
    const attemptedAt = new Date().toISOString();
    setLastSyncAttemptAt(attemptedAt);
    try {
      const result = await syncOfflineQueue();
      setLastSyncResult(result);
      setLastSyncError(result.lastError ?? null);
      await refreshSummary();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Offline sync failed';
      setLastSyncError(message);
      return {
        attempted: 0,
        synced: 0,
        failed: 1,
        conflicts: 0,
        skipped: 0,
        lastError: message,
      };
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [online.isOnline, refreshSummary]);

  useEffect(() => {
    void refreshSummary();
    const handleQueueChange = () => {
      void refreshSummary();
    };
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, handleQueueChange);
    return () => window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, handleQueueChange);
  }, [refreshSummary]);

  useEffect(() => {
    if (!online.isOnline || summary.queued === 0) return;
    void startSync();
  }, [online.isOnline, startSync, summary.queued]);

  const value = useMemo<SyncEngineContextValue>(() => ({
    isOnline: online.isOnline,
    onlineStatus: online.status,
    lastOnlineAt: online.lastOnlineAt,
    lastOfflineAt: online.lastOfflineAt,
    summary,
    isSyncing,
    lastSyncAttemptAt,
    lastSyncError,
    lastSyncResult,
    refreshSummary,
    startSync,
  }), [
    isSyncing,
    lastSyncAttemptAt,
    lastSyncError,
    lastSyncResult,
    online.isOnline,
    online.lastOfflineAt,
    online.lastOnlineAt,
    online.status,
    refreshSummary,
    startSync,
    summary,
  ]);

  return (
    <SyncEngineContext.Provider value={value}>
      {children}
    </SyncEngineContext.Provider>
  );
}

export function useOfflineSync() {
  const context = useContext(SyncEngineContext);
  if (!context) {
    return {
      isOnline: true,
      onlineStatus: 'unknown' as const,
      lastOnlineAt: null,
      lastOfflineAt: null,
      summary: emptySummary,
      isSyncing: false,
      lastSyncAttemptAt: null,
      lastSyncError: null,
      lastSyncResult: null,
      refreshSummary: async () => undefined,
      startSync: async () => null,
    };
  }
  return context;
}
