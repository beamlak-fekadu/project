'use server';

import { z } from 'zod';
import { recomputeAssetAnalytics } from './analytics.actions';
import { getActionContextForCapability, getActionContextForAnyCapability, logServerAuditEvent, revalidateMany, actionError, nullIfEmpty, interpretMissingMutationResult, runAnalyticsRefreshOrWarn, type ActionResult } from './_shared';
import { denialMessage } from '@/lib/rbac/department-scope';
import {
  NOTIFICATION_DELIVERY_REVIEW_WARNING,
  createNotificationEvent,
  makeFailedNotificationResult,
  notificationDeliveryNeedsReview,
  notificationProcessSnapshot,
  notificationReviewDetail,
} from '@/services/notifications/notification-engine';

const calibrationPaths = ['/calibration', '/calendar', '/command', '/reports/calibration'];

function calibrationRequestInsertError(message: string) {
  if (/row-level security|new row violates/i.test(message)) {
    return 'Calibration request could not be created because the database policy blocked the write. Apply migrations 00071 and 00072 so department users can create calibration requests for assets in their own department.';
  }
  return message;
}

export async function updateCalibrationRequestStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    // Status update covers approve/reject/schedule transitions; allow approve
    // or schedule capability (technicians schedule, BME Head/admin approve).
    const { supabase, profile, error } = await getActionContextForAnyCapability([
      'calibration.request.approve',
      'calibration.schedule',
    ]);
    if (error || !profile) return { success: false, error };
    const parsedStatus = z.enum(['pending', 'approved', 'in_progress', 'completed', 'rejected', 'canceled']).parse(status);
    const oldRow = await supabase.from('calibration_requests').select('*').eq('id', id).maybeSingle();
    // SHAPE-01: .maybeSingle() so RLS-filtered or already-deleted rows return
    // data=null instead of raising PGRST116. We translate that to a clear
    // user-facing message and log the raw PostgREST error for developers.
    const result = await supabase
      .from('calibration_requests')
      .update({ status: parsedStatus } as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (result.error) return { success: false, error: result.error.message };
    if (!result.data) {
      return interpretMissingMutationResult({
        entity: 'calibration request',
        entityId: id,
        attempted: `status=${parsedStatus}`,
        profileId: profile.id,
      });
    }
    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'calibration_request.status_update',
      entityType: 'calibration_requests',
      entityId: id,
      oldValues: oldRow.data as Record<string, unknown> | null,
      newValues: result.data as Record<string, unknown>,
    });
    const assetId = (result.data as Record<string, unknown>).asset_id as string | undefined;
    let analyticsWarning: string | null = null;
    if (assetId && parsedStatus === 'completed') {
      analyticsWarning = await runAnalyticsRefreshOrWarn({
        refresh: () => recomputeAssetAnalytics(assetId),
        label: 'Calibration analytics',
        audit: {
          supabase, profileId: profile.id,
          action: 'calibration_request.analytics_refresh_failed',
          entityType: 'calibration_requests', entityId: id,
          details: { asset_id: assetId },
        },
      });
    }

    // R6 + NOTIF-02: emit calibration.request_status_changed with the
    // requester identity AND the request number, so the rule can:
    //   1) resolve a requester notification (rule reads payload.requested_by)
    //   2) build a deep link to /calibration/requests/[id] (links read
    //      payload.request_id; we also pass source_id which links honor)
    // Before this fix the payload omitted both — the requester would never
    // see "your calibration request was rejected/approved".
    try {
      const { data: asset } = await supabase
        .from('equipment_assets')
        .select('name, asset_code, department_id')
        .eq('id', assetId ?? '')
        .maybeSingle();
      const row = (asset ?? null) as { name?: string | null; asset_code?: string | null; department_id?: string | null } | null;
      const oldRequest = (oldRow.data ?? null) as {
        requested_by?: string | null;
        request_number?: string | null;
        urgency?: string | null;
      } | null;
      const { emitNotificationEvent } = await import('@/services/notifications/notification-engine');
      await emitNotificationEvent({
        event_type: 'calibration.request_status_changed',
        source_table: 'calibration_requests',
        source_id: id,
        asset_id: assetId ?? null,
        department_id: row?.department_id ?? null,
        // Rejection is more attention-worthy than routine status moves.
        priority: parsedStatus === 'rejected' ? 'high' : 'medium',
        payload: {
          asset_name: row?.name ?? null,
          asset_code: row?.asset_code ?? null,
          status: parsedStatus,
          // NOTIF-02 fix: requester id (profiles.id, NOT auth user id) so
          // the rule can fire the requester-update notification.
          requested_by: oldRequest?.requested_by ?? null,
          // NOTIF-02 fix: request id + number drive the calibration deep link
          // to /calibration/requests/[id] instead of /calibration generic.
          request_id: id,
          request_number: oldRequest?.request_number ?? null,
          urgency: oldRequest?.urgency ?? null,
        },
      });
    } catch (e) {
      console.error('[notifications] calibration.request_status_changed emit failed:', e);
    }

    revalidateMany([...calibrationPaths, `/calibration/requests/${id}`, ...(assetId ? [`/equipment/${assetId}`] : [])]);
    // ANALYTICS-01: propagate analytics warning into the action result so
    // the UI can surface "Action succeeded; metrics may be stale."
    const responseData = analyticsWarning
      ? { ...(result.data as Record<string, unknown>), analytics_refresh_warning: analyticsWarning }
      : result.data;
    return { success: true, data: responseData };
  } catch (err) {
    return actionError(err, 'Failed to update calibration request');
  }
}

