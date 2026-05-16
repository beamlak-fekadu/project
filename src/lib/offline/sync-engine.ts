import { recordOfflineSyncEventAction } from '@/actions/offline-sync.actions';
import type { JsonSafeObject, OfflineConflictDetail, OfflineQueueRecord } from '@/types/offline';
import { offlineActionHandlers } from './handlers';
import {
  getOfflineQueue,
  incrementRetry,
  markConflict,
  markSynced,
  updateOfflineActionStatus,
} from './queue';
import { unsupportedActionConflict } from './validation';

export const OFFLINE_SYNC_MAX_RETRIES = 3;

export type OfflineActionHandlerResult =
  | { status: 'synced'; serverResult?: JsonSafeObject }
  | { status: 'failed'; error: string; retryable?: boolean }
  | { status: 'conflict'; reason: string; detail?: OfflineConflictDetail };

export type OfflineActionHandler = (action: OfflineQueueRecord) => Promise<OfflineActionHandlerResult>;

export type OfflineSyncRunResult = {
  attempted: number;
  synced: number;
  failed: number;
  conflicts: number;
  skipped: number;
  lastError?: string | null;
};

function canUseBrowserNetwork() {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

function isRetryableQueuedAction(action: OfflineQueueRecord) {
  if (action.sync_status === 'queued') return true;
  if (action.sync_status !== 'failed') return false;
  if (action.metadata?.pending_not_supported === true) return false;
  return action.retry_count < OFFLINE_SYNC_MAX_RETRIES && action.metadata?.retryable === true;
}

async function recordSyncEvent(
  action: OfflineQueueRecord,
  status: 'pending' | 'synced' | 'failed' | 'conflict' | 'under_review' | 'resolved_discarded',
  details: {
    errorMessage?: string | null;
    conflictReason?: string | null;
    conflictDetail?: OfflineConflictDetail | null;
    resolutionStatus?: string | null;
    serverResult?: JsonSafeObject | null;
  } = {},
) {
  try {
    await recordOfflineSyncEventAction({
      client_action_id: action.client_action_id,
      action_type: action.action_type,
      entity_type: action.entity_type,
      entity_id: action.entity_id ?? null,
      asset_id: action.asset_id ?? null,
      qr_token: action.qr_token ?? null,
      payload: action.payload,
      role_name: action.role_name ?? null,
      queued_at: action.created_at,
      sync_status: status,
      error_message: details.errorMessage ?? action.last_error ?? null,
      conflict_reason: details.conflictReason ?? action.conflict_reason ?? null,
      conflict_detail: (details.conflictDetail ?? action.conflict_detail ?? null) as unknown as Record<string, unknown> | null,
      resolution_status: details.resolutionStatus ?? action.resolution_status ?? null,
      source_route: action.source_route ?? null,
      retry_count: action.retry_count,
      metadata: {
        ...(action.metadata ?? {}),
        ...(details.serverResult ? { server_result: details.serverResult } : {}),
        local_retry_count: action.retry_count,
        local_sync_status: action.sync_status,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[offline-sync] Failed to record server sync event', error);
    }
  }
}

async function markUnsupported(action: OfflineQueueRecord): Promise<Extract<OfflineActionHandlerResult, { status: 'conflict' }>> {
  const detail = unsupportedActionConflict(action.action_type);
  const conflict = await markConflict(action.client_action_id, detail.conflict_reason, detail);
  const updated = await updateOfflineActionStatus(action.client_action_id, 'conflict', {
    metadata: {
      ...((conflict ?? action).metadata ?? {}),
      retryable: false,
      pending_not_supported: true,
    },
  });
  await recordSyncEvent(updated ?? conflict ?? action, 'conflict', {
    errorMessage: detail.conflict_reason,
    conflictReason: detail.conflict_reason,
    conflictDetail: detail,
  });
  return { status: 'conflict', reason: detail.conflict_reason, detail };
}

export async function syncOfflineQueue(): Promise<OfflineSyncRunResult> {
  const result: OfflineSyncRunResult = {
    attempted: 0,
    synced: 0,
    failed: 0,
    conflicts: 0,
    skipped: 0,
    lastError: null,
  };

  if (!canUseBrowserNetwork()) {
    result.skipped += 1;
    result.lastError = 'Offline; sync was not attempted';
    return result;
  }

  const candidates = (await getOfflineQueue()).filter(isRetryableQueuedAction);

  for (const action of candidates) {
    result.attempted += 1;
    const handler = offlineActionHandlers[action.action_type];

    if (!handler) {
      const unsupported = await markUnsupported(action);
      result.conflicts += 1;
      result.lastError = unsupported.reason;
      continue;
    }

    await updateOfflineActionStatus(action.client_action_id, 'syncing', {
      last_attempted_at: new Date().toISOString(),
      last_error: null,
    });

    try {
      const handlerResult = await handler(action);
      if (handlerResult.status === 'synced') {
        const synced = await markSynced(action.client_action_id, handlerResult.serverResult);
        await recordSyncEvent(synced ?? action, 'synced', { serverResult: handlerResult.serverResult ?? null });
        result.synced += 1;
        continue;
      }

      if (handlerResult.status === 'conflict') {
        const conflict = await markConflict(action.client_action_id, handlerResult.reason, handlerResult.detail ?? null);
        await recordSyncEvent(conflict ?? action, 'conflict', {
          conflictReason: handlerResult.reason,
          conflictDetail: handlerResult.detail ?? null,
        });
        result.conflicts += 1;
        result.lastError = handlerResult.reason;
        continue;
      }

      const failed = await incrementRetry(action.client_action_id, handlerResult.error);
      await updateOfflineActionStatus(action.client_action_id, 'failed', {
        metadata: {
          ...((failed ?? action).metadata ?? {}),
          retryable: handlerResult.retryable === true,
        },
      });
      await recordSyncEvent(failed ?? action, 'failed', { errorMessage: handlerResult.error });
      result.failed += 1;
      result.lastError = handlerResult.error;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected sync error';
      const failed = await incrementRetry(action.client_action_id, message);
      await recordSyncEvent(failed ?? action, 'failed', { errorMessage: message });
      result.failed += 1;
      result.lastError = message;
    }
  }

  return result;
}
