'use server';

import { z } from 'zod';
import { recomputeAssetAnalytics } from './analytics.actions';
import { getActionContextForCapability, getActionContextForAnyCapability, logServerAuditEvent, revalidateMany, actionError, nullIfEmpty, type ActionResult } from './_shared';
import { denialMessage } from '@/lib/rbac/department-scope';

const calibrationPaths = ['/calibration', '/calendar', '/command', '/reports/calibration'];

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
    const result = await supabase
      .from('calibration_requests')
      .update({ status: parsedStatus } as never)
      .eq('id', id)
      .select('*')
      .single();
    if (result.error) return { success: false, error: result.error.message };
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
    if (assetId && parsedStatus === 'completed') await recomputeAssetAnalytics(assetId).catch(() => undefined);

    // R6: emit calibration.request_status_changed so BME Head + requester +
    // assigned technician + department head all see the workflow move.
    // Notification rules in notification-rules.ts already handle this event
    // type — before R6 the rule was defined but never emitted.
    try {
      const { data: asset } = await supabase
        .from('equipment_assets')
        .select('name, asset_code, department_id')
        .eq('id', assetId ?? '')
        .maybeSingle();
      const row = (asset ?? null) as { name?: string | null; asset_code?: string | null; department_id?: string | null } | null;
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
        },
      });
    } catch (e) {
      console.error('[notifications] calibration.request_status_changed emit failed:', e);
    }

    revalidateMany([...calibrationPaths, `/calibration/requests/${id}`, ...(assetId ? [`/equipment/${assetId}`] : [])]);
    return { success: true, data: result.data };
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
    if (result.error) return { success: false, error: result.error.message };
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'calibration_request.create', entityType: 'calibration_requests', entityId: (result.data as { id?: string }).id ?? null, newValues: result.data as Record<string, unknown> });
    await recomputeAssetAnalytics(parsed.asset_id).catch(() => undefined);

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
    return { success: true, data: result.data };
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
    await recomputeAssetAnalytics(parsed.asset_id).catch(() => undefined);

    // R6: failed or adjusted calibration is a clinical-safety event.
    // Notification rules in notification-rules.ts wire this event to
    // BME Head + technicians + department head with HIGH priority — but
    // before R6 the action never emitted the event, so the rule was dead
    // code. A passed result is intentionally NOT emitted (no spam).
    if (parsed.result === 'fail' || parsed.result === 'adjusted') {
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
          },
        });
      } catch (e) {
        console.error('[notifications] calibration.failed_or_adjusted emit failed:', e);
      }
    }

    revalidateMany(calibrationPaths);
    return { success: true, data: result.data };
  } catch (err) {
    return actionError(err, 'Failed to create calibration record');
  }
}
