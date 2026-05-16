import { syncOfflineQueuedActionAction } from '@/actions/offline-sync.actions';
import type { JsonSafeObject, OfflineConflictDetail } from '@/types/offline';
import { inferConflictTypeFromReason, buildConflictDetail } from '../conflicts';
import type { OfflineActionHandler, OfflineActionHandlerResult } from '../sync-engine';

async function replay(action: Parameters<OfflineActionHandler>[0]): Promise<OfflineActionHandlerResult> {
  const result = await syncOfflineQueuedActionAction(action);
  if (!result.success || !result.data) {
    return { status: 'failed', error: result.error ?? 'Offline action replay failed', retryable: true };
  }
  if (result.data.status === 'synced') return { status: 'synced', serverResult: result.data.serverResult as JsonSafeObject | undefined };
  if (result.data.status === 'conflict') {
    const reason = result.data.conflictReason ?? 'Needs review';
    const detail = (result.data.conflictDetail as OfflineConflictDetail | undefined)
      ?? buildConflictDetail({
        conflict_type: inferConflictTypeFromReason(reason, action.action_type),
        conflict_reason: reason,
      });
    return { status: 'conflict', reason, detail };
  }
  return { status: 'failed', error: result.data.error ?? 'Offline action replay failed', retryable: false };
}

export const maintenanceOfflineHandlers = {
  'maintenance_request.create': replay,
  'maintenance_event.log': replay,
  'qr_note.create': replay,
  'work_order.start_intent': replay,
  'work_order.complete_draft': replay,
} satisfies Partial<Record<string, OfflineActionHandler>>;
