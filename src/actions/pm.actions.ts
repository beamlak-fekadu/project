'use server';

import { z } from 'zod';
import { recomputeAssetAnalytics } from './analytics.actions';
import { getActionContextForCapability, logServerAuditEvent, revalidateMany, actionError, nullIfEmpty, interpretMissingMutationResult, type ActionResult } from './_shared';
import { OPEN_MAINTENANCE_REQUEST_STATUSES } from '@/utils/maintenance/request-status';
import { datePlusDays } from '@/utils/pm/semantics';
import {
  createNotificationEvent,
  emitNotificationEvent,
  makeFailedNotificationResult,
  notificationDeliveryNeedsReview,
  notificationReviewDetail,
} from '@/services/notifications/notification-engine';

const pmPaths = ['/pm', '/calendar', '/command', '/reports/pm'];
const ACTIVE_PM_SCHEDULE_STATUSES = ['scheduled', 'in_progress', 'overdue', 'deferred'] as const;

const PM_ASSIGNMENT_SELECT = `
  id, plan_id, asset_id, scheduled_date, status, assigned_to, notes,
  result, completion_checklist, completion_notes, final_equipment_condition,
  corrective_action_needed, skipped_reason, deferred_until, deferred_reason,
  completed_by, completed_at, started_at, created_at, updated_at,
  assigned_to_profile:profiles!pm_schedules_assigned_to_fkey(id, full_name, email)
`;

type PMAssignmentWarning =
  | 'audit_log_failed'
  | 'notification_delivery_needs_review';

type PMAssignmentResult = {
  schedule: Record<string, unknown>;
  assignedTechnician: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
  warnings: PMAssignmentWarning[];
  notificationStatus?: {
    rule_status: 'matched' | 'skipped' | 'failed';
    notification_count: number;
    recipients_resolved?: number;
    warnings?: string[];
    errors?: string[];
    error?: string;
    detail?: string | null;
  };
  auditStatus?: {
    success: boolean;
    error?: string;
  };
};

const pmResultToCondition = {
  pass: 'functional',
  issue_found: 'needs_repair',
  failed: 'non_functional',
} as const;

const pmCompletionSchema = z.object({
  schedule_id: z.string().min(1),
  completed_by: z.string().optional().nullable(),
  completion_date: z.string().min(1),
  duration_hours: z.coerce.number().optional().nullable(),
  result: z.enum(['pass', 'issue_found', 'failed']),
  checklist_results: z.array(z.object({
    task: z.string(),
    required: z.boolean().optional().default(false),
    completed: z.boolean().optional(),
    notes: z.string().optional().nullable(),
  })).default([]),
  notes: z.string().optional().nullable(),
  final_equipment_condition: z.enum(['functional', 'needs_repair', 'non_functional', 'under_maintenance']).optional().nullable(),
  corrective_action_needed: z.boolean().optional(),
  create_corrective_request: z.boolean().optional(),
});

const deferSkipSchema = z.object({
  schedule_id: z.string().min(1),
  action_type: z.enum(['skip', 'defer']),
  reason: z.string().trim().min(3),
  new_scheduled_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

async function getScheduleContext(supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>, id: string) {
  return supabase
    .from('pm_schedules')
    .select('*, pm_plans(id, name, frequency_days), equipment_assets(id, name, asset_code, department_id)')
    .eq('id', id)
    .maybeSingle();
}

async function getAssignableTechnicianForPM(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  profileId: string,
) {
  return supabase
    .from('profiles')
    .select('id, user_id, full_name, email, is_active, user_roles!user_roles_user_id_fkey!inner(roles!inner(name))')
    .eq('id', profileId)
    .eq('is_active', true)
    .eq('user_roles.roles.name', 'technician')
    .maybeSingle();
}

function isPostgrestSingularCoercionError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const row = error as { code?: unknown; message?: unknown };
  return row.code === 'PGRST116' || String(row.message ?? '').includes('Cannot coerce the result to a single JSON object');
}

export async function createPMPlanAction(payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('pm.plan.create');
    if (error || !profile) return { success: false, error };
    const parsed = z.object({
      asset_id: z.string().min(1),
      template_id: z.string().optional().nullable(),
      name: z.string().trim().min(3),
      frequency_days: z.coerce.number().int().min(1),
      next_due_date: z.string().optional().nullable(),
      last_completed_date: z.string().optional().nullable(),
      is_active: z.boolean().optional(),
      created_by: z.string().optional().nullable(),
    }).parse(payload);
    const data = { ...parsed, template_id: nullIfEmpty(parsed.template_id), next_due_date: nullIfEmpty(parsed.next_due_date), last_completed_date: nullIfEmpty(parsed.last_completed_date), is_active: parsed.is_active ?? true, created_by: nullIfEmpty(parsed.created_by) ?? profile.id };
    const result = await supabase.from('pm_plans').insert(data as never).select('*').single();
    if (result.error) return { success: false, error: result.error.message };
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'pm_plan.create', entityType: 'pm_plans', entityId: (result.data as { id?: string }).id ?? null, newValues: result.data as Record<string, unknown> });
    revalidateMany(pmPaths);
    return { success: true, data: result.data };
  } catch (err) {
    return actionError(err, 'Failed to create PM plan');
  }
}

