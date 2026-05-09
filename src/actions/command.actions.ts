'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { recomputeAllAnalytics } from './analytics.actions';

export type ActionResult = { success: boolean; error?: string };
type DataResult<T> = ActionResult & { data?: T };
type CommandProfile = Record<string, unknown> & { id: string; roleNames: string[] };

type TriageAssetDetail = {
  queue_id: string;
  asset_id: string;
  asset_name: string;
  asset_code: string;
  department_id: string | null;
  department_name: string;
  age_years: number | null;
  last_maintenance_date: string | null;
  rpn: number | null;
  pmc_percentage: number | null;
  /** equipment_reliability_metrics.availability_ratio (0–1 scale) */
  availability_ratio: number | null;
  mtbf_hours: number | null;
  flag_type: string | null;
  priority_score: number;
  rationale: string[];
  recommendation: string;
};

type DepartmentReadinessDetail = {
  department_id: string;
  assets: Array<{
    asset_id: string;
    asset_name: string;
    asset_code: string;
    health_status: string;
    is_essential: boolean;
    criticality_level: string | null;
    health_score: number | null;
    rpn: number | null;
  }>;
  total_tracked_assets: number;
  essential_total: number;
  essential_functional: number;
  essential_unavailable: number;
  non_essential_total: number;
  non_essential_functional: number;
  non_essential_unavailable: number;
  missing_criticality_assets: number;
  pm_compliance_percentage: number | null;
  open_work_orders: number;
  overdue_pm: number;
  calibration_overdue: number;
  replacement_candidates: number;
};

type WorkInProgressKind = 'work_orders' | 'overdue_pm' | 'calibration_due';
type WorkInProgressDetail = {
  kind: WorkInProgressKind;
  work_orders?: Array<{
    id: string;
    work_order_number: string;
    asset_name: string;
    status: string;
    assigned_to_name: string | null;
    created_at: string;
  }>;
  overdue_pm?: Array<{
    id: string;
    asset_name: string;
    asset_code: string;
    scheduled_date: string;
    days_overdue: number;
  }>;
  calibration_due?: Array<{
    id: string;
    asset_name: string;
    asset_code: string;
    next_due_date: string;
    calibration_date: string | null;
  }>;
};

async function getCurrentProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, profile: null, authUserId: null };

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, department_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile) {
    return { supabase, profile: null, authUserId: user.id };
  }

  const { data: userRoles } = await supabase
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', profile.id as string);

  const roleNames = ((userRoles ?? []) as Array<Record<string, unknown>>)
    .map((row) => ((row.roles as { name?: string } | null)?.name ?? null))
    .filter(Boolean);

  return {
    supabase,
    profile: {
      ...(profile as Record<string, unknown>),
      roleNames,
    } as CommandProfile,
    authUserId: user.id,
  };
}

function canMutateCommandCenter(profile: CommandProfile | null): boolean {
  if (!profile) return false;
  const roles = profile.roleNames.filter(Boolean);
  return roles.some((role) => role !== 'viewer');
}

function canViewCommandCenter(profile: CommandProfile | null): boolean {
  return Boolean(profile);
}

function authErrorMessage(profile: CommandProfile | null, authUserId: string | null): string {
  if (!authUserId) return 'Not authenticated';
  if (!profile) return 'Authenticated user is missing profile linkage';
  return 'Not authenticated';
}

