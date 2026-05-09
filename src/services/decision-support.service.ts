import { createClient } from '@/lib/supabase/client';

export interface TriageItem {
  asset_id: string;
  asset_code: string;
  asset_name: string;
  department_name: string;
  priority_score: number;
  rationale: string[];
  recommended_action: string;
}

export interface AssetHealthScore {
  asset_id: string;
  asset_code: string;
  asset_name: string;
  score: number;
  drivers: { label: string; value: string; impact: 'positive' | 'negative' | 'neutral' }[];
}

export interface DepartmentReadiness {
  department_id: string;
  department_name: string;
  essential_total: number;
  essential_functional: number;
  readiness_score: number;
}

export interface WorkloadSnapshot {
  assignee: string;
  open_assignments: number;
  overdue_assignments: number;
  estimated_hours: number;
}

export interface DecisionSupportSnapshot {
  triage: TriageItem[];
  healthScores: AssetHealthScore[];
  readiness: DepartmentReadiness[];
  workload: WorkloadSnapshot[];
}

export async function refreshDecisionSupportSnapshots() {
  const supabase = createClient();
  await (supabase.rpc as never as (fn: string) => Promise<{ error: { message: string } | null }>)('fn_refresh_fmea_risk_scores');
  return supabase.rpc('refresh_decision_support_snapshots');
}

