'use server';

import { z } from 'zod';
import { recomputeAssetAnalytics } from './analytics.actions';
import { updateEquipmentConditionAction } from './equipment.actions';
import { getActionContextForCapability, getActionContextForAnyCapability, logServerAuditEvent, revalidateMany, actionError, nullIfEmpty, interpretMissingMutationResult, type ActionResult } from './_shared';
import { OPEN_MAINTENANCE_REQUEST_STATUSES, OPEN_WORK_ORDER_STATUSES } from '@/utils/maintenance/request-status';
import { requiredCapabilityForWorkOrderTransition } from '@/utils/maintenance/work-order-transitions';
import {
  deriveReliabilityEvidence,
  shouldAlwaysWriteCompletionEvent,
} from '@/utils/maintenance/completion-evidence';
import {
  NOTIFICATION_DELIVERY_REVIEW_WARNING,
  createNotificationEvent,
  makeFailedNotificationResult,
  notificationDeliveryNeedsReview,
  notificationProcessSnapshot,
  notificationReviewDetail,
} from '@/services/notifications/notification-engine';
import type { NotificationProcessResult } from '@/types/notifications';

function notificationReviewData(
  result: NotificationProcessResult | null | undefined,
): Record<string, unknown> {
  if (!notificationDeliveryNeedsReview(result)) return {};
  return {
    notification_warning: NOTIFICATION_DELIVERY_REVIEW_WARNING,
    notification_warning_detail: notificationReviewDetail(result),
    notification_result: result ? notificationProcessSnapshot(result) : null,
  };
}

function firstNotificationReviewData(results: NotificationProcessResult[]): Record<string, unknown> {
  return notificationReviewData(results.find((result) => notificationDeliveryNeedsReview(result)));
}

async function loadAssetSummaryForNotification(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  assetId: string | null | undefined,
): Promise<{ asset_name: string | null; asset_code: string | null; department_id: string | null }> {
  if (!assetId) return { asset_name: null, asset_code: null, department_id: null };
  const { data } = await supabase
    .from('equipment_assets')
    .select('name, asset_code, department_id')
    .eq('id', assetId)
    .maybeSingle();
  const row = (data ?? null) as { name?: string | null; asset_code?: string | null; department_id?: string | null } | null;
  return {
    asset_name: row?.name ?? null,
    asset_code: row?.asset_code ?? null,
    department_id: row?.department_id ?? null,
  };
}

const requestSchema = z.object({
  asset_id: z.string().min(1),
  requested_by: z.string().optional().nullable(),
  department_id: z.string().optional().nullable(),
  fault_description: z.string().trim().min(10),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['pending', 'approved', 'assigned', 'in_progress', 'completed', 'rejected', 'canceled']).optional(),
  notes: z.string().optional().nullable(),
  // Stored for audit: what condition the requester observed at time of request creation.
  // functional_issue = equipment works but has a problem (no condition change to equipment_assets).
  // needs_repair / non_functional = synced to equipment_assets.condition.
  reported_condition: z.enum(['functional_issue', 'needs_repair', 'non_functional']).optional().nullable(),
  reported_condition_source: z.string().optional().nullable(),
});