export async function updateScheduleStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('pm.complete');
    if (error || !profile) return { success: false, error };
    const parsedStatus = z.enum(['scheduled', 'completed', 'overdue', 'skipped', 'deferred', 'in_progress', 'canceled']).parse(status);
    const oldRow = await supabase.from('pm_schedules').select('*').eq('id', id).maybeSingle();
    // SHAPE-01: maybeSingle handles RLS-filtered rows cleanly.
    const result = await supabase.from('pm_schedules').update({ status: parsedStatus } as never).eq('id', id).select('*').maybeSingle();
    if (result.error) return { success: false, error: result.error.message };
    if (!result.data) {
      return interpretMissingMutationResult({
        entity: 'PM schedule',
        entityId: id,
        attempted: `status=${parsedStatus}`,
        profileId: profile.id,
      });
    }
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'pm_schedule.status_update', entityType: 'pm_schedules', entityId: id, oldValues: oldRow.data as Record<string, unknown> | null, newValues: result.data as Record<string, unknown> });
    const assetId = (result.data as Record<string, unknown>).asset_id as string | undefined;
    if (parsedStatus === 'completed' && assetId) {
      try {
        await recomputeAssetAnalytics(assetId);
      } catch (refreshErr) {
        // ANALYTICS-01: surface refresh failure (was silently swallowed).
        const message = refreshErr instanceof Error ? refreshErr.message : 'unknown';
        await logServerAuditEvent({
          supabase, profileId: profile.id,
          action: 'pm_schedule.analytics_refresh_failed',
          entityType: 'pm_schedules', entityId: id,
          details: { asset_id: assetId, error: message },
        });
      }
    }
    revalidateMany([...pmPaths, `/pm/schedules/${id}`]);
    return { success: true, data: result.data };
  } catch (err) {
    return actionError(err, 'Failed to update PM schedule');
  }
}