export async function acknowledgeTriageItem(queueId: string): Promise<ActionResult> {
  if (!queueId) return { success: false, error: 'queueId is required' };

  try {
    const { supabase, profile, authUserId } = await getCurrentProfile();
    if (!profile) return { success: false, error: authErrorMessage(profile, authUserId) };
    if (!canMutateCommandCenter(profile)) {
      return { success: false, error: 'Insufficient permissions' };
    }

    const { data: triageContext, error: contextError } = await supabase
      .from('v_command_center_triage')
      .select('triage_id, asset_id, priority_score, top_flag_type')
      .eq('triage_id', queueId)
      .single();

    if (contextError || !triageContext) {
      return { success: false, error: contextError?.message ?? 'Triage context not found' };
    }

    const { error } = await supabase
      .from('triage_action_queue')
      .update({ status: 'dismissed' })
      .eq('id', queueId);

    if (error) return { success: false, error: error.message };

    const profileId = profile.id as string;
    await supabase
      .from('audit_logs')
      .insert({
        action: 'triage_acknowledged',
        entity_type: 'equipment',
        entity_id: triageContext.asset_id as string,
        user_id: profileId,
        performed_by: profileId,
        details: {
          flag_type: (triageContext.top_flag_type as string | null) ?? null,
          priority_score: Number(triageContext.priority_score ?? 0),
          queue_id: queueId,
        },
        new_values: {
          triage_status: 'dismissed',
        },
      } as never);

    revalidatePath('/command');
    revalidatePath('/command/triage');
    revalidatePath('/command/health');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function acknowledgeAssetFlags(assetId: string): Promise<ActionResult> {
  if (!assetId) return { success: false, error: 'assetId is required' };

  try {
    const { supabase, profile, authUserId } = await getCurrentProfile();
    if (!profile) return { success: false, error: authErrorMessage(profile, authUserId) };
    if (!canMutateCommandCenter(profile)) {
      return { success: false, error: 'Insufficient permissions' };
    }

    const { error } = await supabase
      .from('recommendation_flags')
      .update({
        is_acknowledged: true,
        acknowledged_by: profile.id as string,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('asset_id', assetId)
      .eq('is_acknowledged', false);

    if (error) return { success: false, error: error.message };

    revalidatePath('/command');
    revalidatePath('/command/triage');
    revalidatePath('/command/health');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function acknowledgeCommandCenterItem(payload: {
  item_type: string;
  item_key: string;
  asset_id?: string | null;
  signal_hash: string;
  reason?: string | null;
}): Promise<ActionResult> {
  if (!payload.item_type || !payload.item_key || !payload.signal_hash) {
    return { success: false, error: 'item_type, item_key, and signal_hash are required' };
  }

  try {
    const { supabase, profile, authUserId } = await getCurrentProfile();
    if (!profile) return { success: false, error: authErrorMessage(profile, authUserId) };
    if (!canMutateCommandCenter(profile)) {
      return { success: false, error: 'Insufficient permissions' };
    }

    const { error } = await supabase
      .from('command_center_acknowledgements')
      .upsert({
        profile_id: profile.id,
        item_type: payload.item_type,
        item_key: payload.item_key,
        asset_id: payload.asset_id ?? null,
        signal_hash: payload.signal_hash,
        acknowledged_at: new Date().toISOString(),
        snoozed_until: null,
        reason: payload.reason ?? null,
      } as never, { onConflict: 'profile_id,item_type,item_key,signal_hash' });

    if (error) return { success: false, error: error.message };

    revalidatePath('/command');
    revalidatePath('/command/drilldown/risk-watch');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function snoozeCommandCenterItem(payload: {
  item_type: string;
  item_key: string;
  asset_id?: string | null;
  signal_hash: string;
  days?: number;
  reason?: string | null;
}): Promise<ActionResult> {
  const days = payload.days ?? 7;
  const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  if (!payload.item_type || !payload.item_key || !payload.signal_hash) {
    return { success: false, error: 'item_type, item_key, and signal_hash are required' };
  }

  try {
    const { supabase, profile, authUserId } = await getCurrentProfile();
    if (!profile) return { success: false, error: authErrorMessage(profile, authUserId) };
    if (!canMutateCommandCenter(profile)) {
      return { success: false, error: 'Insufficient permissions' };
    }

    const { error } = await supabase
      .from('command_center_acknowledgements')
      .upsert({
        profile_id: profile.id,
        item_type: payload.item_type,
        item_key: payload.item_key,
        asset_id: payload.asset_id ?? null,
        signal_hash: payload.signal_hash,
        acknowledged_at: new Date().toISOString(),
        snoozed_until: snoozedUntil,
        reason: payload.reason ?? null,
      } as never, { onConflict: 'profile_id,item_type,item_key,signal_hash' });

    if (error) return { success: false, error: error.message };

    revalidatePath('/command');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function refreshCommandCenter(): Promise<ActionResult> {
  try {
    const { profile, authUserId } = await getCurrentProfile();
    if (!profile) return { success: false, error: authErrorMessage(profile, authUserId) };
    if (!canMutateCommandCenter(profile)) {
      return { success: false, error: 'Insufficient permissions' };
    }

    const result = await recomputeAllAnalytics();
    revalidatePath('/command');
    revalidatePath('/command/triage');
    revalidatePath('/command/health');
    return result;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

function parseRationale(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  return [];
}

function pickLatestIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function computeAgeYears(installationDate: string | null, purchaseDate: string | null): number | null {
  const base = installationDate ?? purchaseDate;
  if (!base) return null;
  const then = new Date(base);
  if (Number.isNaN(then.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - then.getFullYear();
  const m = now.getMonth() - then.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < then.getDate())) years--;
  return Math.max(0, years);
}

export async function getTriageAssetDetail(assetId: string, queueId: string): Promise<DataResult<TriageAssetDetail>> {
  if (!assetId || !queueId) return { success: false, error: 'assetId and queueId are required' };
  try {
    const { supabase, profile, authUserId } = await getCurrentProfile();
    if (!profile) return { success: false, error: authErrorMessage(profile, authUserId) };
    if (!canMutateCommandCenter(profile)) {
      return { success: false, error: 'Insufficient permissions' };
    }

    const [assetRes, triageRes, reliabilityRes, riskRes, pmRes, eventRes, woRes] = await Promise.all([
      supabase
        .from('equipment_assets')
        .select('id, asset_code, name, department_id, installation_date, purchase_date, departments(name)')
        .eq('id', assetId)
        .single(),
      supabase
        .from('v_command_center_triage')
        .select('triage_id, asset_id, department_id, department_name, priority_score, recommendation, rationale, top_flag_type')
        .eq('triage_id', queueId)
        .single(),
      supabase
        .from('equipment_reliability_metrics')
        .select('availability_ratio, mtbf_hours, computed_at')
        .eq('asset_id', assetId)
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('equipment_risk_scores')
        .select('rpn, assessed_at')
        .eq('asset_id', assetId)
        .order('assessed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('pm_compliance_metrics')
        .select('pmc_percentage, computed_at')
        .eq('asset_id', assetId)
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('maintenance_events')
        .select('completion_date')
        .eq('asset_id', assetId)
        .not('completion_date', 'is', null)
        .order('completion_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('work_orders')
        .select('completed_at')
        .eq('asset_id', assetId)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (assetRes.error || !assetRes.data) {
      return { success: false, error: assetRes.error?.message ?? 'Asset not found' };
    }
    if (triageRes.error || !triageRes.data) {
      return { success: false, error: triageRes.error?.message ?? 'Triage item not found' };
    }

    const asset = assetRes.data as Record<string, unknown>;
    const triage = triageRes.data as Record<string, unknown>;
    const dept = asset.departments as { name?: string } | null;
    const maintenanceDate = pickLatestIso(
      (eventRes.data?.completion_date as string | undefined) ?? null,
      (woRes.data?.completed_at as string | undefined) ?? null
    );

    return {
      success: true,
      data: {
        queue_id: queueId,
        asset_id: assetId,
        asset_name: (asset.name as string | undefined) ?? 'Unknown asset',
        asset_code: (asset.asset_code as string | undefined) ?? 'N/A',
        department_id: (triage.department_id as string | null) ?? ((asset.department_id as string | null) ?? null),
        department_name: (triage.department_name as string | undefined) ?? dept?.name ?? 'Unknown',
        age_years: computeAgeYears(
          (asset.installation_date as string | null) ?? null,
          (asset.purchase_date as string | null) ?? null
        ),
        last_maintenance_date: maintenanceDate,
        rpn: typeof riskRes.data?.rpn === 'number' ? Number(riskRes.data.rpn) : null,
        pmc_percentage: typeof pmRes.data?.pmc_percentage === 'number' ? Number(pmRes.data.pmc_percentage) : null,
        availability_ratio: typeof reliabilityRes.data?.availability_ratio === 'number'
          ? Number(reliabilityRes.data.availability_ratio)
          : null,
        mtbf_hours: typeof reliabilityRes.data?.mtbf_hours === 'number' ? Number(reliabilityRes.data.mtbf_hours) : null,
        flag_type: (triage.top_flag_type as string | null) ?? null,
        priority_score: Number(triage.priority_score ?? 0),
        rationale: parseRationale(triage.rationale),
        recommendation: (triage.recommendation as string | undefined) ?? 'Review asset triage signals',
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

function buildRequestNumber(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

export async function createDiagnosticMaintenanceRequest(payload: {
  asset_id: string;
  department_id: string;
  issue_description: string;
  urgency?: 'low' | 'medium' | 'high' | 'critical';
}): Promise<ActionResult> {
  if (!payload.asset_id || !payload.department_id || !payload.issue_description) {
    return { success: false, error: 'asset_id, department_id, and issue_description are required' };
  }
  try {
    const { supabase, profile, authUserId } = await getCurrentProfile();
    if (!profile) return { success: false, error: authErrorMessage(profile, authUserId) };
    if (!canMutateCommandCenter(profile)) {
      return { success: false, error: 'Insufficient permissions' };
    }

    const { error } = await supabase
      .from('maintenance_requests')
      .insert({
        request_number: buildRequestNumber('MR'),
        asset_id: payload.asset_id,
        requested_by: profile.id as string,
        department_id: payload.department_id,
        fault_description: payload.issue_description,
        urgency: payload.urgency ?? 'high',
        status: 'pending',
        request_type: 'diagnostic',
        notes: 'Created from Command Center triage inline action',
      } as never);

    if (error) return { success: false, error: error.message };

    revalidatePath('/command');
    revalidatePath('/command/triage');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function createReplacementDisposalRequest(payload: {
  asset_id: string;
  issue_description: string;
  disposal_method_proposed?: 'auction' | 'donation' | 'recycling' | 'destruction' | 'return_to_vendor' | 'other';
}): Promise<ActionResult> {
  if (!payload.asset_id || !payload.issue_description) {
    return { success: false, error: 'asset_id and issue_description are required' };
  }
  try {
    const { supabase, profile, authUserId } = await getCurrentProfile();
    if (!profile) return { success: false, error: authErrorMessage(profile, authUserId) };
    if (!canMutateCommandCenter(profile)) {
      return { success: false, error: 'Insufficient permissions' };
    }

    const { error } = await supabase
      .from('disposal_requests')
      .insert({
        request_number: buildRequestNumber('DSP'),
        asset_id: payload.asset_id,
        requested_by: profile.id as string,
        reason: payload.issue_description,
        disposal_method_proposed: payload.disposal_method_proposed ?? 'other',
        status: 'pending',
        notes: 'Created from Command Center triage inline action',
      });

    if (error) return { success: false, error: error.message };

    revalidatePath('/command');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function createCommandPMSchedule(payload: {
  asset_id: string;
  issue_description: string;
  scheduled_date: string;
}): Promise<ActionResult> {
  if (!payload.asset_id || !payload.issue_description || !payload.scheduled_date) {
    return { success: false, error: 'asset_id, issue_description, and scheduled_date are required' };
  }
  try {
    const { supabase, profile, authUserId } = await getCurrentProfile();
    if (!profile) return { success: false, error: authErrorMessage(profile, authUserId) };
    if (!canMutateCommandCenter(profile)) {
      return { success: false, error: 'Insufficient permissions' };
    }

    const { data: plan, error: planError } = await supabase
      .from('pm_plans')
      .select('id')
      .eq('asset_id', payload.asset_id)
      .eq('is_active', true)
      .order('next_due_date', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (planError) return { success: false, error: planError.message };
    if (!plan?.id) {
      return { success: false, error: 'No active PM plan found for this asset' };
    }

    const { error } = await supabase
      .from('pm_schedules')
      .insert({
        plan_id: plan.id as string,
        asset_id: payload.asset_id,
        scheduled_date: payload.scheduled_date,
        status: 'scheduled',
        assigned_to: profile.id as string,
        notes: payload.issue_description,
        source_context: {
          source: 'command_center_triage',
        },
      } as never);

    if (error) return { success: false, error: error.message };

    revalidatePath('/command');
    revalidatePath('/pm');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function getDepartmentReadinessDetail(departmentId: string): Promise<DataResult<DepartmentReadinessDetail>> {
  if (!departmentId) return { success: false, error: 'departmentId is required' };
  try {
    const { supabase, profile, authUserId } = await getCurrentProfile();
    if (!profile) return { success: false, error: authErrorMessage(profile, authUserId) };
    if (!canViewCommandCenter(profile)) {
      return { success: false, error: 'Insufficient permissions' };
    }

    const { data: assets, error: assetsError } = await supabase
      .from('equipment_assets')
      .select('id, name, asset_code, condition, status, category_id, equipment_categories(criticality_level)')
      .eq('department_id', departmentId)
      .is('deleted_at', null)
      .eq('status', 'active')
      .order('name', { ascending: true })
      .limit(500);

    if (assetsError) return { success: false, error: assetsError.message };

    const assetIds = (assets ?? []).map((row) => row.id as string).filter(Boolean);
    if (assetIds.length === 0) {
      return {
        success: true,
        data: {
          department_id: departmentId,
          assets: [],
          total_tracked_assets: 0,
          essential_total: 0,
          essential_functional: 0,
          essential_unavailable: 0,
          non_essential_total: 0,
          non_essential_functional: 0,
          non_essential_unavailable: 0,
          missing_criticality_assets: 0,
          pm_compliance_percentage: null,
          open_work_orders: 0,
          overdue_pm: 0,
          calibration_overdue: 0,
          replacement_candidates: 0,
        },
      };
    }

    const [riskRes, healthRes, pmRes, woRes, overduePmRes, calibrationRes, replacementRes] = await Promise.all([
      supabase
        .from('equipment_risk_scores')
        .select('asset_id, rpn, assessed_at')
        .in('asset_id', assetIds)
        .order('assessed_at', { ascending: false }),
      supabase
        .from('v_asset_health_summary')
        .select('asset_id, health_score')
        .in('asset_id', assetIds),
      supabase
        .from('pm_compliance_metrics')
        .select('asset_id, pmc_percentage, computed_at')
        .eq('department_id', departmentId)
        .order('computed_at', { ascending: false })
        .limit(500),
      supabase
        .from('work_orders')
        .select('id', { count: 'exact', head: true })
        .in('asset_id', assetIds)
        .in('status', ['open', 'assigned', 'in_progress', 'on_hold']),
      supabase
        .from('v_overdue_pm')
        .select('id', { count: 'exact', head: true })
        .in('asset_id', assetIds),
      supabase
        .from('v_calibration_due')
        .select('id', { count: 'exact', head: true })
        .in('asset_id', assetIds)
        .lt('next_due_date', new Date().toISOString().slice(0, 10)),
      supabase
        .from('v_replacement_decision')
        .select('asset_id', { count: 'exact', head: true })
        .in('asset_id', assetIds)
        .gte('replacement_priority_index', 0.5),
    ]);

    if (riskRes.error || healthRes.error || pmRes.error || woRes.error) {
      return {
        success: false,
        error: riskRes.error?.message
          ?? healthRes.error?.message
          ?? pmRes.error?.message
          ?? woRes.error?.message
          ?? 'Failed to load department details',
      };
    }

    const riskByAsset = new Map<string, number>();
    for (const row of riskRes.data ?? []) {
      const aid = row.asset_id as string;
      if (!riskByAsset.has(aid)) {
        riskByAsset.set(aid, Number(row.rpn ?? 0));
      }
    }

    const healthByAsset = new Map<string, number>();
    for (const row of healthRes.data ?? []) {
      healthByAsset.set(row.asset_id as string, Number(row.health_score ?? 0));
    }

    const latestPmcByAsset = new Map<string, number>();
    for (const row of pmRes.data ?? []) {
      const aid = row.asset_id as string | null;
      if (!aid) continue;
      if (!latestPmcByAsset.has(aid)) {
        latestPmcByAsset.set(aid, Number(row.pmc_percentage ?? 0));
      }
    }
    const pmValues = Array.from(latestPmcByAsset.values());
    const pmCompliance = pmValues.length > 0
      ? Number((pmValues.reduce((a, b) => a + b, 0) / pmValues.length).toFixed(1))
      : null;

    const detailAssets = (assets ?? []).map((row) => {
      const score = healthByAsset.get(row.id as string) ?? null;
      const condition = (row.condition as string | null) ?? 'functional';
      const status = (row.status as string | null) ?? 'active';
      const category = Array.isArray(row.equipment_categories)
        ? (row.equipment_categories as Array<{ criticality_level?: string }>)[0]
        : row.equipment_categories as { criticality_level?: string } | null;
      const criticalityLevel = category?.criticality_level ?? null;
      const isEssential = criticalityLevel === 'high' || criticalityLevel === 'critical';
      const healthStatus = status !== 'active'
        ? 'Inactive'
        : condition === 'functional'
          ? 'Functional'
          : condition === 'needs_repair'
            ? 'Needs repair'
            : 'Attention required';
      return {
        asset_id: row.id as string,
        asset_name: (row.name as string | undefined) ?? 'Unknown',
        asset_code: (row.asset_code as string | undefined) ?? 'N/A',
        health_status: healthStatus,
        is_essential: isEssential,
        criticality_level: criticalityLevel,
        health_score: score,
        rpn: riskByAsset.get(row.id as string) ?? null,
      };
    });
    const essentialAssets = detailAssets.filter((asset) => asset.is_essential);
    const nonEssentialAssets = detailAssets.filter((asset) => !asset.is_essential);

    return {
      success: true,
      data: {
        department_id: departmentId,
        assets: detailAssets,
        total_tracked_assets: detailAssets.length,
        essential_total: essentialAssets.length,
        essential_functional: essentialAssets.filter((asset) => asset.health_status === 'Functional').length,
        essential_unavailable: essentialAssets.filter((asset) => asset.health_status !== 'Functional').length,
        non_essential_total: nonEssentialAssets.length,
        non_essential_functional: nonEssentialAssets.filter((asset) => asset.health_status === 'Functional').length,
        non_essential_unavailable: nonEssentialAssets.filter((asset) => asset.health_status !== 'Functional').length,
        missing_criticality_assets: detailAssets.filter((asset) => asset.criticality_level == null).length,
        pm_compliance_percentage: pmCompliance,
        open_work_orders: woRes.count ?? 0,
        overdue_pm: overduePmRes.count ?? 0,
        calibration_overdue: calibrationRes.count ?? 0,
        replacement_candidates: replacementRes.count ?? 0,
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function getWorkInProgressDetail(kind: WorkInProgressKind): Promise<DataResult<WorkInProgressDetail>> {
  try {
    const { supabase, profile, authUserId } = await getCurrentProfile();
    if (!profile) return { success: false, error: authErrorMessage(profile, authUserId) };
    if (!canViewCommandCenter(profile)) {
      return { success: false, error: 'Insufficient permissions' };
    }

    if (kind === 'work_orders') {
      const { data, error } = await supabase
        .from('v_open_work_orders')
        .select('id, work_order_number, asset_name, status, assigned_to_name, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) return { success: false, error: error.message };
      return {
        success: true,
        data: {
          kind,
          work_orders: (data ?? []).map((row) => ({
            id: row.id as string,
            work_order_number: (row.work_order_number as string | undefined) ?? 'N/A',
            asset_name: (row.asset_name as string | undefined) ?? 'Unknown',
            status: (row.status as string | undefined) ?? 'open',
            assigned_to_name: (row.assigned_to_name as string | null) ?? null,
            created_at: (row.created_at as string | undefined) ?? new Date().toISOString(),
          })),
        },
      };
    }

    if (kind === 'overdue_pm') {
      const { data, error } = await supabase
        .from('v_overdue_pm')
        .select('id, asset_name, asset_code, scheduled_date, days_overdue')
        .order('scheduled_date', { ascending: true })
        .limit(200);
      if (error) return { success: false, error: error.message };
      return {
        success: true,
        data: {
          kind,
          overdue_pm: (data ?? []).map((row) => ({
            id: row.id as string,
            asset_name: (row.asset_name as string | undefined) ?? 'Unknown',
            asset_code: (row.asset_code as string | undefined) ?? 'N/A',
            scheduled_date: (row.scheduled_date as string | undefined) ?? '',
            days_overdue: Number(row.days_overdue ?? 0),
          })),
        },
      };
    }

    const today = new Date().toISOString().slice(0, 10);
    const in30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('v_calibration_due')
      .select('id, asset_name, asset_code, next_due_date, calibration_date')
      .gte('next_due_date', today)
      .lte('next_due_date', in30d)
      .order('next_due_date', { ascending: true })
      .limit(200);
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: {
        kind,
        calibration_due: (data ?? []).map((row) => ({
          id: row.id as string,
          asset_name: (row.asset_name as string | undefined) ?? 'Unknown',
          asset_code: (row.asset_code as string | undefined) ?? 'N/A',
          next_due_date: (row.next_due_date as string | undefined) ?? '',
          calibration_date: (row.calibration_date as string | null) ?? null,
        })),
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