const workOrderSchema = z.object({
  request_id: z.string().optional().nullable(),
  asset_id: z.string().min(1),
  assigned_to: z.string().optional().nullable(),
  status: z.enum(['open', 'assigned', 'in_progress', 'on_hold', 'completed', 'canceled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  work_type: z.enum(['corrective', 'preventive', 'inspection', 'calibration', 'installation']),
  root_cause: z.string().optional().nullable(),
  action_taken: z.string().optional().nullable(),
  external_vendor: z.boolean().optional(),
  external_vendor_name: z.string().optional().nullable(),
  closure_notes: z.string().optional().nullable(),
  estimated_hours: z.coerce.number().optional().nullable(),
  actual_hours: z.coerce.number().optional().nullable(),
  started_at: z.string().optional().nullable(),
  completed_at: z.string().optional().nullable(),
  // Completion outcome fields (migration 00039)
  completion_outcome: z.enum(['resolved', 'partially_resolved', 'not_resolved', 'awaiting_parts_or_vendor']).optional().nullable(),
  final_equipment_condition: z.enum(['functional', 'needs_repair', 'non_functional', 'under_maintenance']).optional().nullable(),
});

const eventSchema = z.object({
  work_order_id: z.string().optional().nullable(),
  asset_id: z.string().min(1),
  event_type: z.enum(['corrective', 'preventive', 'inspection', 'emergency']),
  failure_date: z.string().optional().nullable(),
  downtime_start: z.string().optional().nullable(),
  downtime_end: z.string().optional().nullable(),
  repair_duration_hours: z.coerce.number().optional().nullable(),
  action_taken: z.string().optional().nullable(),
  failure_code_id: z.string().optional().nullable(),
  action_code_id: z.string().optional().nullable(),
  service_cost: z.coerce.number().optional().nullable(),
  completed_by: z.string().optional().nullable(),
  completion_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const maintenancePaths = ['/maintenance', '/work-orders', '/calendar', '/command', '/reports/maintenance', '/equipment'];

const requestTerminalStatuses = ['completed', 'rejected', 'canceled'] as const;

function isTerminalRequestStatus(status: string | null | undefined): boolean {
  return !!status && (requestTerminalStatuses as readonly string[]).includes(status);
}

// Completion outcome → default final equipment condition
function outcomeToCondition(outcome: string): 'functional' | 'needs_repair' | 'non_functional' | 'under_maintenance' {
  switch (outcome) {
    case 'resolved': return 'functional';
    case 'partially_resolved': return 'needs_repair';
    case 'not_resolved': return 'non_functional';
    case 'awaiting_parts_or_vendor': return 'under_maintenance';
    default: return 'functional';
  }
}

function normalizeWorkOrder(payload: Record<string, unknown>) {
  const parsed = workOrderSchema.parse(payload);
  return {
    ...parsed,
    request_id: nullIfEmpty(parsed.request_id),
    assigned_to: nullIfEmpty(parsed.assigned_to),
    root_cause: nullIfEmpty(parsed.root_cause),
    action_taken: nullIfEmpty(parsed.action_taken),
    external_vendor: parsed.external_vendor ?? false,
    external_vendor_name: nullIfEmpty(parsed.external_vendor_name),
    closure_notes: nullIfEmpty(parsed.closure_notes),
    estimated_hours: parsed.estimated_hours ?? null,
    actual_hours: parsed.actual_hours ?? null,
    started_at: nullIfEmpty(parsed.started_at),
    completed_at: nullIfEmpty(parsed.completed_at),
    completion_outcome: parsed.completion_outcome ?? null,
    final_equipment_condition: parsed.final_equipment_condition ?? null,
  };
}

function normalizePartialWorkOrder(payload: Record<string, unknown>) {
  const parsed = workOrderSchema.partial().parse(payload);
  return {
    ...parsed,
    request_id: parsed.request_id === undefined ? undefined : nullIfEmpty(parsed.request_id),
    assigned_to: parsed.assigned_to === undefined ? undefined : nullIfEmpty(parsed.assigned_to),
    root_cause: parsed.root_cause === undefined ? undefined : nullIfEmpty(parsed.root_cause),
    action_taken: parsed.action_taken === undefined ? undefined : nullIfEmpty(parsed.action_taken),
    external_vendor_name: parsed.external_vendor_name === undefined ? undefined : nullIfEmpty(parsed.external_vendor_name),
    closure_notes: parsed.closure_notes === undefined ? undefined : nullIfEmpty(parsed.closure_notes),
    estimated_hours: parsed.estimated_hours === undefined ? undefined : parsed.estimated_hours ?? null,
    actual_hours: parsed.actual_hours === undefined ? undefined : parsed.actual_hours ?? null,
    started_at: parsed.started_at === undefined ? undefined : nullIfEmpty(parsed.started_at),
    completed_at: parsed.completed_at === undefined ? undefined : nullIfEmpty(parsed.completed_at),
  };
}

type MaintenanceActionClient = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

function translateMaintenanceEventWriteError(rawError: string): string {
  if (/no unique or exclusion constraint matching the ON CONFLICT specification/i.test(rawError)) {
    return 'Work order could not record reliability evidence because the maintenance-event uniqueness rule is not configured. Please contact Developer/BME system admin.';
  }
  if (/row-level security|new row violates/i.test(rawError)) {
    return 'Reliability evidence could not be recorded on maintenance_events (row-level security blocked the write). Verify migration 00068 is applied and that the user has work_order.complete capability.';
  }
  return `Reliability evidence could not be recorded on maintenance_events: ${rawError}`;
}

async function recordWorkOrderReliabilityEvidence({
  supabase,
  profileId,
  workOrderId,
  assetId,
  eventPayload,
  auditValues,
}: {
  supabase: MaintenanceActionClient;
  profileId: string;
  workOrderId: string;
  assetId: string;
  eventPayload: Record<string, unknown>;
  auditValues: Record<string, unknown>;
}): Promise<{ eventId: string | null; warning: string | null }> {
  const existing = await supabase
    .from('maintenance_events')
    .select('id')
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const existingId = (existing.data as { id?: string } | null)?.id ?? null;
  const upsert = await supabase
    .from('maintenance_events')
    .upsert(eventPayload as never, { onConflict: 'work_order_id' })
    .select('id')
    .maybeSingle();

  if (upsert.error || !upsert.data) {
    const rawError = upsert.error?.message ?? 'Upsert returned 0 rows.';
    const warning = translateMaintenanceEventWriteError(rawError);
    console.error('[maintenance] reliability evidence UPSERT failed:', {
      workOrderId,
      assetId,
      profileId,
      postgrestError: rawError,
    });
    await logServerAuditEvent({
      supabase,
      profileId,
      action: 'work_order.reliability_evidence_write_failed',
      entityType: 'work_orders',
      entityId: workOrderId,
      details: {
        asset_id: assetId,
        mode: existingId ? 'upsert_update' : 'upsert_insert',
        postgrest_error: rawError,
      },
    });
    return { eventId: null, warning };
  }

  const eventId = (upsert.data as { id?: string }).id ?? null;
  await logServerAuditEvent({
    supabase,
    profileId,
    action: existingId
      ? 'maintenance_event.updated_from_work_order_completion'
      : 'maintenance_event.created_from_work_order_completion',
    entityType: 'maintenance_events',
    entityId: eventId,
    newValues: auditValues,
  });

  return { eventId, warning: null };
}

async function emitMaintenanceRequestStatusChanged(params: {
  supabase: MaintenanceActionClient;
  requestRow: {
    id?: string | null;
    asset_id?: string | null;
    request_number?: string | null;
    requested_by?: string | null;
    department_id?: string | null;
  };
  status: string;
  priority?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  payload?: Record<string, unknown>;
}): Promise<NotificationProcessResult> {
  const assetSummary = await loadAssetSummaryForNotification(params.supabase, params.requestRow.asset_id ?? null);
  return createNotificationEvent({
    event_type: 'maintenance_request.status_changed',
    source_table: 'maintenance_requests',
    source_id: params.requestRow.id ?? null,
    asset_id: params.requestRow.asset_id ?? null,
    department_id: params.requestRow.department_id ?? assetSummary.department_id ?? null,
    priority: params.priority ?? (params.status === 'rejected' ? 'high' : 'medium'),
    payload: {
      asset_name: assetSummary.asset_name,
      asset_code: assetSummary.asset_code,
      request_number: params.requestRow.request_number ?? null,
      status: params.status,
      requested_by: params.requestRow.requested_by ?? null,
      ...params.payload,
    },
  });
}

async function syncLinkedRequestStatusFromWorkOrder(params: {
  supabase: MaintenanceActionClient;
  profileId: string;
  workOrder: {
    id?: string | null;
    request_id?: string | null;
    asset_id?: string | null;
    work_order_number?: string | null;
  };
  nextStatus: 'assigned' | 'in_progress' | 'completed';
  auditAction?: string;
  notificationPayload?: Record<string, unknown>;
}): Promise<{ warning: string | null; notificationResult: NotificationProcessResult | null }> {
  const requestId = params.workOrder.request_id;
  if (!requestId) return { warning: null, notificationResult: null };

  const requestRow = await params.supabase
    .from('maintenance_requests')
    .select('id, status, request_number, requested_by, department_id, asset_id')
    .eq('id', requestId)
    .maybeSingle();

  const current = requestRow.data as {
    id?: string;
    status?: string;
    request_number?: string;
    requested_by?: string | null;
    department_id?: string | null;
    asset_id?: string | null;
  } | null;

  if (!current || isTerminalRequestStatus(current.status)) return { warning: null, notificationResult: null };
  if (current.status === params.nextStatus) return { warning: null, notificationResult: null };

  const updatePayload: Record<string, unknown> = { status: params.nextStatus };
  if (params.nextStatus === 'completed') updatePayload.resolved_at = new Date().toISOString();

  const update = await params.supabase
    .from('maintenance_requests')
    .update(updatePayload as never)
    .eq('id', current.id as string)
    .select('id, status, request_number, requested_by, department_id, asset_id')
    .maybeSingle();

  if (update.error || !update.data) {
    const message = update.error?.message ?? 'Request status sync returned 0 rows (likely blocked by RLS).';
    await logServerAuditEvent({
      supabase: params.supabase,
      profileId: params.profileId,
      action: 'work_order.request_status_sync_failed',
      entityType: 'maintenance_requests',
      entityId: current.id ?? null,
      details: {
        work_order_id: params.workOrder.id ?? null,
        attempted_status: params.nextStatus,
        error: message,
      },
    });
    return { warning: message, notificationResult: null };
  }

  await logServerAuditEvent({
    supabase: params.supabase,
    profileId: params.profileId,
    action: params.auditAction ?? 'maintenance_request.status_synced_by_work_order',
    entityType: 'maintenance_requests',
    entityId: current.id ?? null,
    oldValues: { status: current.status },
    newValues: { status: params.nextStatus, work_order_id: params.workOrder.id ?? null },
  });

  try {
    const updated = update.data as {
      id?: string;
      request_number?: string;
      requested_by?: string | null;
      department_id?: string | null;
      asset_id?: string | null;
    };
    const notificationResult = await emitMaintenanceRequestStatusChanged({
      supabase: params.supabase,
      requestRow: updated,
      status: params.nextStatus,
      payload: {
        triggered_by_work_order_id: params.workOrder.id ?? null,
        triggered_by_work_order_number: params.workOrder.work_order_number ?? null,
        ...params.notificationPayload,
      },
    });
    return { warning: null, notificationResult };
  } catch (e) {
    console.error('[notifications] maintenance_request.status_changed (WO sync) emit failed:', e);
    return {
      warning: null,
      notificationResult: makeFailedNotificationResult('maintenance_request.status_changed', e),
    };
  }
}

export async function createMaintenanceRequestAction(payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('maintenance.request.create');
    if (error || !profile) return { success: false, error };
    const parsed = requestSchema.parse(payload);

    // Duplicate prevention: one active corrective request per asset at a time.
    // Closed statuses (completed/rejected/canceled) do not block new requests.
    const { data: existing } = await supabase
      .from('maintenance_requests')
      .select('id, request_number, status')
      .eq('asset_id', parsed.asset_id)
      .in('status', [...OPEN_MAINTENANCE_REQUEST_STATUSES])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return {
        success: false,
        error: 'This equipment already has an open corrective maintenance request.',
        data: {
          reason: 'duplicate_open_request',
          existingRequestId: existing.id,
          existingRequestNumber: existing.request_number,
          existingRequestStatus: existing.status,
        },
      };
    }

    const { data: activeWorkOrder } = await supabase
      .from('work_orders')
      .select('id, work_order_number, status')
      .eq('asset_id', parsed.asset_id)
      .in('status', [...OPEN_WORK_ORDER_STATUSES])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeWorkOrder) {
      return {
        success: false,
        error: 'This equipment already has an active corrective maintenance work order.',
        data: {
          reason: 'active_work_order',
          existingWorkOrderId: activeWorkOrder.id,
          existingWorkOrderNumber: activeWorkOrder.work_order_number,
          existingWorkOrderStatus: activeWorkOrder.status,
        },
      };
    }

    const data = {
      ...parsed,
      request_number: `MR-${Date.now().toString(36).toUpperCase()}`,
      requested_by: nullIfEmpty(parsed.requested_by) ?? profile.id,
      department_id: nullIfEmpty(parsed.department_id) ?? profile.department_id,
      notes: nullIfEmpty(parsed.notes),
      status: parsed.status ?? 'pending',
      reported_condition: parsed.reported_condition ?? null,
      reported_condition_source: nullIfEmpty(parsed.reported_condition_source),
    };

    const result = await supabase.from('maintenance_requests').insert(data as never).select('*').single();
    if (result.error) return { success: false, error: result.error.message };
    await logServerAuditEvent({
      supabase, profileId: profile.id, action: 'maintenance_request.create',
      entityType: 'maintenance_requests', entityId: (result.data as { id?: string }).id ?? null,
      newValues: result.data as Record<string, unknown>,
    });

    // Sync equipment condition from reported_condition.
    // functional_issue = equipment still functional, no condition change needed.
    // needs_repair / non_functional = sync to equipment_assets.condition.
    // R5: do NOT silently swallow failures — the caller's UI shows a
    // duplicateConditionSyncFailed warning so the user knows the request was
    // saved but the asset's recorded condition was not updated.
    let conditionSyncWarning: string | null = null;
    if (parsed.reported_condition === 'needs_repair' || parsed.reported_condition === 'non_functional') {
      const sync = await updateEquipmentConditionAction(parsed.asset_id, parsed.reported_condition);
      if (!sync.success) {
        conditionSyncWarning = sync.error ?? 'Equipment condition could not be updated.';
        await logServerAuditEvent({
          supabase,
          profileId: profile.id,
          action: 'maintenance_request.condition_sync_failed',
          entityType: 'maintenance_requests',
          entityId: (result.data as { id?: string }).id ?? null,
          details: {
            asset_id: parsed.asset_id,
            attempted_condition: parsed.reported_condition,
            error: conditionSyncWarning,
          },
        });
      }
    }

    let notificationResult: NotificationProcessResult | null = null;
    try {
      const assetSummary = await loadAssetSummaryForNotification(supabase, parsed.asset_id);
      const inserted = result.data as { id?: string; request_number?: string };
      const requestPriority: 'critical' | 'high' | 'medium' | 'low' =
        parsed.urgency === 'critical'
          ? 'critical'
          : parsed.urgency === 'high'
            ? 'high'
            : parsed.urgency === 'medium'
              ? 'medium'
              : 'low';
      const departmentId = (typeof data.department_id === 'string' && data.department_id.length > 0)
        ? data.department_id
        : assetSummary.department_id ?? null;
      const requestedBy = typeof data.requested_by === 'string' ? data.requested_by : null;
      notificationResult = await createNotificationEvent({
        event_type: 'maintenance_request.created',
        source_table: 'maintenance_requests',
        source_id: inserted.id ?? null,
        asset_id: parsed.asset_id,
        department_id: departmentId,
        priority: requestPriority,
        payload: {
          asset_name: assetSummary.asset_name,
          asset_code: assetSummary.asset_code,
          request_number: inserted.request_number ?? null,
          urgency: parsed.urgency,
          requested_by: requestedBy,
        },
      });
    } catch (e) {
      console.error('[notifications] maintenance_request.created emit failed:', e);
      notificationResult = makeFailedNotificationResult('maintenance_request.created', e);
    }

    revalidateMany([...maintenancePaths, `/equipment/${parsed.asset_id}`]);
    const notificationData = notificationReviewData(notificationResult);
    return {
      success: true,
      data: {
        ...(result.data as Record<string, unknown>),
        ...notificationData,
        ...(conditionSyncWarning ? { condition_sync_warning: conditionSyncWarning } : {}),
      },
    };
  } catch (err) {
    return actionError(err, 'Failed to create maintenance request');
  }
}

export async function updateRequestStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    // Status changes include create-author cancellations as well as approvals.
    // Authorize via "request.create" so departmental requestors can cancel their
    // own requests, while approvals/rejections also fall under request.approve.
    const { supabase, profile, error } = await getActionContextForAnyCapability([
      'maintenance.request.approve',
      'maintenance.request.create',
    ]);
    if (error || !profile) return { success: false, error };
    const parsedStatus = z.enum(['pending', 'approved', 'assigned', 'in_progress', 'completed', 'rejected', 'canceled']).parse(status);
    const oldRow = await supabase.from('maintenance_requests').select('*').eq('id', id).maybeSingle();
    if (oldRow.error) return { success: false, error: oldRow.error.message };
    if (!oldRow.data) {
      return { success: false, error: 'Request could not be updated because no matching request was found.' };
    }
    const updateData: Record<string, unknown> = { status: parsedStatus };
    if (parsedStatus === 'completed') updateData.resolved_at = new Date().toISOString();
    // .maybeSingle() (not .single()) so an RLS-filtered or already-deleted
    // row returns data=null instead of raising "Cannot coerce the result to
    // a single JSON object". We translate that to a clear user message and
    // log the raw PostgREST error for developers.
    const result = await supabase
      .from('maintenance_requests')
      .update(updateData as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (result.error) return { success: false, error: result.error.message };
    if (!result.data) {
      // SHAPE-01: centralized translation of 0-row mutation result.
      return interpretMissingMutationResult({
        entity: 'maintenance request',
        entityId: id,
        attempted: `status=${parsedStatus}`,
        profileId: profile.id,
      });
    }
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'maintenance_request.status_update', entityType: 'maintenance_requests', entityId: id, oldValues: oldRow.data as Record<string, unknown> | null, newValues: result.data as Record<string, unknown> });

    let notificationResult: NotificationProcessResult | null = null;
    try {
      const row = result.data as { id?: string; asset_id?: string; request_number?: string; requested_by?: string; department_id?: string | null };
      notificationResult = await emitMaintenanceRequestStatusChanged({
        supabase,
        requestRow: row,
        status: parsedStatus,
        priority: parsedStatus === 'rejected' ? 'high' : 'medium',
      });
    } catch (e) {
      console.error('[notifications] maintenance_request.status_changed emit failed:', e);
      notificationResult = makeFailedNotificationResult('maintenance_request.status_changed', e);
    }

    revalidateMany([...maintenancePaths, `/maintenance/requests/${id}`]);
    return {
      success: true,
      data: {
        ...(result.data as Record<string, unknown>),
        ...notificationReviewData(notificationResult),
      },
    };
  } catch (err) {
    return actionError(err, 'Failed to update maintenance request');
  }
}

