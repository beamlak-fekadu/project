import type { OfflineActionType } from '@/types/offline';
import {
  buildConflictDetail,
  summarizeLocalPayload,
  summarizeServerState,
  type ConflictInput,
} from './conflicts';
import type { OfflineConflictDetail, JsonSafeObject } from '@/types/offline';

export type ValidationOk = { ok: true };
export type ValidationConflict = { ok: false; conflict: OfflineConflictDetail };
export type ValidationResult = ValidationOk | ValidationConflict;

export function ok(): ValidationOk {
  return { ok: true };
}

export function conflict(input: ConflictInput): ValidationConflict {
  return { ok: false, conflict: buildConflictDetail(input) };
}

export function requirePositiveQuantity(value: unknown, label = 'quantity'): ValidationResult {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return conflict({
      conflict_type: 'invalid_payload',
      conflict_reason: `Offline draft has an invalid ${label}`,
      local_payload_summary: { [label]: value as string | number | boolean | null },
    });
  }
  return ok();
}

export function requireString(value: unknown, label: string): ValidationResult {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return conflict({
      conflict_type: 'invalid_payload',
      conflict_reason: `Offline draft is missing ${label}`,
    });
  }
  return ok();
}

export function assetMissingConflict(reason: string): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'asset_missing',
    conflict_reason: reason,
  });
}

export function assetDeletedConflict(): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'asset_deleted',
    conflict_reason: 'Asset was deleted before sync',
  });
}

export function departmentScopeConflict(reason: string, payloadSummary?: JsonSafeObject): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'department_scope_mismatch',
    conflict_reason: reason,
    local_payload_summary: payloadSummary ?? null,
  });
}

export function duplicateOpenRequestConflict(reason: string, existing?: Record<string, unknown> | null): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'duplicate_open_request',
    conflict_reason: reason,
    server_state_summary: existing ? summarizeServerState(existing, ['id', 'request_number', 'status']) : null,
  });
}

export function workOrderTerminalConflict(workOrder: Record<string, unknown> | null): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'work_order_completed',
    conflict_reason: 'Work order is already terminal; offline action needs review',
    server_state_summary: workOrder ? summarizeServerState(workOrder, ['id', 'status', 'completed_date', 'completion_outcome']) : null,
  });
}

export function workOrderStatusChangedConflict(reason: string, workOrder: Record<string, unknown> | null): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'work_order_status_changed',
    conflict_reason: reason,
    server_state_summary: workOrder ? summarizeServerState(workOrder, ['id', 'status', 'started_at', 'assigned_to']) : null,
  });
}

export function insufficientStockConflict(part: Record<string, unknown> | null, requested: number): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'insufficient_stock',
    conflict_reason: 'Insufficient stock at sync time',
    server_state_summary: part ? summarizeServerState(part, ['id', 'part_code', 'name', 'current_stock', 'reorder_level']) : null,
    local_payload_summary: { requested_quantity: requested },
  });
}

export function partMissingConflict(): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'part_missing',
    conflict_reason: 'Spare part no longer exists',
  });
}

export function partInactiveConflict(): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'part_inactive',
    conflict_reason: 'Spare part is inactive',
  });
}

export function permissionDeniedConflict(actionType: OfflineActionType, role?: string | null): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'permission_denied',
    conflict_reason: `Current role${role ? ` (${role})` : ''} cannot sync ${actionType}`,
  });
}

export function procurementStateChangedConflict(reason: string, procurement: Record<string, unknown> | null): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'procurement_state_changed',
    conflict_reason: reason,
    server_state_summary: procurement ? summarizeServerState(procurement, ['id', 'request_number', 'status']) : null,
  });
}

export function unsupportedActionConflict(actionType: OfflineActionType): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'unsupported_action',
    conflict_reason: `No sync handler is registered for ${actionType}`,
  });
}

export function unknownSyncErrorConflict(reason: string): OfflineConflictDetail {
  return buildConflictDetail({
    conflict_type: 'unknown_sync_error',
    conflict_reason: reason,
  });
}

export { summarizeLocalPayload, summarizeServerState };
