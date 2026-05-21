'use server';

import { z } from 'zod';
import { recomputeAssetAnalytics } from './analytics.actions';
import { updateEquipmentConditionAction } from './equipment.actions';
import { getActionContextForCapability, getActionContextForAnyCapability, logServerAuditEvent, revalidateMany, actionError, nullIfEmpty, type ActionResult } from './_shared';
import { OPEN_MAINTENANCE_REQUEST_STATUSES } from '@/utils/maintenance/request-status';
import { requiredCapabilityForWorkOrderTransition } from '@/utils/maintenance/work-order-transitions';
import { emitNotificationEvent } from '@/services/notifications/notification-engine';

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

    // Fire-and-forget notification emission. Notification failures never block
    // the primary workflow; engine logs internally.
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
      await emitNotificationEvent({
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
    }

    revalidateMany([...maintenancePaths, `/equipment/${parsed.asset_id}`]);
    return {
      success: true,
      data: conditionSyncWarning
        ? { ...(result.data as Record<string, unknown>), condition_sync_warning: conditionSyncWarning }
        : result.data,
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
      console.error('[maintenance] status update returned 0 rows; likely RLS UPDATE policy excludes role', {
        requestId: id,
        attemptedStatus: parsedStatus,
        profileId: profile.id,
      });
      return {
        success: false,
        error: 'You do not have permission to change this request, or the request no longer exists.',
      };
    }
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'maintenance_request.status_update', entityType: 'maintenance_requests', entityId: id, oldValues: oldRow.data as Record<string, unknown> | null, newValues: result.data as Record<string, unknown> });

    try {
      const row = result.data as { id?: string; asset_id?: string; request_number?: string; requested_by?: string; department_id?: string | null };
      const assetSummary = await loadAssetSummaryForNotification(supabase, row.asset_id ?? null);
      await emitNotificationEvent({
        event_type: 'maintenance_request.status_changed',
        source_table: 'maintenance_requests',
        source_id: row.id ?? null,
        asset_id: row.asset_id ?? null,
        department_id: row.department_id ?? assetSummary.department_id ?? null,
        priority: parsedStatus === 'rejected' ? 'high' : 'medium',
        payload: {
          asset_name: assetSummary.asset_name,
          asset_code: assetSummary.asset_code,
          request_number: row.request_number ?? null,
          status: parsedStatus,
          requested_by: row.requested_by ?? null,
        },
      });
    } catch (e) {
      console.error('[notifications] maintenance_request.status_changed emit failed:', e);
    }

    revalidateMany([...maintenancePaths, `/maintenance/requests/${id}`]);
    return { success: true, data: result.data };
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
        .not('status', 'in', '(completed,canceled)')
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
    let requestStatusSyncWarning: string | null = null;
    if (woRow.request_id) {
      const requestRow = await supabase
        .from('maintenance_requests')
        .select('id, status, request_number, requested_by, department_id, asset_id')
        .eq('id', woRow.request_id)
        .maybeSingle();
      const current = requestRow.data as {
        id?: string;
        status?: string;
        request_number?: string;
        requested_by?: string | null;
        department_id?: string | null;
        asset_id?: string | null;
      } | null;
      if (current && current.status && !['completed', 'rejected', 'canceled'].includes(current.status)) {
        const nextStatus = woRow.assigned_to ? 'assigned' : 'approved';
        if (current.status !== nextStatus) {
          const update = await supabase
            .from('maintenance_requests')
            .update({ status: nextStatus } as never)
            .eq('id', current.id as string)
            .select('id, status, request_number, requested_by, department_id, asset_id')
            .maybeSingle();
          if (update.error || !update.data) {
            const syncErrorMessage = update.error?.message ?? 'Request status sync returned 0 rows (likely blocked by RLS).';
            requestStatusSyncWarning = syncErrorMessage;
            await logServerAuditEvent({
              supabase,
              profileId: profile.id,
              action: 'work_order.request_status_sync_failed',
              entityType: 'maintenance_requests',
              entityId: current.id ?? null,
              details: {
                work_order_id: woRow.id ?? null,
                attempted_status: nextStatus,
                error: syncErrorMessage,
              },
            });
          } else {
            await logServerAuditEvent({
              supabase,
              profileId: profile.id,
              action: 'maintenance_request.status_synced_by_work_order',
              entityType: 'maintenance_requests',
              entityId: current.id ?? null,
              oldValues: { status: current.status },
              newValues: { status: nextStatus, work_order_id: woRow.id ?? null },
            });

            // Notification: tell requester + dept head their request moved.
            try {
              const assetSummary = await loadAssetSummaryForNotification(
                supabase,
                current.asset_id ?? woRow.asset_id ?? null,
              );
              await emitNotificationEvent({
                event_type: 'maintenance_request.status_changed',
                source_table: 'maintenance_requests',
                source_id: current.id ?? null,
                asset_id: current.asset_id ?? woRow.asset_id ?? null,
                department_id: current.department_id ?? assetSummary.department_id ?? null,
                priority: 'medium',
                payload: {
                  asset_name: assetSummary.asset_name,
                  asset_code: assetSummary.asset_code,
                  request_number: current.request_number ?? null,
                  status: nextStatus,
                  requested_by: current.requested_by ?? null,
                  triggered_by_work_order_id: woRow.id ?? null,
                  triggered_by_work_order_number: woRow.work_order_number ?? null,
                },
              });
            } catch (e) {
              console.error('[notifications] maintenance_request.status_changed (R17) emit failed:', e);
            }
          }
        }
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
      await emitNotificationEvent({
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
          assigned_to: woRow.assigned_to ?? null,
          source_request_id: woRow.request_id ?? null,
        },
      });
    } catch (e) {
      console.error('[notifications] work_order.created emit failed:', e);
    }

    revalidateMany([
      ...maintenancePaths,
      ...(woRow.request_id ? [`/maintenance/requests/${woRow.request_id}`] : []),
    ]);
    return {
      success: true,
      data: requestStatusSyncWarning
        ? { ...(result.data as Record<string, unknown>), request_status_sync_warning: requestStatusSyncWarning }
        : result.data,
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
    // R2: optional reliability evidence fields collected on completion. When
    // provided, we auto-write a maintenance_events row; migration 00061's
    // trigger then derives the matching downtime_logs row that
    // fn_compute_mtbf reads.
    const repairDurationHours = (payload as { repair_duration_hours?: number | string | null }).repair_duration_hours;
    const downtimeStart = (payload as { downtime_start?: string | null }).downtime_start;
    const downtimeEnd = (payload as { downtime_end?: string | null }).downtime_end;
    const failureDate = (payload as { failure_date?: string | null }).failure_date;
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

    const oldRow = await supabase.from('work_orders').select('*').eq('id', id).maybeSingle();
    const result = await supabase.from('work_orders').update(updatePayload as never).eq('id', id).select('*').single();
    if (result.error) return { success: false, error: result.error.message };
    await logServerAuditEvent({ supabase, profileId: profile.id, action: data.status ? 'work_order.status_update' : 'work_order.update', entityType: 'work_orders', entityId: id, oldValues: oldRow.data as Record<string, unknown> | null, newValues: result.data as Record<string, unknown> });

    const assetId = (result.data as Record<string, unknown>).asset_id as string | undefined;
    let conditionSyncWarning: string | null = null;
    // R2: warning surfaced to the caller when the completion happened but
    // reliability evidence could not be persisted. Completion still succeeds
    // (we don't roll back) — the warning is loud so the gap is visible.
    let reliabilityEvidenceWarning: string | null = null;
    if (assetId) {
      if (data.status === 'in_progress') {
        // Starting work: set equipment to under_maintenance
        const sync = await updateEquipmentConditionAction(assetId, 'under_maintenance');
        if (!sync.success) conditionSyncWarning = sync.error ?? 'Equipment condition could not be set to under_maintenance.';
      } else if (data.status === 'completed') {
        // Completion: use explicit final_equipment_condition if provided, else derive from outcome
        const conditionToSet = (finalEquipmentCondition as 'functional' | 'needs_repair' | 'non_functional' | 'under_maintenance' | undefined)
          ?? (completionOutcome ? outcomeToCondition(completionOutcome) : 'functional');
        const sync = await updateEquipmentConditionAction(assetId, conditionToSet);
        if (!sync.success) conditionSyncWarning = sync.error ?? 'Final equipment condition could not be recorded.';

        // R2: write reliability evidence. We only auto-create a
        // maintenance_events row if the caller actually supplied at least one
        // reliability field (repair_duration_hours, downtime_start, or
        // failure_date). If they didn't, we leave the event slot empty AND
        // emit a warning so the UI surfaces "completed without reliability
        // evidence". Migration 00061's trigger derives downtime_logs from
        // the event downtime_start/end pair automatically.
        const hasEvidence = (
          (repairDurationHours !== undefined && repairDurationHours !== null && repairDurationHours !== '') ||
          (downtimeStart !== undefined && downtimeStart !== null && downtimeStart !== '') ||
          (failureDate !== undefined && failureDate !== null && failureDate !== '')
        );
        const woWorkType = ((result.data as Record<string, unknown>).work_type as string | undefined) ?? 'corrective';
        if (hasEvidence) {
          const eventInsert = await supabase
            .from('maintenance_events')
            .insert({
              work_order_id: id,
              asset_id: assetId,
              event_type:
                woWorkType === 'corrective' || woWorkType === 'preventive' || woWorkType === 'inspection'
                  ? woWorkType
                  : 'corrective',
              failure_date: failureDate || null,
              downtime_start: downtimeStart || null,
              downtime_end: downtimeEnd || null,
              repair_duration_hours:
                repairDurationHours === undefined || repairDurationHours === null || repairDurationHours === ''
                  ? null
                  : Number(repairDurationHours),
              completed_by: profile.id,
              completion_date: new Date().toISOString().slice(0, 10),
              notes: 'Auto-logged from work-order completion (R2 reliability evidence pipeline).',
            } as never)
            .select('id')
            .single();
          if (eventInsert.error) {
            reliabilityEvidenceWarning = eventInsert.error.message;
            await logServerAuditEvent({
              supabase,
              profileId: profile.id,
              action: 'work_order.reliability_evidence_write_failed',
              entityType: 'work_orders',
              entityId: id,
              details: { asset_id: assetId, error: eventInsert.error.message },
            });
          } else {
            await logServerAuditEvent({
              supabase,
              profileId: profile.id,
              action: 'maintenance_event.created_from_work_order_completion',
              entityType: 'maintenance_events',
              entityId: (eventInsert.data as { id?: string }).id ?? null,
              newValues: {
                work_order_id: id,
                asset_id: assetId,
                repair_duration_hours: repairDurationHours,
                downtime_start: downtimeStart,
                downtime_end: downtimeEnd,
                failure_date: failureDate,
              },
            });
          }
        } else if (woWorkType === 'corrective') {
          // Corrective work without any reliability evidence — warn loudly.
          // Other work types (preventive/inspection/calibration/installation)
          // don't feed MTTR/MTBF the same way.
          reliabilityEvidenceWarning =
            'Completed without reliability evidence. MTTR / MTBF / availability for this asset will not change. Log a maintenance event with repair duration and downtime to update the metrics.';
          await logServerAuditEvent({
            supabase,
            profileId: profile.id,
            action: 'work_order.completed_without_reliability_evidence',
            entityType: 'work_orders',
            entityId: id,
            details: { asset_id: assetId, work_type: woWorkType },
          });
        }

        await recomputeAssetAnalytics(assetId).catch(() => undefined);
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
      await emitNotificationEvent({
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
    if (conditionSyncWarning) enriched.condition_sync_warning = conditionSyncWarning;
    if (reliabilityEvidenceWarning) enriched.reliability_evidence_warning = reliabilityEvidenceWarning;
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
      .select('id, full_name, is_active, user_roles!inner(roles!inner(name))')
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

    const result = await supabase.from('work_orders').update(updateData as never).eq('id', id).select('*').single();
    if (result.error) return { success: false, error: result.error.message };

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

    try {
      const row = result.data as { id?: string; asset_id?: string; work_order_number?: string; priority?: string };
      const assetSummary = await loadAssetSummaryForNotification(supabase, row.asset_id ?? null);
      const isCritical = row.priority === 'critical' || row.priority === 'high';
      await emitNotificationEvent({
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
          assignment_kind: action,
        },
      });
    } catch (e) {
      console.error('[notifications] work_order.assigned emit failed:', e);
    }

    revalidateMany([...maintenancePaths, `/maintenance/work-orders/${id}`]);
    return { success: true, data: result.data };
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
    await recomputeAssetAnalytics(parsed.asset_id).catch(() => undefined);
    revalidateMany(maintenancePaths);
    return { success: true, data: result.data };
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
      '/spare-parts',
      '/logistics',
    ]);
    return { success: true, data: update.data };
  } catch (err) {
    return actionError(err, 'Failed to update part need');
  }
}