export async function createWorkOrderAction(payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('work_order.create');
    if (error || !profile) return { success: false, error };
    const data = { ...normalizeWorkOrder(payload), work_order_number: `WO-${Date.now().toString(36).toUpperCase()}`, status: (payload.status as string | undefined) ?? 'open' };
    // Idempotency: if this WO is being created from a maintenance request and
    // a non-terminal WO already exists for that request, return the existing
    // one instead of creating a duplicate. This protects against double-clicks
    // on the "Create Work Order" button after approval.
    if (data.request_id) {
      const existing = await supabase
        .from('work_orders')
        .select('*')
        .eq('request_id', data.request_id)
        .in('status', [...OPEN_WORK_ORDER_STATUSES])
        .order('created_at', { ascending: false })
        .limit(1);
      if (!existing.error && existing.data && existing.data.length > 0) {
        return { success: true, data: { ...(existing.data[0] as Record<string, unknown>), duplicate_prevented: true } };
      }
    }
    const result = await supabase.from('work_orders').insert(data as never).select('*').maybeSingle();
    if (result.error) return { success: false, error: result.error.message };
    if (!result.data) {
      console.error('[maintenance] work order insert returned 0 rows; likely RLS INSERT policy excludes role', {
        requestId: data.request_id,
        assetId: data.asset_id,
        profileId: profile.id,
      });
      return {
        success: false,
        error: 'You do not have permission to create a work order, or the linked record is missing.',
      };
    }
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'work_order.create', entityType: 'work_orders', entityId: (result.data as { id?: string }).id ?? null, newValues: result.data as Record<string, unknown> });

    // R17: when a WO is created from a maintenance request, flip the request
    // status so requester/department-head tracking reflects that BME is acting.
    //   - WO with assigned_to → request becomes 'assigned'
    //   - WO unassigned       → request becomes 'approved' (BME has accepted it
    //                            but hasn't picked a technician yet)
    // Requests in completed/rejected/canceled are NOT touched.
    const woRow = result.data as {
      id?: string;
      request_id?: string | null;
      asset_id?: string | null;
      work_order_number?: string | null;
      assigned_to?: string | null;
      priority?: string | null;
    };
    const notificationResults: NotificationProcessResult[] = [];
    let primaryWorkOrderNotification: NotificationProcessResult | null = null;
    let requestStatusSyncWarning: string | null = null;
    if (woRow.request_id) {
      const nextStatus = woRow.assigned_to ? 'assigned' : 'approved';
      if (nextStatus === 'assigned') {
        const sync = await syncLinkedRequestStatusFromWorkOrder({
          supabase,
          profileId: profile.id,
          workOrder: woRow,
          nextStatus,
        });
        requestStatusSyncWarning = sync.warning;
        if (sync.notificationResult) notificationResults.push(sync.notificationResult);
      }
    }

    // Notification: tell BME workspace that a work order was created.
    try {
      const assetSummary = await loadAssetSummaryForNotification(supabase, woRow.asset_id ?? null);
      const eventPriority: 'critical' | 'high' | 'medium' = woRow.priority === 'critical'
        ? 'critical'
        : woRow.priority === 'high'
          ? 'high'
          : 'medium';
      primaryWorkOrderNotification = await createNotificationEvent({
        event_type: woRow.assigned_to ? 'work_order.assigned' : 'work_order.created',
        source_table: 'work_orders',
        source_id: woRow.id ?? null,
        asset_id: woRow.asset_id ?? null,
        department_id: assetSummary.department_id,
        priority: eventPriority,
        payload: {
          asset_name: assetSummary.asset_name,
          asset_code: assetSummary.asset_code,
          work_order_number: woRow.work_order_number ?? null,
          priority: woRow.priority ?? null,
          // NOTIF-01: rule_workOrderAssigned reads `technician_profile_id`.
          // Emit both keys so both the assignment rule and the status rule
          // can locate the assignee — they look at different fields by
          // historical accident.
          technician_profile_id: woRow.assigned_to ?? null,
          assigned_to: woRow.assigned_to ?? null,
          source_request_id: woRow.request_id ?? null,
        },
      });
      notificationResults.push(primaryWorkOrderNotification);
    } catch (e) {
      console.error('[notifications] work_order.created emit failed:', e);
      primaryWorkOrderNotification = makeFailedNotificationResult(
        woRow.assigned_to ? 'work_order.assigned' : 'work_order.created', e,
      );
    }

    revalidateMany([
      ...maintenancePaths,
      ...(woRow.request_id ? [`/maintenance/requests/${woRow.request_id}`] : []),
    ]);
    return {
      success: true,
      data: {
        ...(result.data as Record<string, unknown>),
        ...(notificationDeliveryNeedsReview(primaryWorkOrderNotification)
          ? notificationReviewData(primaryWorkOrderNotification)
          : firstNotificationReviewData(notificationResults)),
        ...(requestStatusSyncWarning ? { request_status_sync_warning: requestStatusSyncWarning } : {}),
      },
    };
  } catch (err) {
    return actionError(err, 'Failed to create work order');
  }
}

