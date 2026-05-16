import {
  OFFLINE_ACTION_DEFINITIONS,
  type JsonSafeObject,
  type OfflineActionRunResult,
  type OfflineConflictDetail,
  type OfflineQueueFilter,
  type OfflineQueueInput,
  type OfflineQueueRecord,
  type OfflineQueueSummary,
  type OfflineSyncStatus,
} from '@/types/offline';
import {
  clearOfflineActionRecordsByStatus,
  deleteOfflineActionRecord,
  dispatchOfflineQueueChanged,
  getAllOfflineActionRecords,
  getOfflineActionRecord,
  isIndexedDbAvailable,
  putOfflineActionRecord,
} from './db';
import { canQueueOfflineAction } from './offline-permissions';
import { deriveConflictDetail } from './conflicts';

let fallbackCounter = 0;

export function createClientActionId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return `offline_${cryptoApi.randomUUID()}`;
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `offline_${token}`;
  }
  fallbackCounter += 1;
  return `offline_${Date.now().toString(36)}_${fallbackCounter.toString(36)}`;
}

function ensureBrowserQueue() {
  if (!isIndexedDbAvailable()) {
    throw new Error('Offline queue requires IndexedDB in a browser context');
  }
}

function ensureKnownAction(actionType: OfflineQueueInput['action_type']) {
  const definition = OFFLINE_ACTION_DEFINITIONS[actionType];
  if (!definition) throw new Error(`Unknown offline action type: ${actionType}`);
  if (definition.category === 'online_only') {
    throw new Error(`${definition.label} is online-only and cannot be queued offline`);
  }
}