export async function createPMCompletionAction(payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('pm.complete');
    if (error || !profile) return { success: false, error };
    const parsed = pmCompletionSchema.parse(payload);
    const completedBy = nullIfEmpty(parsed.completed_by) ?? profile.id;
    const finalCondition = parsed.final_equipment_condition ?? pmResultToCondition[parsed.result];
    const correctiveNeeded = parsed.corrective_action_needed ?? parsed.result !== 'pass';

    const scheduleRes = await getScheduleContext(supabase, parsed.schedule_id);
    if (scheduleRes.error) return { success: false, error: scheduleRes.error.message };
    if (!scheduleRes.data) return { success: false, error: 'PM schedule not found' };
    const schedule = scheduleRes.data as Record<string, unknown>;
    const assetId = schedule.asset_id as string;
    const planId = schedule.plan_id as string;
    const plan = schedule.pm_plans as { id?: string; name?: string; frequency_days?: number } | null;
    const asset = schedule.equipment_assets as { id?: string; name?: string; asset_code?: string; department_id?: string | null } | null;

    const data = {
      schedule_id: parsed.schedule_id,
      completed_by: completedBy,
      completion_date: parsed.completion_date,
      duration_hours: parsed.duration_hours ?? null,
      notes: nullIfEmpty(parsed.notes),
      checklist_results: parsed.checklist_results ?? [],
    };
    // PM-01: completion must be transactionally safe or fail loud.
    // The legacy sequence (insert pm_completions → update pm_schedules →
    // update pm_plans → update equipment_assets) left orphan completion
    // rows behind whenever any subsequent step failed (RLS, constraint,
    // FK). We now:
    //   1) Insert pm_completions.
    //   2) Update pm_schedules. If this fails, COMPENSATE by deleting the
    //      pm_completions row we just inserted, then return error.
    //   3) Update pm_plans / equipment_assets. Each failure is captured
    //      as a structured warning. The completion stays — it represents
    //      true work done — but the caller sees what didn't update.
    //   4) Notification + analytics refresh failures also surface as
    //      warnings rather than swallowed errors.
    const warnings: string[] = [];
    const result = await supabase.from('pm_completions').insert(data as never).select('*').single();
    if (result.error) return { success: false, error: result.error.message };

    const completionId = (result.data as { id?: string }).id ?? null;

    // SHAPE-01: maybeSingle handles RLS-filtered rows cleanly (PGRST116 was
    // possible here; PM-01 already rolls back on hard error but the 0-row
    // case should also trigger rollback rather than leak a coerce-to-single
    // error string).
    const scheduleUpdate = await supabase
      .from('pm_schedules')
      .update({
        status: 'completed',
        result: parsed.result,
        completion_checklist: parsed.checklist_results,
        completion_notes: nullIfEmpty(parsed.notes),
        final_equipment_condition: finalCondition,
        corrective_action_needed: correctiveNeeded,
        completed_by: completedBy,
        completed_at: new Date(`${parsed.completion_date}T12:00:00`).toISOString(),
      } as never)
      .eq('id', parsed.schedule_id)
      .select('*')
      .maybeSingle();
    if (scheduleUpdate.error || !scheduleUpdate.data) {
      // PM-01 compensating action: roll back the completion row so the
      // database is not left with evidence-of-work that the schedule
      // doesn't reflect. Audit both the failure AND the rollback.
      if (completionId) {
        await supabase.from('pm_completions').delete().eq('id', completionId);
      }
      const errMsg = scheduleUpdate.error?.message ?? 'PM schedule was not updated (0 rows; likely RLS or already deleted).';
      await logServerAuditEvent({
        supabase,
        profileId: profile.id,
        action: 'pm_completion.rolled_back',
        entityType: 'pm_schedules',
        entityId: parsed.schedule_id,
        details: {
          reason: 'pm_schedule_update_failed',
          db_error: errMsg,
          rolled_back_completion_id: completionId,
        },
      });
      return {
        success: false,
        error: `PM schedule update failed and the completion row was rolled back. Cause: ${errMsg}`,
      };
    }

    const nextDueDate = plan?.frequency_days ? datePlusDays(parsed.completion_date, plan.frequency_days) : null;
    const planUpdate = await supabase
      .from('pm_plans')
      .update({
        last_completed_date: parsed.completion_date,
        next_due_date: nextDueDate,
      } as never)
      .eq('id', planId);
    if (planUpdate.error) {
      warnings.push(`PM plan next_due_date could not be updated: ${planUpdate.error.message}`);
      await logServerAuditEvent({
        supabase,
        profileId: profile.id,
        action: 'pm_completion.plan_update_failed',
        entityType: 'pm_plans',
        entityId: planId,
        details: { schedule_id: parsed.schedule_id, db_error: planUpdate.error.message },
      });
    }

    // PM-01: equipment condition update was previously swallowed via
    // `.catch(() => undefined)` / fire-and-forget. Now we surface failures.
    const conditionUpdate = await supabase
      .from('equipment_assets')
      .update({ condition: finalCondition } as never)
      .eq('id', assetId);
    if (conditionUpdate.error) {
      warnings.push(
        `Equipment condition could not be updated to '${finalCondition}': ${conditionUpdate.error.message}`,
      );
      await logServerAuditEvent({
        supabase,
        profileId: profile.id,
        action: 'pm_completion.condition_update_failed',
        entityType: 'equipment_assets',
        entityId: assetId,
        details: { schedule_id: parsed.schedule_id, db_error: conditionUpdate.error.message },
      });
    }

    let correctiveRequestId: string | null = null;
    if (parsed.create_corrective_request && correctiveNeeded) {
      const existing = await supabase
        .from('maintenance_requests')
        .select('id, request_number, status')
        .eq('asset_id', assetId)
        .in('status', [...OPEN_MAINTENANCE_REQUEST_STATUSES])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing.data?.id) {
        correctiveRequestId = existing.data.id as string;
      } else {
        const request = await supabase
          .from('maintenance_requests')
          .insert({
            request_number: `MR-${Date.now().toString(36).toUpperCase()}`,
            asset_id: assetId,
            requested_by: profile.id,
            department_id: asset?.department_id ?? profile.department_id,
            fault_description: `PM completion for ${asset?.asset_code ?? 'asset'} found ${parsed.result.replace(/_/g, ' ')}. ${parsed.notes ?? 'Review PM evidence and decide corrective action.'}`,
            urgency: parsed.result === 'failed' ? 'high' : 'medium',
            status: 'pending',
            notes: `Source: PM completion\nPM schedule: ${parsed.schedule_id}\nPlan: ${plan?.name ?? 'Preventive maintenance'}\nResult: ${parsed.result}`,
            reported_condition: finalCondition === 'functional' ? 'functional_issue' : finalCondition,
            reported_condition_source: 'pm-completion',
          } as never)
          .select('id')
          .single();
        if (!request.error) correctiveRequestId = (request.data as { id?: string }).id ?? null;
      }
    }

    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'pm_completion.create', entityType: 'pm_completions', entityId: (result.data as { id?: string }).id ?? null, newValues: result.data as Record<string, unknown> });
    // PM-01 + ANALYTICS-01: stop swallowing analytics refresh failures.
    // PM compliance/reliability metrics that don't refresh will silently
    // diverge from dashboards otherwise.
    if (assetId) {
      try {
        await recomputeAssetAnalytics(assetId);
      } catch (refreshErr) {
        const message = refreshErr instanceof Error ? refreshErr.message : 'unknown';
        warnings.push(`Analytics recompute failed for asset ${assetId}: ${message}. PM compliance and reliability metrics may be stale until the next scheduled refresh.`);
        await logServerAuditEvent({
          supabase,
          profileId: profile.id,
          action: 'pm_completion.analytics_refresh_failed',
          entityType: 'equipment_assets',
          entityId: assetId,
          details: { schedule_id: parsed.schedule_id, error: message },
        });
      }
    }

    try {
      await emitNotificationEvent({
        event_type: 'pm.completed',
        source_table: 'pm_schedules',
        source_id: parsed.schedule_id,
        asset_id: assetId,
        department_id: asset?.department_id ?? null,
        priority: parsed.result === 'failed' ? 'high' : 'info',
        payload: {
          asset_name: asset?.name ?? null,
          asset_code: asset?.asset_code ?? null,
          plan_name: plan?.name ?? null,
          result: parsed.result,
        },
      });
    } catch (e) {
      console.error('[notifications] pm.completed emit failed:', e);
    }

    revalidateMany([...pmPaths, `/pm/schedules/${parsed.schedule_id}`, '/equipment', `/equipment/${assetId}`, '/maintenance']);
    return {
      success: true,
      data: {
        completion: result.data,
        schedule: scheduleUpdate.data,
        correctiveRequestId,
        // PM-01 truth: callers can detect partial-success conditions and
        // surface them as toasts. UI MUST NOT claim "PM completed" if
        // warnings is non-empty; surface it as "PM completed with
        // <n> warning(s)" so the user knows analytics/condition didn't fully
        // sync.
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  } catch (err) {
    return actionError(err, 'Failed to create PM completion');
  }
}