async function computeFromOperationalData(): Promise<DecisionSupportSnapshot> {
  const supabase = createClient();
  const [assetsRes, flagsRes, replacementRes, reliabilityRes, riskRes, pmRes, workloadRes] = await Promise.all([
    supabase
      .from('equipment_assets')
      .select('id, asset_code, name, condition, status, department_id, departments(name), equipment_categories(criticality_level)')
      .is('deleted_at', null),
    supabase
      .from('recommendation_flags')
      .select('asset_id, flag_type, severity, details, is_acknowledged')
      .eq('is_acknowledged', false),
    supabase
      .from('replacement_priority_scores')
      .select('asset_id, replacement_priority_index, rank')
      .order('rank', { ascending: true })
      .limit(200),
    supabase
      .from('equipment_reliability_metrics')
      .select('asset_id, availability_ratio, mttr_hours, failure_count, computed_at')
      .order('computed_at', { ascending: false })
      .limit(500),
    supabase
      .from('equipment_risk_scores')
      .select('asset_id, rpn, risk_level, assessed_at')
      .order('assessed_at', { ascending: false })
      .limit(500),
    supabase
      .from('pm_compliance_metrics')
      .select('asset_id, pmc_percentage, computed_at')
      .not('asset_id', 'is', null)
      .order('computed_at', { ascending: false })
      .limit(500),
    supabase
      .from('work_orders')
      .select('id, assigned_to, status, priority, estimated_hours, profiles(full_name)')
      .in('status', ['open', 'assigned', 'in_progress', 'on_hold']),
  ]);

  const assets = (assetsRes.data ?? []) as Array<Record<string, unknown>>;
  const flags = (flagsRes.data ?? []) as Array<Record<string, unknown>>;
  const replacement = (replacementRes.data ?? []) as Array<Record<string, unknown>>;
  const reliability = (reliabilityRes.data ?? []) as Array<Record<string, unknown>>;
  const risk = (riskRes.data ?? []) as Array<Record<string, unknown>>;
  const pm = (pmRes.data ?? []) as Array<Record<string, unknown>>;
  const workloadRows = (workloadRes.data ?? []) as Array<Record<string, unknown>>;

  const reliabilityByAsset = new Map<string, Record<string, unknown>>();
  for (const row of reliability) {
    const assetId = row.asset_id as string;
    if (!reliabilityByAsset.has(assetId)) reliabilityByAsset.set(assetId, row);
  }

  const riskByAsset = new Map<string, Record<string, unknown>>();
  for (const row of risk) {
    const assetId = row.asset_id as string;
    if (!riskByAsset.has(assetId)) riskByAsset.set(assetId, row);
  }

  const pmByAsset = new Map<string, Record<string, unknown>>();
  for (const row of pm) {
    const assetId = row.asset_id as string;
    if (!pmByAsset.has(assetId)) pmByAsset.set(assetId, row);
  }

  const replacementByAsset = new Map<string, Record<string, unknown>>();
  for (const row of replacement) {
    replacementByAsset.set(row.asset_id as string, row);
  }

  const flagsByAsset = new Map<string, Array<Record<string, unknown>>>();
  for (const row of flags) {
    const assetId = row.asset_id as string;
    const list = flagsByAsset.get(assetId) ?? [];
    list.push(row);
    flagsByAsset.set(assetId, list);
  }

  const healthScores: AssetHealthScore[] = assets.map((asset) => {
    const assetId = asset.id as string;
    const r = reliabilityByAsset.get(assetId);
    const rk = riskByAsset.get(assetId);
    const p = pmByAsset.get(assetId);
    const criticalFlags = (flagsByAsset.get(assetId) ?? []).filter((f) => ['high', 'critical'].includes((f.severity as string) ?? ''));

    const availability = typeof r?.availability_ratio === 'number' ? (r.availability_ratio as number) : 0.92;
    const pmc = typeof p?.pmc_percentage === 'number' ? (p.pmc_percentage as number) / 100 : 0.8;
    const rpn = typeof rk?.rpn === 'number' ? (rk.rpn as number) : 120;
    const flagPenalty = Math.min(0.25, criticalFlags.length * 0.05);
    const riskPenalty = Math.min(0.35, rpn / 1000);
    const condition = (asset.condition as string) ?? 'functional';
    const conditionPenalty = condition === 'functional' ? 0 : condition === 'needs_repair' ? 0.15 : 0.3;
    const score = Math.max(1, Math.round((availability * 0.35 + pmc * 0.25 + (1 - riskPenalty) * 0.25 + (1 - conditionPenalty - flagPenalty) * 0.15) * 100));

    return {
      asset_id: assetId,
      asset_code: asset.asset_code as string,
      asset_name: asset.name as string,
      score,
      drivers: [
        { label: 'Availability', value: `${Math.round(availability * 100)}%`, impact: availability >= 0.95 ? 'positive' : 'negative' },
        { label: 'PM Compliance', value: `${Math.round(pmc * 100)}%`, impact: pmc >= 0.8 ? 'positive' : 'negative' },
        { label: 'Risk (RPN)', value: `${rpn}`, impact: rpn > 300 ? 'negative' : 'neutral' },
        { label: 'Open Critical Flags', value: `${criticalFlags.length}`, impact: criticalFlags.length > 0 ? 'negative' : 'neutral' },
      ],
    };
  });

  const triage: TriageItem[] = assets.map((asset) => {
    const assetId = asset.id as string;
    const assetFlags = flagsByAsset.get(assetId) ?? [];
    const rep = replacementByAsset.get(assetId);
    const rk = riskByAsset.get(assetId);
    const p = pmByAsset.get(assetId);

    const severityScore = assetFlags.reduce((acc, flag) => {
      const sev = flag.severity as string;
      if (sev === 'critical') return acc + 45;
      if (sev === 'high') return acc + 25;
      if (sev === 'medium') return acc + 10;
      return acc + 4;
    }, 0);
    const rpnScore = typeof rk?.rpn === 'number' ? Math.min(40, (rk.rpn as number) / 15) : 0;
    const pmPenalty = typeof p?.pmc_percentage === 'number' ? Math.max(0, (80 - (p.pmc_percentage as number)) / 2) : 0;
    const replacementScore = typeof rep?.rank === 'number' ? Math.max(0, 20 - (rep.rank as number)) : 0;
    const priorityScore = Math.round(severityScore + rpnScore + pmPenalty + replacementScore);
    const rationale: string[] = [];
    if (assetFlags.length > 0) rationale.push(`${assetFlags.length} active recommendation flags`);
    if (typeof rk?.rpn === 'number') rationale.push(`RPN ${(rk.rpn as number).toFixed(0)}`);
    if (typeof p?.pmc_percentage === 'number') rationale.push(`PM compliance ${(p.pmc_percentage as number).toFixed(1)}%`);
    if (typeof rep?.rank === 'number') rationale.push(`Replacement rank #${rep.rank as number}`);

    return {
      asset_id: assetId,
      asset_code: asset.asset_code as string,
      asset_name: asset.name as string,
      department_name: ((asset.departments as { name?: string } | null)?.name ?? 'Unknown'),
      priority_score: priorityScore,
      rationale,
      recommended_action: priorityScore > 75 ? 'Immediate intervention and escalation' : priorityScore > 45 ? 'Schedule within 24-48h' : 'Monitor and plan',
    };
  }).sort((a, b) => b.priority_score - a.priority_score).slice(0, 20);

  const readinessByDept = new Map<string, DepartmentReadiness>();
  for (const asset of assets) {
    const deptId = (asset.department_id as string) ?? 'unknown';
    const deptName = ((asset.departments as { name?: string } | null)?.name ?? 'Unassigned');
    const criticality = ((asset.equipment_categories as { criticality_level?: string } | null)?.criticality_level ?? 'medium');
    const isEssential = ['high', 'critical'].includes(criticality);
    if (!isEssential) continue;

    const existing = readinessByDept.get(deptId) ?? {
      department_id: deptId,
      department_name: deptName,
      essential_total: 0,
      essential_functional: 0,
      readiness_score: 0,
    };

    existing.essential_total += 1;
    const isFunctional = asset.condition === 'functional' && asset.status === 'active';
    if (isFunctional) existing.essential_functional += 1;
    readinessByDept.set(deptId, existing);
  }

  const readiness = Array.from(readinessByDept.values()).map((row) => ({
    ...row,
    readiness_score: row.essential_total > 0 ? Math.round((row.essential_functional / row.essential_total) * 100) : 0,
  })).sort((a, b) => b.readiness_score - a.readiness_score);

  const workloadMap = new Map<string, WorkloadSnapshot>();
  for (const row of workloadRows) {
    const assignee = ((row.profiles as { full_name?: string } | null)?.full_name ?? 'Unassigned');
    const current = workloadMap.get(assignee) ?? { assignee, open_assignments: 0, overdue_assignments: 0, estimated_hours: 0 };
    current.open_assignments += 1;
    if ((row.priority as string) === 'high' || (row.priority as string) === 'critical') current.overdue_assignments += 1;
    current.estimated_hours += Number(row.estimated_hours ?? 0);
    workloadMap.set(assignee, current);
  }

  const workload = Array.from(workloadMap.values()).sort((a, b) => b.open_assignments - a.open_assignments);

  return { triage, healthScores, readiness, workload };
}