export async function updateWorkOrderAction(id: string, payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    // R18: select the capability that matches the requested transition. If
    // the caller is asking for a completion, they must have work_order.complete;
    // an on_hold caller must have work_order.hold; etc.
    const requestedStatus = (payload as { status?: string }).status;
    const requiredCap = requiredCapabilityForWorkOrderTransition(requestedStatus);
    if (!requiredCap) {
      return { success: false, error: `Unsupported work order status transition: ${requestedStatus}` };
    }
    const { supabase, profile, error } = await getActionContextForCapability(requiredCap);
    if (error || !profile) return { success: false, error };

    // R2: completion-evidence guard. The caller must supply both a
    // completion_outcome and a final_equipment_condition before completion
    // succeeds. Without this guard, work orders could close without any
    // reliability evidence and MTTR/MTBF/availability would stay stale.
    const completionOutcome = payload.completion_outcome as string | undefined;
    const finalEquipmentCondition = payload.final_equipment_condition as string | undefined;
    // R2 follow-up (WO-completion truth fix): reliability evidence fields the
    // caller MAY supply on completion. When omitted for a corrective work
    // order, we DERIVE them from the work order's own timestamps so a
    // maintenance_events row is written every time. Migration 00061's trigger
    // then materialises the matching downtime_logs row that fn_compute_mtbf
    // reads. Previously this only ran when the caller explicitly supplied
    // input, which silently produced corrective WOs with no evidence.
    const repairDurationHours = (payload as { repair_duration_hours?: number | string | null }).repair_duration_hours;
    const downtimeStart = (payload as { downtime_start?: string | null }).downtime_start;
    const downtimeEnd = (payload as { downtime_end?: string | null }).downtime_end;
    const failureDate = (payload as { failure_date?: string | null }).failure_date;
    const completionActionTaken = (payload as { action_taken_on_completion?: string | null }).action_taken_on_completion;
    if (requestedStatus === 'completed') {
      if (!completionOutcome) {
        return {
          success: false,
          error: 'Completion outcome is required when completing a work order (R2).',
        };
      }
      if (!finalEquipmentCondition) {
        return {
          success: false,
          error: 'Final equipment condition is required when completing a work order (R2).',
        };
      }
    }

    const data = normalizePartialWorkOrder(payload);
    const updatePayload: Record<string, unknown> = { ...data };
    if (completionOutcome !== undefined) updatePayload.completion_outcome = completionOutcome || null;
    if (finalEquipmentCondition !== undefined) updatePayload.final_equipment_condition = finalEquipmentCondition || null;
    // Persist the completion-time action_taken on the work order itself so the
    // WO detail page renders the repair summary alongside the maintenance
    // event. We only overwrite when the caller actually supplied a non-empty
    // value — partial WO edits without this field are unaffected.
    if (typeof completionActionTaken === 'string' && completionActionTaken.trim().length > 0) {
      updatePayload.action_taken = completionActionTaken.trim();
    }

    const oldRow = await supabase.from('work_orders').select('*').eq('id', id).maybeSingle();
    // SHAPE-01: maybeSingle handles RLS-filtered rows cleanly.
    const result = await supabase.from('work_orders').update(updatePayload as never).eq('id', id).select('*').maybeSingle();
    if (result.error) return { success: false, error: result.error.message };
    if (!result.data) {
      return interpretMissingMutationResult({
        entity: 'work order',
        entityId: id,
        attempted: data.status ? `status=${data.status}` : 'update',
        profileId: profile.id,
      });
    }
    await logServerAuditEvent({ supabase, profileId: profile.id, action: data.status ? 'work_order.status_update' : 'work_order.update', entityType: 'work_orders', entityId: id, oldValues: oldRow.data as Record<string, unknown> | null, newValues: result.data as Record<string, unknown> });

    const assetId = (result.data as Record<string, unknown>).asset_id as string | undefined;
    let conditionSyncWarning: string | null = null;
    let requestStatusSyncWarning: string | null = null;
    const requestNotificationResults: NotificationProcessResult[] = [];
    // R2: warning surfaced to the caller when the completion happened but
    // reliability evidence could not be persisted. Completion still succeeds
    // (we don't roll back) — the warning is loud so the gap is visible.
    let reliabilityEvidenceWarning: string | null = null;
    if (assetId) {
      if (data.status === 'in_progress') {
        // Starting work: set equipment to under_maintenance
        const sync = await updateEquipmentConditionAction(assetId, 'under_maintenance');
        if (!sync.success) conditionSyncWarning = sync.error ?? 'Equipment condition could not be set to under_maintenance.';
        const requestSync = await syncLinkedRequestStatusFromWorkOrder({
          supabase,
          profileId: profile.id,
          workOrder: result.data as {
            id?: string | null;
            request_id?: string | null;
            asset_id?: string | null;
            work_order_number?: string | null;
          },
          nextStatus: 'in_progress',
        });
        requestStatusSyncWarning = requestSync.warning;
        if (requestSync.notificationResult) requestNotificationResults.push(requestSync.notificationResult);
      } else if (data.status === 'completed') {
        // Completion: use explicit final_equipment_condition if provided, else derive from outcome
        const conditionToSet = (finalEquipmentCondition as 'functional' | 'needs_repair' | 'non_functional' | 'under_maintenance' | undefined)
          ?? (completionOutcome ? outcomeToCondition(completionOutcome) : 'functional');
        const sync = await updateEquipmentConditionAction(assetId, conditionToSet);
        if (!sync.success) conditionSyncWarning = sync.error ?? 'Final equipment condition could not be recorded.';

        // R2 follow-up (WO-completion truth fix): for corrective work orders,
        // ALWAYS write a maintenance_events row at completion. Missing
        // reliability inputs are derived from the work order's own timestamps
        // (started_at, completed_at, created_at) via deriveReliabilityEvidence.
        // Idempotent: the DB has one canonical maintenance_events row per
        // non-null work_order_id, so the helper upserts on work_order_id. A
        // re-completion / retry updates the same evidence row instead of
        // duplicating history. For non-corrective work types we only write
        // when the caller actually supplied evidence — pm_completions and
        // installation_records carry primary evidence for those workflows.
        const woRow = result.data as Record<string, unknown>;
        const woWorkType = (woRow.work_type as string | undefined) ?? 'corrective';
        const woCreatedAt = (woRow.created_at as string | undefined) ?? null;
        const woStartedAt = (woRow.started_at as string | undefined) ?? null;
        const woCompletedAt = (woRow.completed_at as string | undefined) ?? null;
        const woActualHours = (woRow.actual_hours as number | null | undefined) ?? null;
        const woActionTaken = (woRow.action_taken as string | undefined) ?? null;
        const woClosureNotes = (woRow.closure_notes as string | undefined) ?? null;
        const woRequestId = (woRow.request_id as string | null | undefined) ?? null;

        // Best-effort: pull originating request created_at for a more accurate
        // failure_date when the request landed before the WO was created.
        let originatingRequestCreatedAt: string | null = null;
        if (woRequestId) {
          const req = await supabase
            .from('maintenance_requests')
            .select('created_at')
            .eq('id', woRequestId)
            .maybeSingle();
          if (!req.error) {
            originatingRequestCreatedAt = (req.data as { created_at?: string } | null)?.created_at ?? null;
          }
        }

        const hasExplicitEvidence = (
          (repairDurationHours !== undefined && repairDurationHours !== null && repairDurationHours !== '') ||
          (downtimeStart !== undefined && downtimeStart !== null && downtimeStart !== '') ||
          (downtimeEnd !== undefined && downtimeEnd !== null && downtimeEnd !== '') ||
          (failureDate !== undefined && failureDate !== null && failureDate !== '') ||
          (typeof completionActionTaken === 'string' && completionActionTaken.trim().length > 0)
        );

        const writeEvent = shouldAlwaysWriteCompletionEvent(woWorkType) || hasExplicitEvidence;

        if (writeEvent) {
          const evidence = deriveReliabilityEvidence({
            workOrderId: id,
            assetId,
            workOrderCreatedAt: woCreatedAt,
            workOrderStartedAt: woStartedAt,
            workOrderCompletedAt: woCompletedAt,
            workOrderActualHours: woActualHours,
            originatingRequestCreatedAt,
            workType: woWorkType,
            workOrderActionTaken: woActionTaken,
            workOrderClosureNotes: woClosureNotes,
            completionOutcome,
            performedByProfileId: profile.id,
            explicitRepairDurationHours: repairDurationHours ?? null,
            explicitDowntimeStart: downtimeStart ?? null,
            explicitDowntimeEnd: downtimeEnd ?? null,
            explicitFailureDate: failureDate ?? null,
            explicitActionTaken: completionActionTaken ?? null,
          });

          const eventPayload: Record<string, unknown> = {
            work_order_id: id,
            asset_id: assetId,
            event_type: evidence.eventType,
            failure_date: evidence.failureDate,
            downtime_start: evidence.downtimeStart,
            downtime_end: evidence.downtimeEnd,
            repair_duration_hours: evidence.repairDurationHours,
            action_taken: evidence.actionTaken,
            completed_by: evidence.completedBy,
            completion_date: evidence.completionDate,
            notes: evidence.notes,
          };

          const recorded = await recordWorkOrderReliabilityEvidence({
            supabase,
            profileId: profile.id,
            workOrderId: id,
            assetId,
            eventPayload,
            auditValues: {
              work_order_id: id,
              asset_id: assetId,
              evidence_source: evidence.source,
              derived_fields: evidence.derivedFields,
              warnings: evidence.warnings,
              has_explicit_evidence: evidence.hasExplicitEvidence,
              repair_duration_hours: evidence.repairDurationHours,
              downtime_start: evidence.downtimeStart,
              downtime_end: evidence.downtimeEnd,
              failure_date: evidence.failureDate,
            },
          });
          reliabilityEvidenceWarning = recorded.warning;
        } else {
          // Non-corrective work without explicit evidence — pm_completions or
          // installation_records carry primary evidence elsewhere. No
          // maintenance_events row is written, and no warning is emitted.
          await logServerAuditEvent({
            supabase,
            profileId: profile.id,
            action: 'work_order.completed_no_reliability_event_expected',
            entityType: 'work_orders',
            entityId: id,
            details: { asset_id: assetId, work_type: woWorkType },
          });
        }

        // ANALYTICS-01: surface refresh failure (was silently swallowed).
        try {
          await recomputeAssetAnalytics(assetId);
        } catch (refreshErr) {
          const message = refreshErr instanceof Error ? refreshErr.message : 'unknown';
          await logServerAuditEvent({
            supabase, profileId: profile.id,
            action: 'work_order.analytics_refresh_failed',
            entityType: 'work_orders', entityId: id,
            details: { asset_id: assetId, error: message },
          });
        }
        const requestSync = await syncLinkedRequestStatusFromWorkOrder({
          supabase,
          profileId: profile.id,
          workOrder: result.data as {
            id?: string | null;
            request_id?: string | null;
            asset_id?: string | null;
            work_order_number?: string | null;
          },
          nextStatus: 'completed',
          auditAction: 'maintenance_request.completed_by_work_order',
          notificationPayload: {
            completion_outcome: completionOutcome ?? null,
            final_equipment_condition: conditionToSet,
          },
        });
        requestStatusSyncWarning = requestSync.warning;
        if (requestSync.notificationResult) requestNotificationResults.push(requestSync.notificationResult);
      }
      // on_hold: do not change condition — equipment remains under_maintenance or needs_repair

      // R5: audit condition-sync failures so they appear in governance evidence
      // instead of being silently swallowed.
      if (conditionSyncWarning) {
        await logServerAuditEvent({
          supabase,
          profileId: profile.id,
          action: 'work_order.condition_sync_failed',
          entityType: 'work_orders',
          entityId: id,
          details: { asset_id: assetId, status: data.status, error: conditionSyncWarning },
        });
      }
    }

    let notificationResult: NotificationProcessResult | null = null;
    try {
      const row = result.data as { id?: string; asset_id?: string; work_order_number?: string; status?: string; priority?: string; assigned_to?: string | null };
      const assetSummary = await loadAssetSummaryForNotification(supabase, row.asset_id ?? null);
      let eventType: 'work_order.status_changed' | 'work_order.on_hold' | 'work_order.completed' = 'work_order.status_changed';
      let priority: 'critical' | 'high' | 'medium' | 'low' = 'medium';
      if (row.status === 'on_hold') {
        eventType = 'work_order.on_hold';
        priority = 'high';
      } else if (row.status === 'completed') {
        eventType = 'work_order.completed';
        priority = 'medium';
      } else if (row.priority === 'critical') {
        priority = 'high';
      }
      notificationResult = await createNotificationEvent({
        event_type: eventType,
        source_table: 'work_orders',
        source_id: row.id ?? null,
        asset_id: row.asset_id ?? null,
        department_id: assetSummary.department_id,
        priority,
        payload: {
          asset_name: assetSummary.asset_name,
          asset_code: assetSummary.asset_code,
          work_order_number: row.work_order_number ?? null,
          status: row.status ?? null,
          priority: row.priority ?? null,
          assigned_to: row.assigned_to ?? null,
        },
      });
    } catch (e) {
      console.error('[notifications] work_order update emit failed:', e);
    }

    revalidateMany([...maintenancePaths, `/maintenance/work-orders/${id}`, ...(assetId ? [`/equipment/${assetId}`] : [])]);
    const baseData = result.data as Record<string, unknown>;
    const enriched: Record<string, unknown> = { ...baseData };
    Object.assign(enriched, firstNotificationReviewData([
      ...requestNotificationResults,
      ...(notificationResult ? [notificationResult] : []),
    ]));
    if (conditionSyncWarning) enriched.condition_sync_warning = conditionSyncWarning;
    if (reliabilityEvidenceWarning) enriched.reliability_evidence_warning = reliabilityEvidenceWarning;
    if (requestStatusSyncWarning) enriched.request_status_sync_warning = requestStatusSyncWarning;
    return { success: true, data: enriched };
  } catch (err) {
    return actionError(err, 'Failed to update work order');
  }
}