function assertJsonSafeObject(value: JsonSafeObject, label: string) {
  try {
    JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON-safe`);
  }
}

function sortByCreatedAt(records: OfflineQueueRecord[]) {
  return [...records].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function matchesFilter(record: OfflineQueueRecord, filter?: OfflineQueueFilter) {
  if (!filter) return true;
  if (filter.statuses && !filter.statuses.includes(record.sync_status)) return false;
  if (filter.actionTypes && !filter.actionTypes.includes(record.action_type)) return false;
  if (filter.entityType && record.entity_type !== filter.entityType) return false;
  if (filter.assetId && record.asset_id !== filter.assetId) return false;
  if (filter.conflictTypes && filter.conflictTypes.length > 0) {
    const detail = record.conflict_detail ?? deriveConflictDetail(record);
    if (!detail || !filter.conflictTypes.includes(detail.conflict_type)) return false;
  }
  if (filter.roleNames && filter.roleNames.length > 0) {
    if (!record.role_name || !filter.roleNames.includes(record.role_name)) return false;
  }
  if (filter.createdByProfileId && record.created_by_profile_id !== filter.createdByProfileId) return false;
  if (filter.createdFrom && record.created_at < filter.createdFrom) return false;
  if (filter.createdTo && record.created_at > filter.createdTo) return false;
  return true;
}

export async function enqueueOfflineAction(action: OfflineQueueInput): Promise<OfflineQueueRecord> {
  ensureBrowserQueue();
  ensureKnownAction(action.action_type);
  assertJsonSafeObject(action.payload, 'Offline action payload');
  if (action.last_known_server_state) {
    assertJsonSafeObject(action.last_known_server_state, 'Last known server state');
  }
  if (action.metadata) assertJsonSafeObject(action.metadata, 'Offline action metadata');

  const now = new Date().toISOString();
  const record: OfflineQueueRecord = {
    client_action_id: action.client_action_id ?? createClientActionId(),
    action_type: action.action_type,
    entity_type: action.entity_type,
    entity_id: action.entity_id ?? null,
    asset_id: action.asset_id ?? null,
    qr_token: action.qr_token ?? null,
    payload: action.payload,
    created_by_profile_id: action.created_by_profile_id ?? null,
    role_name: action.role_name ?? null,
    source_route: action.source_route ?? null,
    created_at: now,
    last_known_server_state: action.last_known_server_state ?? null,
    sync_status: 'queued',
    retry_count: 0,
    last_error: null,
    last_attempted_at: null,
    synced_at: null,
    conflict_reason: null,
    conflict_detail: null,
    resolution_status: null,
    resolution_note: null,
    resolved_at: null,
    resolved_by: null,
    metadata: action.metadata ?? null,
  };

  await putOfflineActionRecord(record);
  dispatchOfflineQueueChanged();
  return record;
}

export async function getOfflineQueue(filter?: OfflineQueueFilter): Promise<OfflineQueueRecord[]> {
  if (!isIndexedDbAvailable()) return [];
  const records = await getAllOfflineActionRecords();
  return sortByCreatedAt(records.filter((record) => matchesFilter(record, filter)));
}

export function getQueuedActions() {
  return getOfflineQueue({ statuses: ['queued'] });
}

export function getFailedActions() {
  return getOfflineQueue({ statuses: ['failed'] });
}

export function getConflictActions() {
  return getOfflineQueue({ statuses: ['conflict'] });
}

export async function updateOfflineActionStatus(
  id: string,
  status: OfflineSyncStatus,
  patch: Partial<Omit<OfflineQueueRecord, 'client_action_id' | 'sync_status'>> = {},
): Promise<OfflineQueueRecord | null> {
  ensureBrowserQueue();
  const current = await getOfflineActionRecord(id);
  if (!current) return null;
  const next: OfflineQueueRecord = {
    ...current,
    ...patch,
    sync_status: status,
  };
  await putOfflineActionRecord(next);
  dispatchOfflineQueueChanged();
  return next;
}

export async function incrementRetry(id: string, error?: string): Promise<OfflineQueueRecord | null> {
  const current = await getOfflineActionRecord(id);
  if (!current) return null;
  const now = new Date().toISOString();
  return updateOfflineActionStatus(id, 'failed', {
    retry_count: current.retry_count + 1,
    last_error: error ?? current.last_error ?? 'Sync attempt failed',
    last_attempted_at: now,
    metadata: {
      ...(current.metadata ?? {}),
      retryable: current.metadata?.retryable === true,
    },
  });
}

export async function markSynced(id: string, serverResult?: JsonSafeObject): Promise<OfflineQueueRecord | null> {
  const current = await getOfflineActionRecord(id);
  if (!current) return null;
  const now = new Date().toISOString();
  return updateOfflineActionStatus(id, 'synced', {
    last_error: null,
    last_attempted_at: now,
    synced_at: now,
    conflict_reason: null,
    metadata: {
      ...(current.metadata ?? {}),
      ...(serverResult ? { server_result: serverResult } : {}),
    },
  });
}

export function markFailed(id: string, error: string) {
  return updateOfflineActionStatus(id, 'failed', {
    last_error: error,
    last_attempted_at: new Date().toISOString(),
  });
}

export function markConflict(id: string, reason: string, detail?: OfflineConflictDetail | null) {
  return updateOfflineActionStatus(id, 'conflict', {
    conflict_reason: reason,
    last_error: reason,
    last_attempted_at: new Date().toISOString(),
    conflict_detail: detail ?? null,
    resolution_status: 'conflict',
  });
}

export async function markUnderReview(id: string, note?: string | null) {
  const current = await getOfflineActionRecord(id);
  if (!current) return null;
  return updateOfflineActionStatus(id, 'under_review', {
    resolution_status: 'under_review',
    resolution_note: note ?? null,
    conflict_detail: current.conflict_detail ?? deriveConflictDetail(current),
  });
}

export async function markResolvedDiscarded(id: string, note?: string | null) {
  const now = new Date().toISOString();
  return updateOfflineActionStatus(id, 'resolved_discarded', {
    resolution_status: 'resolved_discarded',
    resolution_note: note ?? null,
    resolved_at: now,
  });
}

export async function markResolvedManual(id: string, note?: string | null) {
  const now = new Date().toISOString();
  const current = await getOfflineActionRecord(id);
  return updateOfflineActionStatus(id, 'synced', {
    resolution_status: 'resolved_manual',
    resolution_note: note ?? null,
    resolved_at: now,
    synced_at: now,
    conflict_reason: null,
    metadata: {
      ...(current?.metadata ?? {}),
      manual_resolution: true,
    },
  });
}

export async function retryOfflineAction(id: string, options?: { allowConflict?: boolean }): Promise<OfflineQueueRecord | null> {
  const current = await getOfflineActionRecord(id);
  if (!current) return null;
  if ((current.sync_status === 'conflict' || current.sync_status === 'under_review') && !options?.allowConflict) {
    throw new Error('Conflicted actions require review before retry');
  }
  return updateOfflineActionStatus(id, 'queued', {
    last_error: null,
    conflict_reason: null,
    conflict_detail: null,
    resolution_status: null,
    resolution_note: current.resolution_note ?? null,
    last_attempted_at: null,
    metadata: {
      ...(current.metadata ?? {}),
      retryable: true,
    },
  });
}

export async function removeOfflineAction(id: string) {
  ensureBrowserQueue();
  await deleteOfflineActionRecord(id);
  dispatchOfflineQueueChanged();
}

export async function clearSyncedActions() {
  if (!isIndexedDbAvailable()) return;
  await clearOfflineActionRecordsByStatus('synced');
  await clearOfflineActionRecordsByStatus('resolved_discarded');
  dispatchOfflineQueueChanged();
}

export async function getOfflineQueueSummary(): Promise<OfflineQueueSummary> {
  const records = await getOfflineQueue();
  const summary: OfflineQueueSummary = {
    total: records.length,
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

  for (const record of records) {
    summary[record.sync_status] += 1;
    if (record.sync_status === 'conflict' || record.sync_status === 'under_review') {
      summary.needs_review += 1;
    }
    if (!summary.lastCreatedAt || record.created_at > summary.lastCreatedAt) {
      summary.lastCreatedAt = record.created_at;
    }
    if (record.last_attempted_at && (!summary.lastAttemptedAt || record.last_attempted_at > summary.lastAttemptedAt)) {
      summary.lastAttemptedAt = record.last_attempted_at;
    }
    if (record.synced_at && (!summary.lastSyncedAt || record.synced_at > summary.lastSyncedAt)) {
      summary.lastSyncedAt = record.synced_at;
    }
    if (record.last_error) summary.lastError = record.last_error;
  }

  return summary;
}

function isLikelyNetworkError(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /network|fetch|failed to fetch|load failed|offline|timeout|connection/i.test(message);
}

export async function runOfflineCapableAction<T>(params: {
  actionType: OfflineQueueInput['action_type'];
  entityType: string;
  payload: JsonSafeObject;
  roleNames?: string[] | null;
  assetId?: string | null;
  entityId?: string | null;
  qrToken?: string | null;
  sourceRoute?: string | null;
  createdByProfileId?: string | null;
  roleName?: string | null;
  executeOnline: () => Promise<T>;
  queueIfOffline?: boolean;
  lastKnownServerState?: JsonSafeObject | null;
  metadata?: JsonSafeObject | null;
}): Promise<OfflineActionRunResult<T>> {
  const queueIfOffline = params.queueIfOffline ?? true;
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;

  if (online) {
    try {
      const data = await params.executeOnline();
      if (
        data &&
        typeof data === 'object' &&
        'success' in data &&
        (data as { success?: boolean }).success === false
      ) {
        const message =
          'error' in data && typeof (data as { error?: unknown }).error === 'string'
            ? (data as { error: string }).error
            : 'Action failed server validation';
        return { status: 'failed', error: message };
      }
      return { status: 'success', data };
    } catch (error) {
      if (!queueIfOffline || !isLikelyNetworkError(error)) {
        return { status: 'failed', error: error instanceof Error ? error.message : 'Action failed' };
      }
    }
  }

  if (!queueIfOffline) {
    return { status: 'failed', error: 'This action requires an online connection' };
  }

  try {
    if (params.roleNames && !canQueueOfflineAction(params.roleNames, params.actionType)) {
      return { status: 'failed', error: 'Your role cannot queue this action offline' };
    }
    const action = await enqueueOfflineAction({
      action_type: params.actionType,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      asset_id: params.assetId ?? null,
      qr_token: params.qrToken ?? null,
      payload: params.payload,
      created_by_profile_id: params.createdByProfileId ?? null,
      role_name: params.roleName ?? null,
      source_route: params.sourceRoute ?? (typeof window !== 'undefined' ? window.location.pathname : null),
      last_known_server_state: params.lastKnownServerState ?? null,
      metadata: {
        ...(params.metadata ?? {}),
        queued_from: online ? 'network_failure' : 'offline',
        retryable: true,
      },
    });
    return { status: 'queued', action };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : 'Failed to queue offline action' };
  }
}
