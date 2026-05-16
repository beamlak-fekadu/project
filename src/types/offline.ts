import type { RoleName } from './roles';

export type JsonPrimitive = string | number | boolean | null;
export type JsonSafeValue = JsonPrimitive | JsonSafeObject | JsonSafeValue[];
export type JsonSafeObject = { [key: string]: JsonSafeValue };

export const OFFLINE_SYNC_STATUSES = [
  'queued',
  'syncing',
  'synced',
  'failed',
  'conflict',
  'under_review',
  'resolved_discarded',
] as const;

export type OfflineSyncStatus = typeof OFFLINE_SYNC_STATUSES[number];

export const OFFLINE_CONFLICT_TYPES = [
  'asset_missing',
  'asset_deleted',
  'department_scope_mismatch',
  'duplicate_open_request',
  'work_order_completed',
  'work_order_status_changed',
  'insufficient_stock',
  'procurement_state_changed',
  'stock_already_received',
  'unsupported_action',
  'permission_denied',
  'stale_server_state',
  'unknown_sync_error',
  'invalid_payload',
  'part_missing',
  'part_inactive',
] as const;

export type OfflineConflictType = typeof OFFLINE_CONFLICT_TYPES[number];

export const OFFLINE_CONFLICT_RESOLUTION_STATUSES = [
  'conflict',
  'under_review',
  'resolved_synced',
  'resolved_discarded',
  'resolved_manual',
] as const;

export type OfflineConflictResolutionStatus = typeof OFFLINE_CONFLICT_RESOLUTION_STATUSES[number];

export type OfflineConflictDetail = {
  conflict_type: OfflineConflictType;
  conflict_reason: string;
  server_state_summary?: JsonSafeObject | null;
  local_payload_summary?: JsonSafeObject | null;
  recommended_resolution?: string | null;
  resolution_status?: OfflineConflictResolutionStatus;
  resolution_note?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  created_at: string;
};

export const OFFLINE_ACTION_TYPES = [
  'maintenance_request.create',
  'maintenance_event.log',
  'qr_note.create',
  'calibration_request.create',
  'training_request.create',
  'department_issue.report',
  'store_reorder.create',
  'stock_receipt.draft',
  'stock_issue.draft',
  'work_order.start_intent',
  'work_order.complete_draft',
  'procurement.approve',
  'disposal.approve',
  'qr_token.regenerate',
  'user_settings.change',
  'security_settings.change',
  'analytics.refresh',
  'work_order.final_close',
  'work_order.assign_final',
  'replacement.decision',
] as const;

export type OfflineActionType = typeof OFFLINE_ACTION_TYPES[number];

export const OFFLINE_ACTION_CATEGORIES = [
  'additive_safe',
  'draft_requires_review',
  'state_change_requires_validation',
  'online_only',
] as const;

export type OfflineActionCategory = typeof OFFLINE_ACTION_CATEGORIES[number];

export type OfflineActionDefinition = {
  actionType: OfflineActionType;
  label: string;
  category: OfflineActionCategory;
  syncHandler: 'phase2' | 'not_implemented';
};