export async function getDecisionSupportSnapshot(): Promise<DecisionSupportSnapshot> {
  const supabase = createClient();
  const snapshotDate = new Date().toISOString().slice(0, 10);

  const [triageRes, healthRes, readinessRes, workloadRes] = await Promise.all([
    supabase
      .from('triage_action_queue')
      .select('id, asset_id, priority_score, recommendation, rationale, equipment_assets(asset_code, name, departments(name))')
      .eq('status', 'open')
      .order('priority_score', { ascending: false })
      .limit(20),
    supabase
      .from('equipment_health_snapshots')
      .select('asset_id, health_score, explanation, equipment_assets(asset_code, name)')
      .eq('snapshot_date', snapshotDate)
      .order('health_score', { ascending: false })
      .limit(100),
    supabase
      .from('clinical_readiness_snapshots')
      .select('department_id, readiness_score, essential_total, essential_functional, departments(name)')
      .eq('snapshot_date', snapshotDate)
      .order('readiness_score', { ascending: false }),
    supabase
      .from('workload_capacity_snapshots')
      .select('assignee_id, open_assignments, overdue_assignments, estimated_hours, profiles(full_name)')
      .eq('snapshot_date', snapshotDate)
      .order('open_assignments', { ascending: false }),
  ]);

  const hasSnapshotData =
    (triageRes.data?.length ?? 0) > 0
    || (healthRes.data?.length ?? 0) > 0
    || (readinessRes.data?.length ?? 0) > 0
    || (workloadRes.data?.length ?? 0) > 0;

  if (!hasSnapshotData) {
    return computeFromOperationalData();
  }

  const triage: TriageItem[] = (triageRes.data ?? []).map((row) => ({
    asset_id: row.asset_id as string,
    asset_code: ((row.equipment_assets as { asset_code?: string } | null)?.asset_code ?? 'N/A'),
    asset_name: ((row.equipment_assets as { name?: string } | null)?.name ?? 'Unknown asset'),
    department_name: ((row.equipment_assets as { departments?: { name?: string } } | null)?.departments?.name ?? 'Unknown'),
    priority_score: Number(row.priority_score ?? 0),
    rationale: Array.isArray(row.rationale) ? (row.rationale as string[]) : [],
    recommended_action: (row.recommendation as string) ?? 'Review',
  }));

  const healthScores: AssetHealthScore[] = (healthRes.data ?? []).map((row) => {
    const explanation = (row.explanation as Record<string, unknown> | null) ?? {};
    return {
      asset_id: row.asset_id as string,
      asset_code: ((row.equipment_assets as { asset_code?: string } | null)?.asset_code ?? 'N/A'),
      asset_name: ((row.equipment_assets as { name?: string } | null)?.name ?? 'Unknown asset'),
      score: Math.round(Number(row.health_score ?? 0)),
      drivers: [
        { label: 'Availability', value: `${Math.round(Number(explanation.availability ?? 0))}%`, impact: Number(explanation.availability ?? 0) >= 95 ? 'positive' : 'negative' },
        { label: 'PM Compliance', value: `${Math.round(Number(explanation.pmc_percentage ?? 0))}%`, impact: Number(explanation.pmc_percentage ?? 0) >= 80 ? 'positive' : 'negative' },
        { label: 'Risk (RPN)', value: `${Math.round(Number(explanation.rpn ?? 0))}`, impact: Number(explanation.rpn ?? 0) > 300 ? 'negative' : 'neutral' },
        { label: 'Open Flags', value: `${Math.round(Number(explanation.open_flags ?? 0))}`, impact: Number(explanation.open_flags ?? 0) > 0 ? 'negative' : 'neutral' },
      ],
    };
  });

  const readiness: DepartmentReadiness[] = (readinessRes.data ?? []).map((row) => ({
    department_id: row.department_id as string,
    department_name: ((row.departments as { name?: string } | null)?.name ?? 'Unknown department'),
    essential_total: Number(row.essential_total ?? 0),
    essential_functional: Number(row.essential_functional ?? 0),
    readiness_score: Math.round(Number(row.readiness_score ?? 0)),
  }));

  const workload: WorkloadSnapshot[] = (workloadRes.data ?? []).map((row) => ({
    assignee: ((row.profiles as { full_name?: string } | null)?.full_name ?? 'Unassigned'),
    open_assignments: Number(row.open_assignments ?? 0),
    overdue_assignments: Number(row.overdue_assignments ?? 0),
    estimated_hours: Number(row.estimated_hours ?? 0),
  }));
  const fromSnapshots: DecisionSupportSnapshot = { triage, healthScores, readiness, workload };
  const missingSections =
    fromSnapshots.triage.length === 0
    || fromSnapshots.healthScores.length === 0
    || fromSnapshots.readiness.length === 0
    || fromSnapshots.workload.length === 0;

  if (!missingSections) {
    return fromSnapshots;
  }

  const fallback = await computeFromOperationalData();
  return {
    triage: fromSnapshots.triage.length > 0 ? fromSnapshots.triage : fallback.triage,
    healthScores: fromSnapshots.healthScores.length > 0 ? fromSnapshots.healthScores : fallback.healthScores,
    readiness: fromSnapshots.readiness.length > 0 ? fromSnapshots.readiness : fallback.readiness,
    workload: fromSnapshots.workload.length > 0 ? fromSnapshots.workload : fallback.workload,
  };
}