export async function assignPMScheduleAction(id: string, assignedTo: string | null): Promise<ActionResult<PMAssignmentResult>> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('pm.assign');
    if (error || !profile) {
      return {
        success: false,
        error: error === 'Insufficient permissions' ? 'You do not have permission to assign PM tasks.' : (error ?? 'Not authenticated'),
      };
    }
    const assignee = nullIfEmpty(assignedTo) as string | null;
    const oldRow = await supabase
      .from('pm_schedules')
      .select('id, asset_id, assigned_to, status, scheduled_date, notes')
      .eq('id', id)
      .maybeSingle();
    if (oldRow.error) {
      if (isPostgrestSingularCoercionError(oldRow.error)) {
        return { success: false, error: 'PM task could not be assigned because the task lookup returned an unexpected shape.' };
      }
      return { success: false, error: oldRow.error.message };
    }
    if (!oldRow.data) {
      return { success: false, error: 'PM task could not be assigned because it was not found.' };
    }

    let assignedTechnician: PMAssignmentResult['assignedTechnician'] = null;
    let assignedTechnicianHasAuthLink = false;
    if (assignee) {
      const technicianRes = await getAssignableTechnicianForPM(supabase, assignee);
      if (technicianRes.error) return { success: false, error: technicianRes.error.message };
      if (!technicianRes.data) return { success: false, error: 'Selected technician profile is not available.' };
      const technicianRow = technicianRes.data as { id: string; user_id?: string | null; full_name: string | null; email: string | null };
      assignedTechnician = {
        id: technicianRow.id,
        full_name: technicianRow.full_name,
        email: technicianRow.email,
      };
      assignedTechnicianHasAuthLink = !!technicianRow.user_id;
    }

    const result = await supabase
      .from('pm_schedules')
      .update({ assigned_to: assignee } as never)
      .eq('id', id)
      .select(PM_ASSIGNMENT_SELECT)
      .maybeSingle();
    if (result.error) {
      if (isPostgrestSingularCoercionError(result.error)) {
        return { success: false, error: 'PM task could not be assigned because the update did not return exactly one task.' };
      }
      return { success: false, error: result.error.message };
    }
    if (!result.data) {
      return {
        success: false,
        error: 'PM task could not be assigned because database policy blocked the update. Apply migration 00070 to grant PM schedule assignment to BME Head.',
      };
    }

    const warnings: PMAssignmentWarning[] = [];
    let auditStatus: PMAssignmentResult['auditStatus'] = { success: true };
    const audit = await supabase.from('audit_logs').insert({
      user_id: profile.id,
      performed_by: profile.id,
      action: 'pm_schedule.assign',
      entity_type: 'pm_schedules',
      entity_id: id,
      old_values: oldRow.data as Record<string, unknown>,
      new_values: result.data as Record<string, unknown>,
      details: {
        assigned_technician_profile_id: assignee,
        assigned_technician_name: assignedTechnician?.full_name ?? null,
      },
    });
    if (audit.error) {
      warnings.push('audit_log_failed');
      auditStatus = { success: false, error: audit.error.message };
      console.error('[audit] PM assignment audit write failed:', audit.error.message);
    }
    const assetId = (result.data as Record<string, unknown>).asset_id as string | undefined;
    let notificationStatus: PMAssignmentResult['notificationStatus'];
    if (assignee && assetId) {
      try {
        const { data: asset } = await supabase
          .from('equipment_assets')
          .select('name, asset_code, department_id')
          .eq('id', assetId)
          .maybeSingle();
        const assetRow = (asset ?? null) as { name?: string | null; asset_code?: string | null; department_id?: string | null } | null;
        const notification = await createNotificationEvent({
          event_type: 'pm.assigned',
          source_table: 'pm_schedules',
          source_id: id,
          asset_id: assetId,
          department_id: assetRow?.department_id ?? null,
          priority: 'medium',
          payload: {
            asset_name: assetRow?.name ?? null,
            asset_code: assetRow?.asset_code ?? null,
            assigned_to: assignee,
            technician_user_id_present: assignedTechnicianHasAuthLink,
          },
        }, { createdBy: profile.id });
        notificationStatus = {
          rule_status: notification.rule_status,
          notification_count: notification.notifications.length,
          recipients_resolved: notification.recipientsResolved,
          warnings: notification.warnings,
          errors: notification.errors,
          error: notification.error,
          detail: notificationReviewDetail(notification),
        };
        if (notificationDeliveryNeedsReview(notification)) {
          warnings.push('notification_delivery_needs_review');
        }
      } catch (e) {
        console.error('[notifications] pm.assigned emit failed:', e);
        const failed = makeFailedNotificationResult('pm.assigned', e);
        if (notificationDeliveryNeedsReview(failed)) warnings.push('notification_delivery_needs_review');
        notificationStatus = {
          rule_status: 'failed',
          notification_count: failed.notificationCount,
          recipients_resolved: failed.recipientsResolved,
          warnings: failed.warnings,
          errors: failed.errors,
          error: failed.errors[0],
          detail: notificationReviewDetail(failed),
        };
      }
    }
    if (warnings.includes('notification_delivery_needs_review')) {
      await logServerAuditEvent({
        supabase,
        profileId: profile.id,
        action: 'pm_schedule.assignment_notification_failed',
        entityType: 'pm_schedules',
        entityId: id,
        details: notificationStatus
          ? {
            error: notificationStatus.error ?? null,
            notification_count: notificationStatus.notification_count,
            recipients_resolved: notificationStatus.recipients_resolved ?? null,
            warnings: notificationStatus.warnings ?? [],
            errors: notificationStatus.errors ?? [],
          }
          : null,
      });
    }
    revalidateMany([...pmPaths, `/pm/schedules/${id}`, assetId ? `/equipment/${assetId}` : '/equipment']);
    return {
      success: true,
      data: {
        schedule: result.data as Record<string, unknown>,
        assignedTechnician,
        warnings,
        notificationStatus,
        auditStatus,
      },
    };
  } catch (err) {
    return actionError(err, 'Failed to assign PM schedule') as ActionResult<PMAssignmentResult>;
  }
}