export async function createCalibrationRequestAction(payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('calibration.request.create');
    if (error || !profile) return { success: false, error };
    const parsed = z.object({
      asset_id: z.string().min(1),
      requested_by: z.string().optional().nullable(),
      calibration_type_id: z.string().optional().nullable(),
      urgency: z.enum(['low', 'medium', 'high', 'critical']),
      status: z.string().optional(),
      notes: z.string().optional().nullable(),
    }).parse(payload);
    if (profile.departmentScope.kind === 'denied') {
      return { success: false, error: denialMessage(profile.departmentScope.reason) };
    }

    const assetLookup = await supabase
      .from('equipment_assets')
      .select('id, department_id')
      .eq('id', parsed.asset_id)
      .maybeSingle();
    if (assetLookup.error) return { success: false, error: assetLookup.error.message };
    if (!assetLookup.data) {
      return {
        success: false,
        error: 'Calibration request could not be created because the selected asset was not found or is outside your department.',
      };
    }

    const asset = assetLookup.data as { id: string; department_id: string | null };
    if (profile.departmentScope.kind === 'department' && asset.department_id !== profile.departmentScope.departmentId) {
      return {
        success: false,
        error: 'Calibration request could not be created because the selected asset is outside your department.',
      };
    }

    const data = { ...parsed, request_number: `CAL-${Date.now().toString(36).toUpperCase()}`, requested_by: nullIfEmpty(parsed.requested_by) ?? profile.id, calibration_type_id: nullIfEmpty(parsed.calibration_type_id), status: 'pending', notes: nullIfEmpty(parsed.notes) };
    const result = await supabase.from('calibration_requests').insert(data as never).select('*').single();
    if (result.error) {
      await logServerAuditEvent({
        supabase,
        profileId: profile.id,
        action: 'calibration_request.create_blocked',
        entityType: 'calibration_requests',
        entityId: null,
        details: {
          asset_id: parsed.asset_id,
          required_migrations: ['00071_calibration_request_department_rls', '00072_calibration_request_insert_policy_helper'],
          postgrest_error: {
            message: result.error.message,
            code: result.error.code,
            details: result.error.details,
            hint: result.error.hint,
          },
        },
      });
      return { success: false, error: calibrationRequestInsertError(result.error.message) };
    }
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'calibration_request.create', entityType: 'calibration_requests', entityId: (result.data as { id?: string }).id ?? null, newValues: result.data as Record<string, unknown> });
    const createAnalyticsWarning = await runAnalyticsRefreshOrWarn({
      refresh: () => recomputeAssetAnalytics(parsed.asset_id),
      label: 'Calibration analytics',
      audit: {
        supabase, profileId: profile.id,
        action: 'calibration_request.analytics_refresh_failed',
        entityType: 'calibration_requests', entityId: (result.data as { id?: string }).id ?? null,
        details: { asset_id: parsed.asset_id },
      },
    });

    try {
      const { data: asset } = await supabase
        .from('equipment_assets')
        .select('name, asset_code, department_id')
        .eq('id', parsed.asset_id)
        .maybeSingle();
      const row = (asset ?? null) as { name?: string | null; asset_code?: string | null; department_id?: string | null } | null;
      const inserted = result.data as { id?: string };
      const { emitNotificationEvent } = await import('@/services/notifications/notification-engine');
      await emitNotificationEvent({
        event_type: 'calibration.request_created',
        source_table: 'calibration_requests',
        source_id: inserted.id ?? null,
        asset_id: parsed.asset_id,
        department_id: row?.department_id ?? null,
        priority: parsed.urgency === 'critical' ? 'critical' : parsed.urgency === 'high' ? 'high' : 'medium',
        payload: {
          asset_name: row?.name ?? null,
          asset_code: row?.asset_code ?? null,
          request_id: inserted.id ?? null,
          requested_by: data.requested_by ?? null,
          urgency: parsed.urgency,
        },
      });
    } catch (e) {
      console.error('[notifications] calibration.request_created emit failed:', e);
    }

    revalidateMany(calibrationPaths);
    const responseDataCreate = createAnalyticsWarning
      ? { ...(result.data as Record<string, unknown>), analytics_refresh_warning: createAnalyticsWarning }
      : result.data;
    return { success: true, data: responseDataCreate };
  } catch (err) {
    return actionError(err, 'Failed to create calibration request');
  }
}