async function setWorkOrderAssignee(id: string, technicianProfileId: string, action: 'assign' | 'reassign'): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('work_order.assign');
    if (error || !profile) return { success: false, error };
    const parsedId = z.string().min(1).parse(technicianProfileId);

    const technician = await supabase
      .from('profiles')
      // PostgREST disambiguation: user_roles has two FKs to profiles
      // (user_id, assigned_by). Without the FK hint PostgREST raises PGRST201
      // and this validation silently rejects every selected technician.
      .select('id, user_id, full_name, is_active, user_roles!user_roles_user_id_fkey!inner(roles!inner(name))')
      .eq('id', parsedId)
      .eq('is_active', true)
      .eq('user_roles.roles.name', 'technician')
      .maybeSingle();
    if (technician.error) return { success: false, error: technician.error.message };
    if (!technician.data) return { success: false, error: 'Selected user is not an active technician' };

    const oldRow = await supabase.from('work_orders').select('*').eq('id', id).maybeSingle();
    const currentStatus = (oldRow.data as { status?: string } | null)?.status;
    if (currentStatus === 'completed' || currentStatus === 'canceled') {
      return { success: false, error: 'Terminal work orders cannot be reassigned' };
    }

    const updateData: Record<string, unknown> = { assigned_to: parsedId };
    if (currentStatus === 'open' || !currentStatus) updateData.status = 'assigned';

    // SHAPE-01: maybeSingle handles RLS-filtered rows cleanly.
    const result = await supabase.from('work_orders').update(updateData as never).eq('id', id).select('*').maybeSingle();
    if (result.error) return { success: false, error: result.error.message };
    if (!result.data) {
      return interpretMissingMutationResult({
        entity: 'work order',
        entityId: id,
        attempted: `assigned_to=${parsedId}`,
        profileId: profile.id,
      });
    }

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: `work_order.${action}`,
      entityType: 'work_orders',
      entityId: id,
      oldValues: oldRow.data as Record<string, unknown> | null,
      newValues: result.data as Record<string, unknown>,
      details: { technician_profile_id: parsedId },
    });

    let notificationResult: NotificationProcessResult | null = null;
    let requestNotificationResult: NotificationProcessResult | null = null;
    let requestStatusSyncWarning: string | null = null;
    const assignedRow = result.data as {
      id?: string | null;
      request_id?: string | null;
      asset_id?: string | null;
      work_order_number?: string | null;
    };
    const requestSync = await syncLinkedRequestStatusFromWorkOrder({
      supabase,
      profileId: profile.id,
      workOrder: assignedRow,
      nextStatus: 'assigned',
    });
    requestStatusSyncWarning = requestSync.warning;
    requestNotificationResult = requestSync.notificationResult;
    try {
      const row = result.data as { id?: string; asset_id?: string; work_order_number?: string; priority?: string };
      const assetSummary = await loadAssetSummaryForNotification(supabase, row.asset_id ?? null);
      const isCritical = row.priority === 'critical' || row.priority === 'high';
      const technicianRow = technician.data as { user_id?: string | null } | null;
      notificationResult = await createNotificationEvent({
        event_type: 'work_order.assigned',
        source_table: 'work_orders',
        source_id: row.id ?? null,
        asset_id: row.asset_id ?? null,
        department_id: assetSummary.department_id,
        priority: isCritical ? 'critical' : 'high',
        payload: {
          asset_name: assetSummary.asset_name,
          asset_code: assetSummary.asset_code,
          work_order_number: row.work_order_number ?? null,
          priority: row.priority ?? null,
          technician_profile_id: parsedId,
          assigned_to: parsedId,
          assignment_kind: action,
          technician_user_id_present: !!technicianRow?.user_id,
        },
      });
    } catch (e) {
      console.error('[notifications] work_order.assigned emit failed:', e);
      notificationResult = makeFailedNotificationResult('work_order.assigned', e);
    }

    revalidateMany([
      ...maintenancePaths,
      '/requests',
      '/notifications',
      `/maintenance/work-orders/${id}`,
      ...(assignedRow.request_id ? [`/maintenance/requests/${assignedRow.request_id}`] : []),
    ]);
    return {
      success: true,
      data: {
        ...(result.data as Record<string, unknown>),
        ...firstNotificationReviewData([
          ...(requestNotificationResult ? [requestNotificationResult] : []),
          ...(notificationResult ? [notificationResult] : []),
        ]),
        ...(requestStatusSyncWarning ? { request_status_sync_warning: requestStatusSyncWarning } : {}),
      },
    };
  } catch (err) {
    return actionError(err, action === 'assign' ? 'Failed to assign work order' : 'Failed to reassign work order');
  }
}