export async function startPMScheduleAction(id: string): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('pm.complete');
    if (error || !profile) return { success: false, error };
    const oldRow = await supabase.from('pm_schedules').select('*').eq('id', id).maybeSingle();
    // SHAPE-01: maybeSingle handles RLS-filtered rows cleanly.
    const result = await supabase
      .from('pm_schedules')
      .update({ status: 'in_progress', started_at: new Date().toISOString() } as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (result.error) return { success: false, error: result.error.message };
    if (!result.data) {
      return interpretMissingMutationResult({
        entity: 'PM schedule',
        entityId: id,
        attempted: 'start (in_progress)',
        profileId: profile.id,
      });
    }
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'pm_schedule.start', entityType: 'pm_schedules', entityId: id, oldValues: oldRow.data as Record<string, unknown> | null, newValues: result.data as Record<string, unknown> });
    const assetId = (result.data as Record<string, unknown>).asset_id as string | undefined;
    revalidateMany([...pmPaths, `/pm/schedules/${id}`, assetId ? `/equipment/${assetId}` : '/equipment']);
    return { success: true, data: result.data };
  } catch (err) {
    return actionError(err, 'Failed to start PM schedule');
  }
}

export async function deferOrSkipPMScheduleAction(payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('pm.complete');
    if (error || !profile) return { success: false, error };
    const parsed = deferSkipSchema.parse(payload);
    const oldRow = await supabase.from('pm_schedules').select('*').eq('id', parsed.schedule_id).maybeSingle();
    const updatePayload: Record<string, unknown> = {
      status: parsed.action_type === 'skip' ? 'skipped' : 'deferred',
      notes: nullIfEmpty(parsed.notes),
    };
    if (parsed.action_type === 'skip') updatePayload.skipped_reason = parsed.reason;
    if (parsed.action_type === 'defer') {
      updatePayload.deferred_reason = parsed.reason;
      updatePayload.deferred_until = nullIfEmpty(parsed.new_scheduled_date);
      if (parsed.new_scheduled_date) updatePayload.scheduled_date = parsed.new_scheduled_date;
    }
    // SHAPE-01: maybeSingle handles RLS-filtered rows cleanly.
    const result = await supabase
      .from('pm_schedules')
      .update(updatePayload as never)
      .eq('id', parsed.schedule_id)
      .select('*')
      .maybeSingle();
    if (result.error) return { success: false, error: result.error.message };
    if (!result.data) {
      return interpretMissingMutationResult({
        entity: 'PM schedule',
        entityId: parsed.schedule_id,
        attempted: parsed.action_type,
        profileId: profile.id,
      });
    }
    await logServerAuditEvent({ supabase, profileId: profile.id, action: `pm_schedule.${parsed.action_type}`, entityType: 'pm_schedules', entityId: parsed.schedule_id, oldValues: oldRow.data as Record<string, unknown> | null, newValues: result.data as Record<string, unknown> });
    const assetId = (result.data as Record<string, unknown>).asset_id as string | undefined;
    // ANALYTICS-01: surface refresh failure as warning.
    let deferAnalyticsWarning: string | null = null;
    if (assetId) {
      try {
        await recomputeAssetAnalytics(assetId);
      } catch (refreshErr) {
        const message = refreshErr instanceof Error ? refreshErr.message : 'unknown';
        deferAnalyticsWarning = `PM analytics refresh failed: ${message}. PM compliance may be stale until the next scheduled refresh.`;
        await logServerAuditEvent({
          supabase, profileId: profile.id,
          action: 'pm_schedule.analytics_refresh_failed',
          entityType: 'pm_schedules', entityId: parsed.schedule_id,
          details: { asset_id: assetId, action_type: parsed.action_type, error: message },
        });
      }
    }
    revalidateMany([...pmPaths, `/pm/schedules/${parsed.schedule_id}`, assetId ? `/equipment/${assetId}` : '/equipment']);
    return {
      success: true,
      data: deferAnalyticsWarning
        ? { ...(result.data as Record<string, unknown>), analytics_refresh_warning: deferAnalyticsWarning }
        : result.data,
    };
  } catch (err) {
    return actionError(err, 'Failed to defer or skip PM schedule');
  }
}