export async function createCalibrationRecordAction(payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('calibration.record_result');
    if (error || !profile) return { success: false, error };
    const parsed = z.object({
      asset_id: z.string().min(1),
      calibration_type_id: z.string().optional().nullable(),
      calibrated_by: z.string().optional().nullable(),
      calibration_date: z.string().min(1),
      next_due_date: z.string().optional().nullable(),
      result: z.enum(['pass', 'fail', 'adjusted']),
      certificate_path: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(payload);
    const data = { ...parsed, calibration_type_id: nullIfEmpty(parsed.calibration_type_id), calibrated_by: nullIfEmpty(parsed.calibrated_by), next_due_date: nullIfEmpty(parsed.next_due_date), certificate_path: nullIfEmpty(parsed.certificate_path), notes: nullIfEmpty(parsed.notes) };
    const result = await supabase.from('calibration_records').insert(data as never).select('*').single();
    if (result.error) return { success: false, error: result.error.message };
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'calibration_record.create', entityType: 'calibration_records', entityId: (result.data as { id?: string }).id ?? null, newValues: result.data as Record<string, unknown> });
    // ANALYTICS-01: surface refresh failure as warning.
    const recordAnalyticsWarning = await runAnalyticsRefreshOrWarn({
      refresh: () => recomputeAssetAnalytics(parsed.asset_id),
      label: 'Calibration analytics',
      audit: {
        supabase, profileId: profile.id,
        action: 'calibration_record.analytics_refresh_failed',
        entityType: 'calibration_records', entityId: (result.data as { id?: string }).id ?? null,
        details: { asset_id: parsed.asset_id },
      },
    });

    // R6: failed or adjusted calibration is a clinical-safety event.
    // Notification rules in notification-rules.ts wire this event to
    // BME Head + technicians + department head with HIGH priority — but
    // before R6 the action never emitted the event, so the rule was dead
    // code. A passed result is intentionally NOT emitted (no spam).
    let notificationWarning: string | null = null;
    let notificationResult: Record<string, unknown> | null = null;
    if (parsed.result === 'fail' || parsed.result === 'adjusted') {
      try {
        const { data: asset } = await supabase
          .from('equipment_assets')
          .select('name, asset_code, department_id')
          .eq('id', parsed.asset_id)
          .maybeSingle();
        const row = (asset ?? null) as { name?: string | null; asset_code?: string | null; department_id?: string | null } | null;
        const inserted = result.data as { id?: string };
        const notification = await createNotificationEvent({
          event_type: 'calibration.failed_or_adjusted',
          source_table: 'calibration_records',
          source_id: inserted.id ?? null,
          asset_id: parsed.asset_id,
          department_id: row?.department_id ?? null,
          // Failed = high (compliance breach); adjusted = medium (corrective
          // action taken but evidence of drift).
          priority: parsed.result === 'fail' ? 'high' : 'medium',
          payload: {
            asset_name: row?.name ?? null,
            asset_code: row?.asset_code ?? null,
            result: parsed.result,
            calibration_date: parsed.calibration_date,
            next_due_date: parsed.next_due_date ?? null,
            // NOTIF-02 fix: emit record_id so the notification deep link
            // opens the exact calibration record (/calibration/records/[id])
            // instead of the generic /calibration page. calibration_records
            // has no formal FK to calibration_requests; the link builder
            // honours record_id first, then asset_id as fallback.
            record_id: inserted.id ?? null,
          },
        });
        if (notificationDeliveryNeedsReview(notification)) {
          notificationWarning = NOTIFICATION_DELIVERY_REVIEW_WARNING;
          notificationResult = {
            ...notificationProcessSnapshot(notification),
            detail: notificationReviewDetail(notification),
          };
        }
      } catch (e) {
        console.error('[notifications] calibration.failed_or_adjusted emit failed:', e);
        const failed = makeFailedNotificationResult('calibration.failed_or_adjusted', e);
        if (notificationDeliveryNeedsReview(failed)) {
          notificationWarning = NOTIFICATION_DELIVERY_REVIEW_WARNING;
          notificationResult = { ...notificationProcessSnapshot(failed), detail: notificationReviewDetail(failed) };
        }
      }
    }

    revalidateMany(calibrationPaths);
    const responseDataRecord = {
      ...(result.data as Record<string, unknown>),
      ...(recordAnalyticsWarning ? { analytics_refresh_warning: recordAnalyticsWarning } : {}),
      ...(notificationWarning
        ? { notification_warning: notificationWarning, notification_result: notificationResult }
        : {}),
    };
    return { success: true, data: responseDataRecord };
  } catch (err) {
    return actionError(err, 'Failed to create calibration record');
  }
}
