'use server';

import { z } from 'zod';
import { getActionContextForAnyCapability, logServerAuditEvent, actionError, type ActionResult } from './_shared';
import { createClient } from '@/lib/supabase/server';
import { maskQrToken } from '@/utils/qr/token';
import { createMaintenanceRequestAction, createMaintenanceEventAction, updateWorkOrderAction } from './maintenance.actions';
import { createCalibrationRequestAction } from './calibration.actions';
import { createTrainingRequestAction } from './training.actions';
import { createProcurementRequestAction } from './procurement.actions';
import { createStockIssueAction, createStockReceiptAction } from './spare-parts.actions';
import { canQueueOfflineAction } from '@/lib/offline/offline-permissions';
import {
  OFFLINE_ACTION_TYPES,
  type JsonSafeObject,
  type OfflineActionType,
  type OfflineConflictDetail,
} from '@/types/offline';
import {
  assetDeletedConflict,
  assetMissingConflict,
  departmentScopeConflict,
  duplicateOpenRequestConflict,
  insufficientStockConflict,
  partInactiveConflict,
  partMissingConflict,
  permissionDeniedConflict,
  procurementStateChangedConflict,
  unknownSyncErrorConflict,
  workOrderStatusChangedConflict,
  workOrderTerminalConflict,
} from '@/lib/offline/validation';
import { buildConflictDetail, summarizeLocalPayload } from '@/lib/offline/conflicts';

const offlineActionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['update_status', 'log_event']),
  workOrderId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

type SyncResult = { id: string; status: 'synced' | 'failed' | 'skipped'; error?: string };
type OfflineReplayResult = {
  status: 'synced' | 'failed' | 'conflict';
  error?: string;
  conflictReason?: string;
  conflictDetail?: OfflineConflictDetail;
  serverResult?: Record<string, unknown>;
};