export async function updatePMPlanStatusAction(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('pm.plan.create');
    if (error || !profile) return { success: false, error };
    const oldRow = await supabase.from('pm_plans').select('*').eq('id', id).maybeSingle();
    // SHAPE-01: maybeSingle handles RLS-filtered rows cleanly.
    const result = await supabase.from('pm_plans').update({ is_active: isActive } as never).eq('id', id).select('*').maybeSingle();
    if (result.error) return { success: false, error: result.error.message };
    if (!result.data) {
      return interpretMissingMutationResult({
        entity: 'PM plan',
        entityId: id,
        attempted: `is_active=${isActive}`,
        profileId: profile.id,
      });
    }
    await logServerAuditEvent({ supabase, profileId: profile.id, action: isActive ? 'pm_plan.activate' : 'pm_plan.pause', entityType: 'pm_plans', entityId: id, oldValues: oldRow.data as Record<string, unknown> | null, newValues: result.data as Record<string, unknown> });
    revalidateMany(pmPaths);
    return { success: true, data: result.data };
  } catch (err) {
    return actionError(err, 'Failed to update PM plan');
  }
}

export async function pausePMPlanAction(id: string, reason?: string | null): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('pm.plan.create');
    if (error || !profile) return { success: false, error };
    const oldRow = await supabase.from('pm_plans').select('*').eq('id', id).maybeSingle();
    if (oldRow.error) return { success: false, error: oldRow.error.message };
    if (!oldRow.data) return { success: false, error: 'PM plan not found' };
    // SHAPE-01: maybeSingle handles RLS-filtered rows cleanly.
    const result = await supabase.from('pm_plans').update({ is_active: false } as never).eq('id', id).select('*').maybeSingle();
    if (result.error) return { success: false, error: result.error.message };
    if (!result.data) {
      return interpretMissingMutationResult({
        entity: 'PM plan',
        entityId: id,
        attempted: 'pause (is_active=false)',
        profileId: profile.id,
      });
    }
    const assetId = (result.data as Record<string, unknown>).asset_id as string | undefined;
    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'pm_plan.pause',
      entityType: 'pm_plans',
      entityId: id,
      oldValues: oldRow.data as Record<string, unknown> | null,
      newValues: result.data as Record<string, unknown>,
      details: { reason: nullIfEmpty(reason) },
    });
    revalidateMany([...pmPaths, `/pm/plans/${id}/history`, assetId ? `/equipment/${assetId}` : '/equipment']);
    return { success: true, data: result.data };
  } catch (err) {
    return actionError(err, 'Failed to pause PM plan');
  }
}