export async function assignWorkOrder(workOrderId: string, technicianProfileId: string): Promise<ActionResult> {
  return setWorkOrderAssignee(workOrderId, technicianProfileId, 'assign');
}

export async function reassignWorkOrder(workOrderId: string, technicianProfileId: string): Promise<ActionResult> {
  return setWorkOrderAssignee(workOrderId, technicianProfileId, 'reassign');
}

export async function createMaintenanceEventAction(payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('work_order.add_event');
    if (error || !profile) return { success: false, error };
    const parsed = eventSchema.parse(payload);
    const data = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, nullIfEmpty(value) ?? value]));
    const result = await supabase.from('maintenance_events').insert(data as never).select('*').single();
    if (result.error) return { success: false, error: result.error.message };
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'maintenance_event.create', entityType: 'maintenance_events', entityId: (result.data as { id?: string }).id ?? null, newValues: result.data as Record<string, unknown> });
    // ANALYTICS-01: surface refresh failure (was silently swallowed).
    let eventAnalyticsWarning: string | null = null;
    try {
      await recomputeAssetAnalytics(parsed.asset_id);
    } catch (refreshErr) {
      const message = refreshErr instanceof Error ? refreshErr.message : 'unknown';
      eventAnalyticsWarning = `Maintenance event recorded but reliability analytics refresh failed: ${message}.`;
      await logServerAuditEvent({
        supabase, profileId: profile.id,
        action: 'maintenance_event.analytics_refresh_failed',
        entityType: 'maintenance_events', entityId: (result.data as { id?: string }).id ?? null,
        details: { asset_id: parsed.asset_id, error: message },
      });
    }
    revalidateMany(maintenancePaths);
    return {
      success: true,
      data: eventAnalyticsWarning
        ? { ...(result.data as Record<string, unknown>), analytics_refresh_warning: eventAnalyticsWarning }
        : result.data,
    };
  } catch (err) {
    return actionError(err, 'Failed to create maintenance event');
  }
}