const offlineSyncEventSchema = z.object({
  client_action_id: z.string().min(1),
  action_type: z.string().min(1),
  entity_type: z.string().min(1),
  entity_id: z.string().nullable().optional(),
  asset_id: z.string().nullable().optional(),
  qr_token: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
  role_name: z.string().nullable().optional(),
  queued_at: z.string().nullable().optional(),
  sync_status: z.enum(['pending', 'synced', 'failed', 'conflict', 'under_review', 'resolved_discarded']),
  error_message: z.string().nullable().optional(),
  conflict_reason: z.string().nullable().optional(),
  conflict_detail: z.record(z.string(), z.unknown()).nullable().optional(),
  resolution_status: z.string().nullable().optional(),
  source_route: z.string().nullable().optional(),
  retry_count: z.number().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const offlineQueueRecordSchema = z.object({
  client_action_id: z.string().min(1),
  action_type: z.enum(OFFLINE_ACTION_TYPES),
  entity_type: z.string().min(1),
  entity_id: z.string().nullable().optional(),
  asset_id: z.string().nullable().optional(),
  qr_token: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
  created_by_profile_id: z.string().nullable().optional(),
  role_name: z.string().nullable().optional(),
  source_route: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  last_known_server_state: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const departmentScopedActions = new Set<OfflineActionType>([
  'maintenance_request.create',
  'department_issue.report',
  'calibration_request.create',
  'training_request.create',
]);

const departmentRoles = new Set(['department_head', 'department_user']);

function replaySynced(serverResult?: Record<string, unknown>): ActionResult<OfflineReplayResult> {
  return { success: true, data: { status: 'synced', serverResult } };
}

function replayFailed(error: string): ActionResult<OfflineReplayResult> {
  return { success: true, data: { status: 'failed', error } };
}

function replayConflictDetail(detail: OfflineConflictDetail): ActionResult<OfflineReplayResult> {
  return { success: true, data: { status: 'conflict', conflictReason: detail.conflict_reason, conflictDetail: detail } };
}

function safeServerResult(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {};
  const row = data as Record<string, unknown>;
  return {
    id: typeof row.id === 'string' ? row.id : null,
    request_number: typeof row.request_number === 'string' ? row.request_number : null,
    work_order_number: typeof row.work_order_number === 'string' ? row.work_order_number : null,
    status: typeof row.status === 'string' ? row.status : null,
  };
}

async function loadReplayProfile(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { profile: null, error: 'Not authenticated' };

  const { data: profileRow, error: profileError } = await supabase
    .from('profiles')
    .select('id, user_id, full_name, email, department_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError || !profileRow) {
    return { profile: null, error: profileError?.message ?? 'Authenticated user is missing profile linkage' };
  }

  const { data: roleRows } = await supabase
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', profileRow.id as string);

  const roleNames = ((roleRows ?? []) as Array<Record<string, unknown>>)
    .map((row) => ((row.roles as { name?: string } | null)?.name ?? null))
    .filter(Boolean) as string[];

  return {
    profile: {
      id: profileRow.id as string,
      department_id: (profileRow.department_id as string | null) ?? null,
      roleNames,
    },
    error: null,
  };
}

async function resolveOfflineAsset(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  assetId?: string | null;
  qrToken?: string | null;
}) {
  const { supabase, assetId, qrToken } = params;
  if (assetId) {
    const { data, error } = await supabase
      .from('equipment_assets')
      .select('id, department_id, deleted_at, status')
      .eq('id', assetId)
      .maybeSingle();
    if (error) return { asset: null, conflict: unknownSyncErrorConflict(error.message) };
    const row = data as Record<string, unknown> | null;
    if (!row) return { asset: null, conflict: assetMissingConflict('Asset is missing at sync time') };
    if (row.deleted_at) return { asset: null, conflict: assetDeletedConflict() };
    return { asset: row as { id: string; department_id: string | null; status?: string | null }, conflict: null };
  }

  if (qrToken) {
    const { data, error } = await supabase
      .from('equipment_assets')
      .select('id, department_id, deleted_at, status, qr_label_status')
      .eq('qr_token', qrToken)
      .maybeSingle();
    if (error) return { asset: null, conflict: unknownSyncErrorConflict(error.message) };
    const row = data as Record<string, unknown> | null;
    if (!row) return { asset: null, conflict: assetMissingConflict('QR token no longer resolves to an active asset') };
    if (row.deleted_at) return { asset: null, conflict: assetDeletedConflict() };
    if (row.qr_label_status === 'revoked') return { asset: null, conflict: assetMissingConflict('QR token was revoked before sync') };
    return { asset: row as { id: string; department_id: string | null; status?: string | null }, conflict: null };
  }

  return { asset: null, conflict: assetMissingConflict('Offline action is missing an asset or QR token') };
}

function userNeedsDepartmentScope(roleNames: string[]) {
  return roleNames.some((role) => departmentRoles.has(role)) && !roleNames.some((role) => ['developer', 'admin', 'bme_head'].includes(role));
}

async function validateAssetAndDepartment(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  profile: { department_id: string | null; roleNames: string[] };
  actionType: OfflineActionType;
  assetId?: string | null;
  qrToken?: string | null;
}): Promise<{ asset: { id: string; department_id: string | null } | null; conflict: OfflineConflictDetail | null }> {
  const resolved = await resolveOfflineAsset({
    supabase: params.supabase,
    assetId: params.assetId ?? null,
    qrToken: params.qrToken ?? null,
  });

  if (resolved.conflict || !resolved.asset) {
    return { asset: null, conflict: resolved.conflict ?? assetMissingConflict('Asset unavailable') };
  }

  if (departmentScopedActions.has(params.actionType) && userNeedsDepartmentScope(params.profile.roleNames)) {
    if (!params.profile.department_id) {
      return { asset: null, conflict: departmentScopeConflict('Your profile is not linked to a department') };
    }
    if (resolved.asset.department_id !== params.profile.department_id) {
      return {
        asset: null,
        conflict: departmentScopeConflict('Asset is not in your department', {
          asset_id: resolved.asset.id,
          asset_department_id: resolved.asset.department_id ?? null,
          profile_department_id: params.profile.department_id,
        }),
      };
    }
  }

  return { asset: resolved.asset, conflict: null };
}

function stringValue(payload: Record<string, unknown>, key: string, fallback = '') {
  const value = payload[key];
  return typeof value === 'string' ? value : fallback;
}

function numberValue(payload: Record<string, unknown>, key: string, fallback = 0) {
  const value = payload[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function nullableString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function offlineSourceNote(action: z.infer<typeof offlineQueueRecordSchema>) {
  return [
    'Source: offline queue',
    action.source_route ? `Route: ${action.source_route}` : null,
    action.created_at ? `Queued at: ${action.created_at}` : null,
    `Client action: ${action.client_action_id}`,
  ].filter(Boolean).join('\n');
}

function mergeNotes(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).filter(Boolean).join('\n\n') || null;
}

async function replayMaintenanceRequest(params: {
  action: z.infer<typeof offlineQueueRecordSchema>;
  assetId: string;
  departmentId: string | null;
}) {
  const payload = params.action.payload;
  const result = await createMaintenanceRequestAction({
    asset_id: params.assetId,
    requested_by: null,
    department_id: params.departmentId,
    fault_description: stringValue(payload, 'fault_description') || stringValue(payload, 'description'),
    urgency: stringValue(payload, 'urgency', stringValue(payload, 'priority', 'medium')),
    status: 'pending',
    notes: mergeNotes(nullableString(payload, 'notes'), nullableString(payload, 'note'), offlineSourceNote(params.action)),
    reported_condition: nullableString(payload, 'reported_condition') ?? nullableString(payload, 'observed_condition'),
    reported_condition_source: stringValue(payload, 'reported_condition_source', params.action.qr_token ? 'offline-qr' : 'offline'),
  });

  if (result.success) return replaySynced(safeServerResult(result.data));
  const resultData = result.data as { reason?: string; existingRequestNumber?: string; existingRequestId?: string } | undefined;
  if (resultData?.reason === 'duplicate_open_request') {
    return replayConflictDetail(duplicateOpenRequestConflict(
      `Possible duplicate: ${resultData.existingRequestNumber ?? 'an open maintenance request'} already exists for this asset`,
      { id: resultData.existingRequestId, request_number: resultData.existingRequestNumber },
    ));
  }
  return replayFailed(result.error ?? 'Maintenance request sync failed');
}

async function replayCalibrationRequest(params: {
  action: z.infer<typeof offlineQueueRecordSchema>;
  assetId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const duplicate = await params.supabase
    .from('calibration_requests')
    .select('id, request_number, status')
    .eq('asset_id', params.assetId)
    .in('status', ['pending', 'approved', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (duplicate.data) {
    return replayConflictDetail(duplicateOpenRequestConflict(
      `Possible duplicate: calibration request ${(duplicate.data as { request_number?: string }).request_number ?? 'already open'} exists for this asset`,
      duplicate.data as Record<string, unknown>,
    ));
  }

  const payload = params.action.payload;
  const result = await createCalibrationRequestAction({
    asset_id: params.assetId,
    requested_by: null,
    calibration_type_id: nullableString(payload, 'calibration_type_id'),
    urgency: stringValue(payload, 'urgency', stringValue(payload, 'priority', 'medium')),
    status: 'pending',
    notes: mergeNotes(nullableString(payload, 'notes'), nullableString(payload, 'description'), offlineSourceNote(params.action)),
  });
  return result.success ? replaySynced(safeServerResult(result.data)) : replayFailed(result.error ?? 'Calibration request sync failed');
}

async function replayTrainingRequest(params: {
  action: z.infer<typeof offlineQueueRecordSchema>;
  assetId?: string | null;
  departmentId: string | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const payload = params.action.payload;
  const trainingType = stringValue(payload, 'training_type', 'equipment_operation');
  if (params.assetId) {
    const duplicate = await params.supabase
      .from('training_requests')
      .select('id, request_number, status')
      .eq('asset_id', params.assetId)
      .eq('training_type', trainingType)
      .in('status', ['pending', 'approved', 'scheduled'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (duplicate.data) {
      return replayConflictDetail(duplicateOpenRequestConflict(
        `Possible duplicate: training request ${(duplicate.data as { request_number?: string }).request_number ?? 'already open'} exists for this asset and training type`,
        duplicate.data as Record<string, unknown>,
      ));
    }
  }

  const result = await createTrainingRequestAction({
    asset_id: params.assetId ?? null,
    requested_by: null,
    department_id: params.departmentId,
    training_type: trainingType,
    description: stringValue(payload, 'description'),
    status: 'pending',
    notes: mergeNotes(nullableString(payload, 'notes'), offlineSourceNote(params.action)),
  });
  return result.success ? replaySynced(safeServerResult(result.data)) : replayFailed(result.error ?? 'Training request sync failed');
}

async function replayMaintenanceEvent(params: {
  action: z.infer<typeof offlineQueueRecordSchema>;
  assetId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  mode?: 'qr_note' | 'completion_draft';
}) {
  const payload = params.action.payload;
  const workOrderId = nullableString(payload, 'work_order_id') ?? params.action.entity_id ?? null;

  if (workOrderId) {
    const { data: workOrder } = await params.supabase
      .from('work_orders')
      .select('id, status, asset_id, completion_outcome')
      .eq('id', workOrderId)
      .maybeSingle();
    if (!workOrder) return replayConflictDetail(workOrderStatusChangedConflict('Work order no longer exists', null));
    const wo = workOrder as Record<string, unknown>;
    if (wo.status === 'completed' || wo.status === 'canceled') {
      return replayConflictDetail(workOrderTerminalConflict(wo));
    }
  }

  const partsNeeded = payload.parts_needed && typeof payload.parts_needed === 'object'
    ? JSON.stringify(payload.parts_needed)
    : nullableString(payload, 'parts_needed');
  const prefix = params.mode === 'completion_draft'
    ? 'Offline completion draft'
    : params.mode === 'qr_note'
      ? 'Offline QR note'
      : partsNeeded
        ? 'Parts needed / awaiting parts'
        : 'Offline maintenance note';
  const notes = mergeNotes(
    prefix,
    nullableString(payload, 'note'),
    nullableString(payload, 'notes'),
    nullableString(payload, 'observed_condition') ? `Observed condition: ${nullableString(payload, 'observed_condition')}` : null,
    partsNeeded ? `Parts needed: ${partsNeeded}` : null,
    offlineSourceNote(params.action),
  );

  const result = await createMaintenanceEventAction({
    work_order_id: workOrderId,
    asset_id: params.assetId,
    event_type: stringValue(payload, 'event_type', 'inspection'),
    failure_date: nullableString(payload, 'timestamp') ?? nullableString(payload, 'failure_date') ?? new Date().toISOString(),
    downtime_start: null,
    downtime_end: null,
    repair_duration_hours: payload.repair_duration_hours ?? null,
    action_taken: stringValue(payload, 'action_taken', prefix),
    failure_code_id: null,
    action_code_id: null,
    service_cost: payload.service_cost ?? null,
    completed_by: null,
    completion_date: params.mode === 'completion_draft' ? new Date().toISOString() : null,
    notes,
  });

  return result.success ? replaySynced(safeServerResult(result.data)) : replayFailed(result.error ?? 'Maintenance event sync failed');
}

async function replayWorkStartIntent(params: {
  action: z.infer<typeof offlineQueueRecordSchema>;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const workOrderId = params.action.entity_id ?? nullableString(params.action.payload, 'work_order_id');
  if (!workOrderId) return replayConflictDetail(workOrderStatusChangedConflict('Work start intent is missing a work order', null));
  const { data: workOrder } = await params.supabase
    .from('work_orders')
    .select('id, status, started_at, assigned_to')
    .eq('id', workOrderId)
    .maybeSingle();
  if (!workOrder) return replayConflictDetail(workOrderStatusChangedConflict('Work order no longer exists', null));
  const wo = workOrder as Record<string, unknown>;
  const status = wo.status as string | null | undefined;
  if (status === 'completed' || status === 'canceled') return replayConflictDetail(workOrderTerminalConflict(wo));
  if (status === 'in_progress') return replayConflictDetail(workOrderStatusChangedConflict('Work order was already started before sync', wo));

  const result = await updateWorkOrderAction(workOrderId, {
    status: 'in_progress',
    started_at: new Date().toISOString(),
    action_taken: mergeNotes(nullableString(params.action.payload, 'note'), offlineSourceNote(params.action)),
  });
  return result.success ? replaySynced(safeServerResult(result.data)) : replayFailed(result.error ?? 'Work start intent sync failed');
}

async function replayStoreReorder(params: {
  action: z.infer<typeof offlineQueueRecordSchema>;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const payload = params.action.payload;
  const partId = nullableString(payload, 'part_id');
  let part: Record<string, unknown> | null = null;
  if (partId) {
    const { data } = await params.supabase
      .from('spare_parts')
      .select('id, part_code, name, current_stock, reorder_level, is_active')
      .eq('id', partId)
      .maybeSingle();
    if (!data) return replayConflictDetail(partMissingConflict());
    if ((data as { is_active?: boolean }).is_active === false) return replayConflictDetail(partInactiveConflict());
    part = data as Record<string, unknown>;

    const { data: existing } = await params.supabase
      .from('procurement_requests')
      .select('id, request_number, title, status')
      .ilike('title', `%${String(part.name ?? '')}%`)
      .in('status', ['requested', 'approved', 'ordered', 'in_transit'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      return replayConflictDetail(duplicateOpenRequestConflict(
        `Possible duplicate: procurement request ${(existing as { request_number?: string }).request_number ?? 'already open'} exists for this part`,
        existing as Record<string, unknown>,
      ));
    }
  }

  const partName = stringValue(payload, 'part_name', String(part?.name ?? 'spare part'));
  const quantity = numberValue(payload, 'requested_quantity', numberValue(payload, 'quantity', 1));
  if (quantity <= 0) return replayConflictDetail(buildConflictDetail({
    conflict_type: 'invalid_payload',
    conflict_reason: 'Reorder draft has an invalid requested quantity',
    local_payload_summary: summarizeLocalPayload(payload as JsonSafeObject, ['requested_quantity', 'quantity']),
  }));
  const result = await createProcurementRequestAction({
    title: `Procure ${partName}`,
    justification: mergeNotes(
      stringValue(payload, 'reason', 'Offline reorder request'),
      part ? `Part: ${part.part_code ?? ''} ${part.name ?? ''}` : nullableString(payload, 'part_description'),
      `Requested quantity: ${quantity}`,
      payload.current_stock_snapshot != null ? `Offline stock snapshot: ${String(payload.current_stock_snapshot)}` : null,
      payload.reorder_level_snapshot != null ? `Reorder snapshot: ${String(payload.reorder_level_snapshot)}` : null,
      partId ? `Linked spare part: ${partId}` : null,
      offlineSourceNote(params.action),
    ) ?? 'Offline reorder request',
    status: 'requested',
    priority: stringValue(payload, 'urgency', stringValue(payload, 'priority', 'medium')),
    requested_by: null,
    department_id: null,
    expected_delivery_date: null,
  });
  return result.success ? replaySynced(safeServerResult(result.data)) : replayFailed(result.error ?? 'Reorder request sync failed');
}

async function replayStockReceiptDraft(params: {
  action: z.infer<typeof offlineQueueRecordSchema>;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const payload = params.action.payload;
  const partId = nullableString(payload, 'part_id');
  if (!partId) return replayConflictDetail(buildConflictDetail({
    conflict_type: 'invalid_payload',
    conflict_reason: 'Stock receipt draft is missing part_id',
  }));
  const { data: part } = await params.supabase
    .from('spare_parts')
    .select('id, is_active, part_code, name, current_stock')
    .eq('id', partId)
    .maybeSingle();
  if (!part) return replayConflictDetail(partMissingConflict());
  if ((part as { is_active?: boolean }).is_active === false) return replayConflictDetail(partInactiveConflict());
  const procurementId = nullableString(payload, 'procurement_request_id');
  if (procurementId) {
    const { data: proc } = await params.supabase
      .from('procurement_requests')
      .select('id, request_number, status')
      .eq('id', procurementId)
      .maybeSingle();
    if (!proc) {
      return replayConflictDetail(procurementStateChangedConflict('Linked procurement request no longer exists', null));
    }
    return replayConflictDetail(procurementStateChangedConflict(
      'Receipt drafts linked to procurement need manual review (stock_receipts table does not yet expose procurement_request_id)',
      proc as Record<string, unknown>,
    ));
  }
  const quantity = numberValue(payload, 'quantity_received', numberValue(payload, 'quantity', 0));
  if (quantity <= 0) return replayConflictDetail(buildConflictDetail({
    conflict_type: 'invalid_payload',
    conflict_reason: 'Stock receipt draft has an invalid quantity',
    local_payload_summary: summarizeLocalPayload(payload as JsonSafeObject, ['quantity_received', 'quantity']),
  }));

  const result = await createStockReceiptAction({
    part_id: partId,
    quantity,
    received_by: null,
    received_date: nullableString(payload, 'received_date') ?? new Date().toISOString().slice(0, 10),
    supplier_id: null,
    invoice_ref: nullableString(payload, 'invoice_ref'),
    unit_cost: payload.unit_cost ?? null,
    notes: mergeNotes(nullableString(payload, 'note'), offlineSourceNote(params.action)),
  });
  return result.success ? replaySynced(safeServerResult(result.data)) : replayFailed(result.error ?? 'Stock receipt draft sync failed');
}

async function replayStockIssueDraft(params: {
  action: z.infer<typeof offlineQueueRecordSchema>;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const payload = params.action.payload;
  const partId = nullableString(payload, 'part_id');
  if (!partId) return replayConflictDetail(buildConflictDetail({
    conflict_type: 'invalid_payload',
    conflict_reason: 'Stock issue draft is missing part_id',
  }));
  const quantity = numberValue(payload, 'quantity_issued', numberValue(payload, 'quantity', 0));
  if (quantity <= 0) return replayConflictDetail(buildConflictDetail({
    conflict_type: 'invalid_payload',
    conflict_reason: 'Stock issue draft has an invalid quantity',
    local_payload_summary: summarizeLocalPayload(payload as JsonSafeObject, ['quantity_issued', 'quantity']),
  }));
  const { data: part } = await params.supabase
    .from('spare_parts')
    .select('id, current_stock, is_active, part_code, name, reorder_level')
    .eq('id', partId)
    .maybeSingle();
  if (!part) return replayConflictDetail(partMissingConflict());
  if ((part as { is_active?: boolean }).is_active === false) return replayConflictDetail(partInactiveConflict());
  if (Number((part as { current_stock?: number | null }).current_stock ?? 0) < quantity) {
    return replayConflictDetail(insufficientStockConflict(part as Record<string, unknown>, quantity));
  }

  const workOrderId = nullableString(payload, 'work_order_id');
  if (workOrderId) {
    const { data: workOrder } = await params.supabase
      .from('work_orders')
      .select('id, status, asset_id')
      .eq('id', workOrderId)
      .maybeSingle();
    if (!workOrder) return replayConflictDetail(workOrderStatusChangedConflict('Linked work order no longer exists', null));
    const wo = workOrder as Record<string, unknown>;
    const status = wo.status as string | null | undefined;
    if (status === 'completed' || status === 'canceled') return replayConflictDetail(workOrderTerminalConflict(wo));
  }

  const result = await createStockIssueAction({
    part_id: partId,
    quantity,
    issued_to_event_id: null,
    issued_by: null,
    issue_date: nullableString(payload, 'issue_date') ?? new Date().toISOString().slice(0, 10),
    department_id: nullableString(payload, 'department_id'),
    notes: mergeNotes(
      nullableString(payload, 'note'),
      workOrderId ? `Linked work order: ${workOrderId}` : null,
      nullableString(payload, 'issued_to') ? `Issued to: ${nullableString(payload, 'issued_to')}` : null,
      payload.local_stock_snapshot != null ? `Offline stock snapshot: ${String(payload.local_stock_snapshot)}` : null,
      offlineSourceNote(params.action),
    ),
  });
  return result.success ? replaySynced(safeServerResult(result.data)) : replayFailed(result.error ?? 'Stock issue draft sync failed');
}

export async function syncOfflineQueuedActionAction(input: unknown): Promise<ActionResult<OfflineReplayResult>> {
  try {
    const action = offlineQueueRecordSchema.parse(input);
    const supabase = await createClient();
    const { profile, error } = await loadReplayProfile(supabase);
    if (error || !profile) return { success: false, error };

    if (!canQueueOfflineAction(profile.roleNames, action.action_type)) {
      return replayConflictDetail(permissionDeniedConflict(action.action_type, profile.roleNames[0]));
    }

    const needsAsset = !['store_reorder.create', 'stock_receipt.draft', 'stock_issue.draft', 'training_request.create'].includes(action.action_type);
    let resolvedAsset: { id: string; department_id: string | null } | null = null;
    if (needsAsset || action.asset_id || action.qr_token) {
      const validated = await validateAssetAndDepartment({
        supabase,
        profile,
        actionType: action.action_type,
        assetId: action.asset_id ?? nullableString(action.payload, 'asset_id'),
        qrToken: action.qr_token ?? nullableString(action.payload, 'qr_token'),
      });
      if (validated.conflict || !validated.asset) {
        return replayConflictDetail(validated.conflict ?? assetMissingConflict('Asset unavailable'));
      }
      resolvedAsset = validated.asset;
    }

    switch (action.action_type) {
      case 'maintenance_request.create':
      case 'department_issue.report':
        return replayMaintenanceRequest({ action, assetId: resolvedAsset!.id, departmentId: resolvedAsset!.department_id });
      case 'calibration_request.create':
        return replayCalibrationRequest({ action, assetId: resolvedAsset!.id, supabase });
      case 'training_request.create':
        return replayTrainingRequest({
          action,
          assetId: resolvedAsset?.id ?? nullableString(action.payload, 'asset_id'),
          departmentId: resolvedAsset?.department_id ?? profile.department_id,
          supabase,
        });
      case 'maintenance_event.log':
        return replayMaintenanceEvent({ action, assetId: resolvedAsset!.id, supabase });
      case 'qr_note.create':
        return replayMaintenanceEvent({ action, assetId: resolvedAsset!.id, supabase, mode: 'qr_note' });
      case 'work_order.start_intent':
        return replayWorkStartIntent({ action, supabase });
      case 'work_order.complete_draft':
        return replayMaintenanceEvent({ action, assetId: resolvedAsset!.id, supabase, mode: 'completion_draft' });
      case 'store_reorder.create':
        return replayStoreReorder({ action, supabase });
      case 'stock_receipt.draft':
        return replayStockReceiptDraft({ action, supabase });
      case 'stock_issue.draft':
        return replayStockIssueDraft({ action, supabase });
      default:
        return replayFailed(`No Phase 2 sync handler is registered for ${action.action_type}`);
    }
  } catch (err) {
    return actionError(err, 'Failed to replay offline action') as ActionResult<OfflineReplayResult>;
  }
}

export async function recordOfflineSyncEventAction(input: unknown): Promise<ActionResult<{ status: string }>> {
  try {
    const parsed = offlineSyncEventSchema.parse(input);
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { success: false, error: 'Not authenticated' };

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return { success: false, error: profileError?.message ?? 'Authenticated user is missing profile linkage' };
    }

    const reportedStatus = parsed.sync_status;
    const isOpenConflict = reportedStatus === 'conflict' || reportedStatus === 'under_review';
    const isDiscarded = reportedStatus === 'resolved_discarded';
    // CHECK on sync_status now (post-00046) accepts all Phase 3 statuses;
    // pre-migration databases still only accept pending/synced/failed, so we
    // collapse Phase 3 statuses to `failed` (open conflicts) / `synced`
    // (manual_resolved → synced) / `synced` (resolved_synced). Migration 00046
    // expands the CHECK so the same write keeps the original status going
    // forward; either way, `reported_status` carries the precise state.
    const dbStatus = isOpenConflict || isDiscarded ? 'failed' : reportedStatus;
    const eventPayload = {
      offline_payload: parsed.payload,
      asset_id: parsed.asset_id ?? null,
      masked_qr_token: parsed.qr_token ? maskQrToken(parsed.qr_token) : null,
      role_name: parsed.role_name ?? null,
      queued_at: parsed.queued_at ?? null,
      error_message: parsed.error_message ?? null,
      conflict_reason: parsed.conflict_reason ?? null,
      conflict_detail: parsed.conflict_detail ?? null,
      resolution_status: parsed.resolution_status ?? null,
      source_route: parsed.source_route ?? null,
      reported_status: reportedStatus,
      retry_count: parsed.retry_count ?? null,
      phase: 'offline.phase3.workflow-replay',
      schema_note: 'Phase 3: reported_status, conflict_detail, role_name, source_route, asset_id, retry_count, and error_message also stored as first-class columns after migration 00046.',
      metadata: parsed.metadata ?? null,
    };
    const conflictType = parsed.conflict_detail
      ? (parsed.conflict_detail as Record<string, unknown>).conflict_type as string | undefined
      : undefined;

    const insertRow = {
      client_action_id: parsed.client_action_id,
      actor_user_id: profile.id,
      entity_type: parsed.entity_type,
      entity_id: parsed.entity_id ?? null,
      action_type: parsed.action_type,
      payload: eventPayload,
      sync_status: dbStatus,
      synced_at: dbStatus === 'synced' ? new Date().toISOString() : null,
      // First-class columns (migration 00046). Pre-migration DBs ignore unknown
      // columns? No — Postgres will reject unknown columns. The migration must
      // run before this insert path; tests/CI run db push before the build.
      reported_status: reportedStatus,
      resolution_status: parsed.resolution_status ?? null,
      conflict_type: conflictType ?? null,
      conflict_reason: parsed.conflict_reason ?? null,
      error_message: parsed.error_message ?? null,
      role_name: parsed.role_name ?? null,
      source_route: parsed.source_route ?? null,
      asset_id: parsed.asset_id ?? null,
      retry_count: parsed.retry_count ?? null,
    };

    const { error } = await supabase.from('offline_sync_events').insert(insertRow as never);

    if (error) return { success: false, error: error.message };

    await logServerAuditEvent({
      supabase,
      profileId: profile.id as string,
      action: `offline_sync.${parsed.sync_status}`,
      entityType: 'offline_sync_events',
      entityId: parsed.client_action_id,
      details: {
        action_type: parsed.action_type,
        entity_type: parsed.entity_type,
        entity_id: parsed.entity_id ?? null,
        asset_id: parsed.asset_id ?? null,
        source_route: parsed.source_route ?? null,
        error_message: parsed.error_message ?? null,
        conflict_reason: parsed.conflict_reason ?? null,
      },
    });

    return { success: true, data: { status: dbStatus } };
  } catch (err) {
    return actionError(err, 'Failed to record offline sync event') as ActionResult<{ status: string }>;
  }
}

const resolutionSchema = z.object({
  client_action_id: z.string().min(1),
  resolution: z.enum(['under_review', 'discarded', 'manual_resolved']),
  note: z.string().nullable().optional(),
  action_type: z.string().nullable().optional(),
});

export async function recordOfflineConflictResolutionAction(input: unknown): Promise<ActionResult<{ resolution: string }>> {
  try {
    const parsed = resolutionSchema.parse(input);
    const { supabase, profile, error } = await getActionContextForAnyCapability(['audit.view']);
    if (error || !profile) return { success: false, error };

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: `offline_sync.resolution.${parsed.resolution}`,
      entityType: 'offline_sync_events',
      entityId: parsed.client_action_id,
      details: {
        action_type: parsed.action_type ?? null,
        note: parsed.note ?? null,
        resolved_by_profile_id: profile.id,
      },
    });

    // Best-effort: append a synthetic event row so the resolution is visible
    // server-side even if the original sync did not write a row (e.g., user
    // discarded the action entirely before ever attempting a sync).
    const eventPayload = {
      offline_payload: {},
      asset_id: null,
      masked_qr_token: null,
      role_name: profile.roleNames[0] ?? null,
      queued_at: null,
      error_message: null,
      conflict_reason: parsed.note ?? null,
      conflict_detail: null,
      resolution_status: parsed.resolution,
      source_route: '/offline-sync',
      reported_status: parsed.resolution === 'manual_resolved' ? 'resolved_synced' : parsed.resolution === 'discarded' ? 'resolved_discarded' : 'under_review',
      phase: 'offline.phase3.resolution',
      schema_note: 'Resolution audit row. offline_sync_events.sync_status reflects pending/synced/failed only; resolution detail lives in payload.',
      metadata: { resolved_by_profile_id: profile.id, note: parsed.note ?? null },
    };

    const reportedStatus = parsed.resolution === 'manual_resolved'
      ? 'resolved_synced'
      : parsed.resolution === 'discarded'
        ? 'resolved_discarded'
        : 'under_review';

    await supabase.from('offline_sync_events').insert({
      client_action_id: parsed.client_action_id,
      actor_user_id: profile.id,
      entity_type: 'offline_sync_events',
      entity_id: parsed.client_action_id,
      action_type: parsed.action_type ?? 'offline.resolution',
      payload: eventPayload,
      sync_status: parsed.resolution === 'manual_resolved' ? 'synced' : 'failed',
      synced_at: parsed.resolution === 'manual_resolved' ? new Date().toISOString() : null,
      reported_status: reportedStatus,
      resolution_status: parsed.resolution,
      conflict_reason: parsed.note ?? null,
      role_name: profile.roleNames[0] ?? null,
      source_route: '/offline-sync',
      resolved_by: profile.id,
      resolved_at: new Date().toISOString(),
    } as never);

    return { success: true, data: { resolution: parsed.resolution } };
  } catch (err) {
    return actionError(err, 'Failed to record offline conflict resolution') as ActionResult<{ resolution: string }>;
  }
}

export async function syncOfflineWorkOrderActionsAction(items: unknown[]): Promise<ActionResult<SyncResult[]>> {
  try {
    // Offline sync replays work-order events; any WO-execution capability suffices.
    const { supabase, profile, error } = await getActionContextForAnyCapability([
      'work_order.start',
      'work_order.complete',
      'work_order.add_event',
    ]);
    if (error || !profile) return { success: false, error };
    const parsedItems = z.array(offlineActionSchema).parse(items);
    const results: SyncResult[] = [];

    for (const item of parsedItems) {
      const existing = await supabase
        .from('offline_sync_events')
        .select('id, sync_status')
        .eq('client_action_id', item.id)
        .eq('sync_status', 'synced')
        .maybeSingle();

      if (existing.data) {
        results.push({ id: item.id, status: 'skipped' });
        continue;
      }

      const actionResult = item.type === 'update_status'
        ? await updateWorkOrderAction(item.workOrderId, { ...item.payload, status: item.payload.status })
        : await createMaintenanceEventAction({ ...item.payload, work_order_id: item.workOrderId });

      const syncStatus = actionResult.success ? 'synced' : 'failed';
      await supabase.from('offline_sync_events').insert({
        client_action_id: item.id,
        actor_user_id: profile.id,
        entity_type: 'work_orders',
        entity_id: item.workOrderId,
        action_type: item.type,
        payload: item.payload,
        sync_status: syncStatus,
        synced_at: actionResult.success ? new Date().toISOString() : null,
      } as never);

      await logServerAuditEvent({
        supabase,
        profileId: profile.id,
        action: `offline_sync.${syncStatus}`,
        entityType: 'offline_sync_events',
        entityId: item.id,
        details: { action_type: item.type, work_order_id: item.workOrderId, error: actionResult.error ?? null },
      });

      results.push({ id: item.id, status: syncStatus, error: actionResult.error });
    }

    return { success: results.every((result) => result.status !== 'failed'), data: results };
  } catch (err) {
    return actionError(err, 'Failed to sync offline work-order actions') as ActionResult<SyncResult[]>;
  }
}