export const OFFLINE_ACTION_DEFINITIONS: Record<OfflineActionType, OfflineActionDefinition> = {
  'maintenance_request.create': {
    actionType: 'maintenance_request.create',
    label: 'Create maintenance request',
    category: 'additive_safe',
    syncHandler: 'phase2',
  },
  'maintenance_event.log': {
    actionType: 'maintenance_event.log',
    label: 'Log maintenance event',
    category: 'additive_safe',
    syncHandler: 'phase2',
  },
  'qr_note.create': {
    actionType: 'qr_note.create',
    label: 'Create QR note',
    category: 'additive_safe',
    syncHandler: 'phase2',
  },
  'calibration_request.create': {
    actionType: 'calibration_request.create',
    label: 'Create calibration request',
    category: 'additive_safe',
    syncHandler: 'phase2',
  },
  'training_request.create': {
    actionType: 'training_request.create',
    label: 'Create training request',
    category: 'additive_safe',
    syncHandler: 'phase2',
  },
  'department_issue.report': {
    actionType: 'department_issue.report',
    label: 'Report department issue',
    category: 'additive_safe',
    syncHandler: 'phase2',
  },
  'store_reorder.create': {
    actionType: 'store_reorder.create',
    label: 'Create store reorder',
    category: 'additive_safe',
    syncHandler: 'phase2',
  },
  'stock_receipt.draft': {
    actionType: 'stock_receipt.draft',
    label: 'Draft stock receipt',
    category: 'draft_requires_review',
    syncHandler: 'phase2',
  },
  'stock_issue.draft': {
    actionType: 'stock_issue.draft',
    label: 'Draft stock issue',
    category: 'draft_requires_review',
    syncHandler: 'phase2',
  },
  'work_order.start_intent': {
    actionType: 'work_order.start_intent',
    label: 'Record work-order start intent',
    category: 'state_change_requires_validation',
    syncHandler: 'phase2',
  },
  'work_order.complete_draft': {
    actionType: 'work_order.complete_draft',
    label: 'Draft work-order completion',
    category: 'draft_requires_review',
    syncHandler: 'phase2',
  },
  'procurement.approve': {
    actionType: 'procurement.approve',
    label: 'Approve procurement',
    category: 'online_only',
    syncHandler: 'not_implemented',
  },
  'disposal.approve': {
    actionType: 'disposal.approve',
    label: 'Approve disposal',
    category: 'online_only',
    syncHandler: 'not_implemented',
  },
  'qr_token.regenerate': {
    actionType: 'qr_token.regenerate',
    label: 'Regenerate QR token',
    category: 'online_only',
    syncHandler: 'not_implemented',
  },
  'user_settings.change': {
    actionType: 'user_settings.change',
    label: 'Change users or settings',
    category: 'online_only',
    syncHandler: 'not_implemented',
  },
  'security_settings.change': {
    actionType: 'security_settings.change',
    label: 'Change security settings',
    category: 'online_only',
    syncHandler: 'not_implemented',
  },
  'analytics.refresh': {
    actionType: 'analytics.refresh',
    label: 'Refresh analytics',
    category: 'online_only',
    syncHandler: 'not_implemented',
  },
  'work_order.final_close': {
    actionType: 'work_order.final_close',
    label: 'Final work-order closure',
    category: 'online_only',
    syncHandler: 'not_implemented',
  },
  'work_order.assign_final': {
    actionType: 'work_order.assign_final',
    label: 'Final work-order assignment',
    category: 'online_only',
    syncHandler: 'not_implemented',
  },
  'replacement.decision': {
    actionType: 'replacement.decision',
    label: 'Replacement decision',
    category: 'online_only',
    syncHandler: 'not_implemented',
  },
};

export type OfflineQueueRecord = {
  client_action_id: string;
  action_type: OfflineActionType;
  entity_type: string;
  entity_id?: string | null;
  asset_id?: string | null;
  qr_token?: string | null;
  payload: JsonSafeObject;
  created_by_profile_id?: string | null;
  role_name?: RoleName | string | null;
  source_route?: string | null;
  created_at: string;
  last_known_server_state?: JsonSafeObject | null;
  sync_status: OfflineSyncStatus;
  retry_count: number;
  last_error?: string | null;
  last_attempted_at?: string | null;
  synced_at?: string | null;
  conflict_reason?: string | null;
  conflict_detail?: OfflineConflictDetail | null;
  resolution_status?: OfflineConflictResolutionStatus | null;
  resolution_note?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  metadata?: JsonSafeObject | null;
};

export type OfflineQueueInput = {
  client_action_id?: string;
  action_type: OfflineActionType;
  entity_type: string;
  entity_id?: string | null;
  asset_id?: string | null;
  qr_token?: string | null;
  payload: JsonSafeObject;
  created_by_profile_id?: string | null;
  role_name?: RoleName | string | null;
  source_route?: string | null;
  last_known_server_state?: JsonSafeObject | null;
  metadata?: JsonSafeObject | null;
};

export type OfflineQueueFilter = {
  statuses?: OfflineSyncStatus[];
  actionTypes?: OfflineActionType[];
  entityType?: string;
  assetId?: string;
  conflictTypes?: OfflineConflictType[];
  roleNames?: string[];
  createdByProfileId?: string;
  createdFrom?: string;
  createdTo?: string;
};

export type OfflineQueueSummary = {
  total: number;
  queued: number;
  syncing: number;
  synced: number;
  failed: number;
  conflict: number;
  under_review: number;
  resolved_discarded: number;
  needs_review: number;
  lastCreatedAt?: string | null;
  lastAttemptedAt?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
};

export type OfflineActionRunResult<T = unknown> =
  | { status: 'success'; data: T }
  | { status: 'queued'; action: OfflineQueueRecord }
  | { status: 'failed'; error: string }
  | { status: 'conflict'; error: string; action?: OfflineQueueRecord };
