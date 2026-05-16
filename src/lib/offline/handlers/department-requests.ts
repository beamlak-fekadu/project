import { syncOfflineQueuedActionAction } from '@/actions/offline-sync.actions';
import type { JsonSafeObject, OfflineConflictDetail } from '@/types/offline';
import { buildConflictDetail, inferConflictTypeFromReason } from '../conflicts';
import type { OfflineActionHandler, OfflineActionHandlerResult } from '../sync-engine';

async function replay(action: Parameters<OfflineActionHandler>[0]): Promise<OfflineActionHandlerResult> {
  const result = await syncOfflineQueuedActionAction(action);
  if (!result.success || !result.data) {
    return { status: 'failed', error: result.error ?? 'Department offline request replay failed', retryable: true };
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
  return { status: 'failed', error: result.data.error ?? 'Department offline request replay failed', retryable: false };
}

export const departmentRequestOfflineHandlers = {
  'calibration_request.create': replay,
  'training_request.create': replay,
  'department_issue.report': replay,
} satisfies Partial<Record<string, OfflineActionHandler>>;