// ============================================================================
// R19: work_order_parts_needed actions
// ============================================================================
//
// declareWorkOrderPartNeededAction: technician (or BME) declares that a part
// is needed for an open work order. Powers the "stock blocker" signal — if
// the declared part is at or below reorder_level, the Command Center and
// store dashboards surface this WO as blocked on that part.
//
// updateWorkOrderPartNeededStatusAction: moves an open need to fulfilled
// (when a corresponding stock_issue lands) or canceled (technician determined
// it's no longer needed). Both transitions write audit rows.

const partNeededSchema = z.object({
  work_order_id: z.string().min(1),
  spare_part_id: z.string().min(1),
  quantity_needed: z.coerce.number().int().min(1).default(1),
  notes: z.string().optional().nullable(),
});

export async function declareWorkOrderPartNeededAction(payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('work_order.add_event');
    if (error || !profile) return { success: false, error };
    const parsed = partNeededSchema.parse(payload);

    // Verify the work order is in a state that can have outstanding part needs.
    const woRow = await supabase
      .from('work_orders')
      .select('id, status, asset_id')
      .eq('id', parsed.work_order_id)
      .maybeSingle();
    const wo = woRow.data as { id?: string; status?: string; asset_id?: string } | null;
    if (!wo) return { success: false, error: 'Work order not found' };
    if (wo.status && ['completed', 'canceled'].includes(wo.status)) {
      return { success: false, error: 'Cannot declare parts needed for a terminal work order' };
    }

    const insert = await supabase
      .from('work_order_parts_needed')
      .insert({
        work_order_id: parsed.work_order_id,
        spare_part_id: parsed.spare_part_id,
        quantity_needed: parsed.quantity_needed,
        notes: nullIfEmpty(parsed.notes),
        declared_by: profile.id,
        status: 'open',
      } as never)
      .select('*')
      .single();

    if (insert.error) {
      // Postgres unique-violation when an open need already exists for this
      // (work_order, part) pair — return the existing row so the UI can
      // surface "already declared" without confusion.
      if (insert.error.code === '23505') {
        const existing = await supabase
          .from('work_order_parts_needed')
          .select('*')
          .eq('work_order_id', parsed.work_order_id)
          .eq('spare_part_id', parsed.spare_part_id)
          .eq('status', 'open')
          .maybeSingle();
        return {
          success: false,
          error: 'An open need for this part is already declared on this work order.',
          data: existing.data ?? null,
        };
      }
      return { success: false, error: insert.error.message };
    }

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'work_order.parts_needed.declared',
      entityType: 'work_order_parts_needed',
      entityId: (insert.data as { id?: string }).id ?? null,
      newValues: insert.data as Record<string, unknown>,
    });

    revalidateMany([
      ...maintenancePaths,
      `/maintenance/work-orders/${parsed.work_order_id}`,
      '/work-orders',
      '/command',
      '/spare-parts',
      '/logistics',
    ]);
    return { success: true, data: insert.data };
  } catch (err) {
    return actionError(err, 'Failed to declare part need');
  }
}

