'use server';

import { revalidatePath } from 'next/cache';
import { getActionContext, logServerAuditEvent, actionError, type ActionResult } from './_shared';

export async function prepareReportSnapshotAction(reportType: string): Promise<ActionResult<{ generatedAt: string; refreshStatus: string }>> {
  try {
    const { supabase, profile, error } = await getActionContext([
      'developer',
      'admin',
      'bme_head',
      'technician',
      'department_head',
      'department_user',
      'store_user',
      'viewer',
    ]);
    if (error || !profile) return { success: false, error };

    const generatedAt = new Date().toISOString();
    const refresh = await supabase.rpc('refresh_decision_support_snapshots');
    const refreshStatus = refresh.error ? `warning: ${refresh.error.message}` : 'refreshed';

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'report.generate_snapshot',
      entityType: 'reports',
      entityId: reportType,
      details: { report_type: reportType, generated_at: generatedAt, refresh_status: refreshStatus },
    });

    revalidatePath('/reports');
    revalidatePath(`/reports/${reportType}`);
    return { success: true, data: { generatedAt, refreshStatus } };
  } catch (err) {
    return actionError(err, 'Failed to prepare report snapshot') as ActionResult<{ generatedAt: string; refreshStatus: string }>;
  }
}