export async function resumePMPlanAction(id: string): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('pm.plan.create');
    if (error || !profile) return { success: false, error };
    const oldRow = await supabase.from('pm_plans').select('*').eq('id', id).maybeSingle();
    if (oldRow.error) return { success: false, error: oldRow.error.message };
    if (!oldRow.data) return { success: false, error: 'PM plan not found' };
    // SHAPE-01: maybeSingle handles RLS-filtered rows cleanly.
    const result = await supabase.from('pm_plans').update({ is_active: true } as never).eq('id', id).select('*').maybeSingle();
    if (result.error) return { success: false, error: result.error.message };
    if (!result.data) {
      return interpretMissingMutationResult({
        entity: 'PM plan',
        entityId: id,
        attempted: 'resume (is_active=true)',
        profileId: profile.id,
      });
    }
    const assetId = (result.data as Record<string, unknown>).asset_id as string | undefined;
    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'pm_plan.resume',
      entityType: 'pm_plans',
      entityId: id,
      oldValues: oldRow.data as Record<string, unknown> | null,
      newValues: result.data as Record<string, unknown>,
    });
    revalidateMany([...pmPaths, `/pm/plans/${id}/history`, assetId ? `/equipment/${assetId}` : '/equipment']);
    return { success: true, data: result.data };
  } catch (err) {
    return actionError(err, 'Failed to resume PM plan');
  }
}