export async function updateWorkOrderPartNeededStatusAction(
  id: string,
  status: 'fulfilled' | 'canceled',
): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForAnyCapability([
      'work_order.add_event',
      'stock.issue',
    ]);
    if (error || !profile) return { success: false, error };
    const parsedStatus = z.enum(['fulfilled', 'canceled']).parse(status);
    const oldRow = await supabase
      .from('work_order_parts_needed')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    const existing = oldRow.data as { id?: string; work_order_id?: string; status?: string } | null;
    if (!existing) return { success: false, error: 'Part need row not found' };
    if (existing.status !== 'open') {
      return { success: false, error: `Part need is already ${existing.status}; only open needs can transition.` };
    }
    const updatePayload: Record<string, unknown> = { status: parsedStatus };
    if (parsedStatus === 'fulfilled') updatePayload.fulfilled_at = new Date().toISOString();
    if (parsedStatus === 'canceled') updatePayload.canceled_at = new Date().toISOString();
    const update = await supabase
      .from('work_order_parts_needed')
      .update(updatePayload as never)
      .eq('id', id)
      .select('*')
      .single();
    if (update.error) return { success: false, error: update.error.message };
    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: `work_order.parts_needed.${parsedStatus}`,
      entityType: 'work_order_parts_needed',
      entityId: id,
      oldValues: existing as Record<string, unknown>,
      newValues: update.data as Record<string, unknown>,
    });
    revalidateMany([
      ...maintenancePaths,
      ...(existing.work_order_id ? [`/maintenance/work-orders/${existing.work_order_id}`] : []),
      '/work-orders',
      '/command',
      '/spare-parts',
      '/logistics',
    ]);
    return { success: true, data: update.data };
  } catch (err) {
    return actionError(err, 'Failed to update part need');
  }
}
