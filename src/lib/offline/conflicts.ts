import type {
  JsonSafeObject,
  OfflineActionType,
  OfflineConflictDetail,
  OfflineConflictResolutionStatus,
  OfflineConflictType,
  OfflineQueueRecord,
} from '@/types/offline';

export type ConflictInput = {
  conflict_type: OfflineConflictType;
  conflict_reason: string;
  server_state_summary?: JsonSafeObject | null;
  local_payload_summary?: JsonSafeObject | null;
  recommended_resolution?: string | null;
  resolution_status?: OfflineConflictResolutionStatus;
};

const RECOMMENDED_RESOLUTION_BY_TYPE: Record<OfflineConflictType, string> = {
  asset_missing: 'Confirm the asset still exists in BMERMS, then discard or recreate the action against the current asset.',
  asset_deleted: 'Asset was removed before sync. Discard the local action; create a new record against an active asset if still needed.',
  department_scope_mismatch: 'Asset is outside your department scope. Discard the action or ask BME Head to act on it instead.',
  duplicate_open_request: 'An open request already exists for this asset. Open the existing record and discard the duplicate draft.',
  work_order_completed: 'The work order is closed. Convert the local note to a new corrective request or discard if no longer applicable.',
  work_order_status_changed: 'The work order has moved on. Re-check current status, then either retry or discard.',
  insufficient_stock: 'Server stock is below the requested quantity. Confirm with store, adjust the quantity, or discard.',
  procurement_state_changed: 'Procurement state changed before sync. Confirm latest state, then receive against the current row or discard.',
  stock_already_received: 'Receipt already recorded server-side. Discard the duplicate local draft.',
  unsupported_action: 'No sync handler is registered for this action. Hold or discard.',
  permission_denied: 'Your role cannot perform this action online. Discard or escalate to BME Head.',
  stale_server_state: 'Server state has moved. Refresh, decide if the action still applies, then retry or discard.',
  unknown_sync_error: 'Sync produced an unrecognized error. Inspect payload, retry, or discard.',
  invalid_payload: 'Local payload failed validation. Open the source and resubmit with correct values; discard the broken draft.',
  part_missing: 'Spare part no longer exists. Discard or recreate against an active part.',
  part_inactive: 'Spare part is inactive. Discard or pick an active replacement.',
};

export function buildConflictDetail(input: ConflictInput): OfflineConflictDetail {
  return {
    conflict_type: input.conflict_type,
    conflict_reason: input.conflict_reason,
    server_state_summary: input.server_state_summary ?? null,
    local_payload_summary: input.local_payload_summary ?? null,
    recommended_resolution: input.recommended_resolution ?? RECOMMENDED_RESOLUTION_BY_TYPE[input.conflict_type] ?? null,
    resolution_status: input.resolution_status ?? 'conflict',
    resolution_note: null,
    resolved_at: null,
    resolved_by: null,
    created_at: new Date().toISOString(),
  };
}

export function summarizeServerState(row: Record<string, unknown> | null | undefined, keys: string[]): JsonSafeObject {
  if (!row) return {};
  const summary: JsonSafeObject = {};
  for (const key of keys) {
    const value = row[key];
    if (value === undefined) continue;
    if (value === null) {
      summary[key] = null;
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      summary[key] = value;
      continue;
    }
    summary[key] = String(value);
  }
  return summary;
}

export function summarizeLocalPayload(payload: JsonSafeObject, keys: string[]): JsonSafeObject {
  const summary: JsonSafeObject = {};
  for (const key of keys) {
    const value = payload[key];
    if (value === undefined) continue;
    summary[key] = value;
  }
  return summary;
}

export function isResolvedConflictStatus(status: OfflineConflictResolutionStatus | null | undefined) {
  if (!status) return false;
  return status === 'resolved_synced' || status === 'resolved_discarded' || status === 'resolved_manual';
}

export function isOpenConflictStatus(status: OfflineConflictResolutionStatus | null | undefined) {
  if (!status) return false;
  return status === 'conflict' || status === 'under_review';
}

export function conflictTypeLabel(type: OfflineConflictType): string {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function inferConflictTypeFromReason(reason: string | null | undefined, actionType?: OfflineActionType): OfflineConflictType {
  const text = (reason ?? '').toLowerCase();
  if (!text) return 'unknown_sync_error';
  if (text.includes('missing') || text.includes('does not exist') || text.includes('no longer exists')) {
    if (text.includes('spare part') || text.includes('part_id')) return 'part_missing';
    if (text.includes('work order')) return 'work_order_status_changed';
    return 'asset_missing';
  }
  if (text.includes('deleted') || text.includes('has been deleted')) return 'asset_deleted';
  if (text.includes('inactive')) return 'part_inactive';
  if (text.includes('not in your department') || text.includes('department')) return 'department_scope_mismatch';
  if (text.includes('duplicate') || text.includes('already exists') || text.includes('already open')) return 'duplicate_open_request';
  if (text.includes('terminal') || text.includes('already completed') || text.includes('already closed') || text.includes('canceled')) return 'work_order_completed';
  if (text.includes('already started')) return 'work_order_status_changed';
  if (text.includes('insufficient stock')) return 'insufficient_stock';
  if (text.includes('procurement')) return 'procurement_state_changed';
  if (text.includes('already received')) return 'stock_already_received';
  if (text.includes('not allowed') || text.includes('permission') || text.includes('not authorized') || text.includes('not allowed to sync')) return 'permission_denied';
  if (text.includes('no sync handler')) return 'unsupported_action';
  if (text.includes('invalid')) return 'invalid_payload';
  if (text.includes('revoked')) return 'asset_missing';
  if (actionType && actionType.endsWith('.draft') && text.includes('quantity')) return 'invalid_payload';
  return 'unknown_sync_error';
}

export function deriveConflictDetail(record: OfflineQueueRecord): OfflineConflictDetail | null {
  if (record.conflict_detail) return record.conflict_detail;
  if (record.sync_status !== 'conflict' && record.sync_status !== 'under_review') return null;
  if (!record.conflict_reason && !record.last_error) return null;
  const reason = record.conflict_reason ?? record.last_error ?? 'Conflict reason not captured';
  return buildConflictDetail({
    conflict_type: inferConflictTypeFromReason(reason, record.action_type),
    conflict_reason: reason,
    local_payload_summary: summarizeLocalPayload(record.payload, [
      'asset_id', 'work_order_id', 'part_id', 'quantity', 'quantity_issued', 'quantity_received',
      'urgency', 'priority', 'fault_description', 'description', 'reported_condition',
    ]),
    server_state_summary: (record.last_known_server_state as JsonSafeObject | null) ?? null,
  });
}