export async function generateNextPMScheduleAction(planId: string): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('pm.plan.create');
    if (error || !profile) return { success: false, error };
    const planRes = await supabase.from('pm_plans').select('*').eq('id', planId).maybeSingle();
    if (planRes.error) return { success: false, error: planRes.error.message };
    if (!planRes.data) return { success: false, error: 'PM plan not found' };
    const plan = planRes.data as Record<string, unknown>;
    if (plan.is_active === false) return { success: false, error: 'Resume this PM plan before generating the next task.' };

    const existingActive = await supabase
      .from('pm_schedules')
      .select('id, plan_id, asset_id, scheduled_date, status')
      .eq('plan_id', planId)
      .in('status', [...ACTIVE_PM_SCHEDULE_STATUSES])
      .order('scheduled_date', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingActive.error) return { success: false, error: existingActive.error.message };
    if (existingActive.data?.id) {
      return { success: true, data: { schedule: existingActive.data, existing: true, message: 'This plan already has an unfinished PM task.' } };
    }

    const frequencyDays = Number(plan.frequency_days ?? 90);
    let scheduledDate = (plan.next_due_date as string | null)
      ?? (plan.last_completed_date ? datePlusDays(plan.last_completed_date as string, frequencyDays) : null)
      ?? new Date().toISOString().split('T')[0];

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const sameDate = await supabase
        .from('pm_schedules')
        .select('id, status')
        .eq('plan_id', planId)
        .eq('scheduled_date', scheduledDate)
        .limit(1)
        .maybeSingle();
      if (sameDate.error) return { success: false, error: sameDate.error.message };
      if (!sameDate.data?.id) break;
      scheduledDate = datePlusDays(scheduledDate, frequencyDays);
    }

    const result = await supabase
      .from('pm_schedules')
      .insert({
        plan_id: planId,
        asset_id: plan.asset_id,
        scheduled_date: scheduledDate,
        status: 'scheduled',
      } as never)
      .select('*')
      .single();
    if (result.error) return { success: false, error: result.error.message };
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'pm_schedule.generate_next', entityType: 'pm_schedules', entityId: (result.data as { id?: string }).id ?? null, newValues: result.data as Record<string, unknown> });
    const assetId = (result.data as Record<string, unknown>).asset_id as string | undefined;
    const scheduleId = (result.data as { id?: string }).id;
    revalidateMany([...pmPaths, `/pm/plans/${planId}/history`, scheduleId ? `/pm/schedules/${scheduleId}` : '/pm', assetId ? `/equipment/${assetId}` : '/equipment']);
    return { success: true, data: { schedule: result.data, existing: false } };
  } catch (err) {
    return actionError(err, 'Failed to generate PM schedule');
  }
}
