import Link from 'next/link';
import {
  AlertTriangle, ArrowUpDown, CalendarCheck, CheckCircle2,
  ClipboardList, Info, ShieldAlert, Wrench,
} from 'lucide-react';
import { getServerProfile } from '@/lib/auth/helpers';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import { RefreshButton } from './_components/RefreshButton';
import { AcknowledgeButton } from './_components/AcknowledgeButton';
import { RiskBandDrilldown, type RiskBand } from './_components/RiskBandDrilldown';
import { generateReplacementDriver, generateTriageReason } from '@/utils/decision-support/explanations';

// ─── types ────────────────────────────────────────────────────────────────────

interface TriageRow {
  id: string;
  flag_id: string | null;
  flag_type: string | null;
  flag_severity: string | null;
  asset_id: string;
  asset_name: string;
  asset_code: string;
  department_id: string | null;
  department_name: string;
  recommendation: string;
  rationale: string[];
  score: number;
}

interface DeptReadiness {
  department_id: string;
  department_name: string;
  essential_total: number;
  essential_functional: number;
  readiness_score: number;
}

interface WorkInProgress {
  open_work_orders: number;
  in_progress: number;
  assigned: number;
  on_hold: number;
  overdue_pm: number;
  overdue_pm_gt30: number;
  calibration_due_30d: number;
}

interface RiskScoreRow {
  asset_id: string;
  asset_name: string;
  asset_code: string;
  department_name: string;
  rpn: number;
  risk_level: string;
}

interface ReplacementRow {
  asset_id: string;
  asset_name: string;
  asset_code: string;
  department_name: string;
  age_score: number | null;
  failure_score: number | null;
  availability_score: number | null;
  maintenance_burden_score: number | null;
  spare_part_score: number | null;
  risk_score: number | null;
  cost_score: number | null;
  priority_index: number;
  rank: number;
  justification: string | null;
}

// ─── action button mapping ────────────────────────────────────────────────────

function actionForFlagType(flagType: string, assetId: string): { label: string; href: string } {
  switch (flagType) {
    case 'urgent_maintenance':
      return { label: 'Create work order', href: `/maintenance/work-orders/new?asset=${assetId}` };
    case 'recurring_failure':
      return { label: 'Schedule diagnostic', href: `/maintenance?asset=${assetId}` };
    case 'replacement_candidate':
      return { label: 'Add to replacement plan', href: `/replacement?asset=${assetId}` };
    case 'part_shortage':
      return { label: 'Open procurement', href: `/procurement?asset=${assetId}` };
    case 'overdue_pm':
      return { label: 'Schedule PM', href: `/pm?asset=${assetId}` };
    case 'calibrate_soon':
      return { label: 'Schedule calibration', href: `/calibration?asset=${assetId}` };
    case 'prioritize_pm':
      return { label: 'Reschedule PM', href: `/pm?asset=${assetId}` };
    case 'monitor_closely':
      return { label: 'View details', href: `/inventory/${assetId}` };
    case 'low_availability':
      return { label: 'View maintenance history', href: `/inventory/${assetId}?tab=history` };
    default:
      return { label: 'View asset', href: `/inventory/${assetId}` };
  }
}

function severityScore(severity: string): number {
  if (severity === 'critical') return 45;
  if (severity === 'high') return 25;
  if (severity === 'medium') return 10;
  return 4;
}

function normalizeRationale(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => `${key}: ${Array.isArray(val) ? val.join(', ') : String(val)}`)
      .filter(Boolean);
  }
  if (typeof value === 'string') return [value];
  return [];
}

// ─── readiness colour ─────────────────────────────────────────────────────────

function readinessColor(score: number): { ring: string; text: string } {
  if (score >= 90) return { ring: 'border-emerald-500 bg-emerald-500/10', text: 'text-emerald-300' };
  if (score >= 70) return { ring: 'border-amber-500 bg-amber-500/10', text: 'text-amber-300' };
  return { ring: 'border-rose-500 bg-rose-500/10', text: 'text-rose-300' };
}

// ─── RPN band helpers ─────────────────────────────────────────────────────────

function rpnBand(rpn: number): RiskBand['key'] {
  if (rpn <= 100) return 'low';
  if (rpn <= 200) return 'medium';
  if (rpn <= 500) return 'high';
  return 'critical';
}

const BAND_META: Record<RiskBand['key'], { label: string; range: string; colorClass: string; textClass: string }> = {
  low:      { label: 'Low',      range: '1–100',   colorClass: 'bg-emerald-500/20', textClass: 'text-emerald-300' },
  medium:   { label: 'Medium',   range: '101–200', colorClass: 'bg-amber-500/20',   textClass: 'text-amber-300' },
  high:     { label: 'High',     range: '201–500', colorClass: 'bg-orange-500/20',  textClass: 'text-orange-300' },
  critical: { label: 'Critical', range: '501+',    colorClass: 'bg-rose-500/20',    textClass: 'text-rose-300' },
};

// ─── data fetchers ────────────────────────────────────────────────────────────

async function fetchTriageData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string | null,
  primaryRole: string
): Promise<{ rows: TriageRow[]; totalItems: number }> {
  let totalQuery = supabase
    .from('triage_action_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');

  let rowsQuery = supabase
    .from('triage_action_queue')
    .select('id, asset_id, priority_score, recommendation, rationale, equipment_assets(id, asset_code, name, department_id, departments(id, name))')
    .eq('status', 'open')
    .order('priority_score', { ascending: false });

  if (primaryRole === 'technician' && profileId) {
    totalQuery = totalQuery.eq('assigned_to', profileId);
    rowsQuery = rowsQuery.eq('assigned_to', profileId);
  }

  const [countRes, rowsRes] = await Promise.all([
    totalQuery,
    rowsQuery.limit(10), // Command Center is an executive triage surface; show only the highest-priority 10 and keep the exact count in the footer.
  ]);

  if (countRes.error || rowsRes.error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[Command/Section1] triage queue query error:', countRes.error ?? rowsRes.error);
    }
    return { rows: [], totalItems: 0 };
  }

  const queueRows = (rowsRes.data ?? []) as Array<Record<string, unknown>>;
  const assetIds = queueRows.map((row) => row.asset_id as string).filter(Boolean);
  const flagByAsset = new Map<string, Record<string, unknown>>();

  if (assetIds.length > 0) {
    const { data: flagRows, error: flagError } = await supabase
      .from('recommendation_flags')
      .select('id, asset_id, flag_type, severity, generated_at')
      .eq('is_acknowledged', false)
      .in('asset_id', assetIds)
      .order('generated_at', { ascending: false });

    if (flagError) {
      if (process.env.NODE_ENV === 'development') console.warn('[Command/Section1] flag action-driver query error:', flagError);
    } else {
      for (const flag of (flagRows ?? []) as Array<Record<string, unknown>>) {
        const assetId = flag.asset_id as string;
        const existing = flagByAsset.get(assetId);
        const flagRank = severityScore(flag.severity as string);
        const existingRank = existing ? severityScore(existing.severity as string) : -1;
        if (!existing || flagRank > existingRank) {
          flagByAsset.set(assetId, flag);
        }
      }
    }
  }

  const rows = queueRows.map((row) => {
    const asset = row.equipment_assets as {
      id: string;
      asset_code: string;
      name: string;
      department_id: string | null;
      departments?: { id: string; name: string } | null;
    } | null;
    const flag = flagByAsset.get(row.asset_id as string);
    return {
      id: row.id as string,
      flag_id: (flag?.id as string | undefined) ?? null,
      flag_type: (flag?.flag_type as string | undefined) ?? null,
      flag_severity: (flag?.severity as string | undefined) ?? null,
      asset_id: row.asset_id as string,
      asset_name: asset?.name ?? 'Unknown asset',
      asset_code: asset?.asset_code ?? 'N/A',
      department_id: asset?.department_id ?? asset?.departments?.id ?? null,
      department_name: asset?.departments?.name ?? 'Unknown',
      recommendation: generateTriageReason({
        flagType: (flag?.flag_type as string | undefined) ?? null,
        rationale: normalizeRationale(row.rationale),
        fallbackRecommendation: (row.recommendation as string | undefined) ?? null,
      }),
      rationale: normalizeRationale(row.rationale),
      score: Number(row.priority_score ?? 0),
    };
  });

  return { rows, totalItems: countRes.count ?? 0 };
}

async function fetchReadinessData(supabase: Awaited<ReturnType<typeof createClient>>): Promise<DeptReadiness[]> {
  const { data, error } = await supabase
    .from('clinical_readiness_snapshots')
    .select('department_id, readiness_score, essential_total, essential_functional, snapshot_date, created_at, departments(id, name)')
    .order('snapshot_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500); // covers all departments and several refresh dates; reduced to latest per department below

  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[Command/Section2] readiness query error:', error);
    return [];
  }

  const map = new Map<string, DeptReadiness>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const dept = row.departments as { id: string; name: string } | null;
    if (!dept) continue;
    if (map.has(dept.id)) continue;
    map.set(dept.id, {
      department_id: dept.id,
      department_name: dept.name,
      essential_total: Number(row.essential_total ?? 0),
      essential_functional: Number(row.essential_functional ?? 0),
      readiness_score: Math.round(Number(row.readiness_score ?? 0)),
    });
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[Command/Section2] latest clinical readiness snapshot departments: ${map.size}`);
  }

  return Array.from(map.values()).sort((a, b) => a.department_name.localeCompare(b.department_name));
}

async function fetchWorkInProgress(supabase: Awaited<ReturnType<typeof createClient>>): Promise<WorkInProgress> {
  const today = new Date().toISOString().slice(0, 10);
  const in30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [woRes, pmRes, calRes] = await Promise.all([
    supabase
      .from('v_open_work_orders')
      .select('id, status')
      .limit(500), // performance guard; count all open WOs in the system
    supabase
      .from('v_overdue_pm')
      .select('id, scheduled_date')
      .limit(500), // performance guard; count all overdue PMs
    supabase
      .from('v_calibration_due')
      .select('id')
      .lte('next_due_date', in30d)
      .gte('next_due_date', today)
      .limit(500), // performance guard; count calibration due within 30 days
  ]);

  const woRows = (woRes.data ?? []) as Array<{ id: string; status: string }>;
  const pmRows = (pmRes.data ?? []) as Array<{ id: string; scheduled_date: string }>;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  if (process.env.NODE_ENV === 'development') {
    console.log(`[Command/Section3] open WOs: ${woRows.length}, overdue PM: ${pmRows.length}, cal due: ${(calRes.data ?? []).length}`);
  }

  return {
    open_work_orders: woRows.length,
    in_progress: woRows.filter((r) => r.status === 'in_progress').length,
    assigned: woRows.filter((r) => r.status === 'assigned').length,
    on_hold: woRows.filter((r) => r.status === 'on_hold').length,
    overdue_pm: pmRows.length,
    overdue_pm_gt30: pmRows.filter((r) => r.scheduled_date <= thirtyDaysAgo).length,
    calibration_due_30d: (calRes.data ?? []).length,
  };
}

async function fetchRiskData(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ rows: RiskScoreRow[]; totalAssets: number }> {
  const [riskRes, assetCountRes] = await Promise.all([
    supabase
      .from('equipment_risk_scores')
      .select('asset_id, rpn, risk_level, equipment_assets(asset_code, name, departments(name))')
      .order('rpn', { ascending: false })
      .limit(500), // performance guard; covers all scored equipment
    supabase
      .from('equipment_assets')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null),
  ]);

  const rows = ((riskRes.data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const asset = row.equipment_assets as { asset_code: string; name: string; departments?: { name: string } | null } | null;
    return {
      asset_id: row.asset_id as string,
      asset_name: asset?.name ?? 'Unknown',
      asset_code: asset?.asset_code ?? 'N/A',
      department_name: asset?.departments?.name ?? 'Unknown',
      rpn: Number(row.rpn ?? 0),
      risk_level: (row.risk_level as string) ?? 'low',
    };
  });

  if (process.env.NODE_ENV === 'development') {
    console.log(`[Command/Section4] risk score rows: ${rows.length}, total assets: ${assetCountRes.count ?? 0}`);
  }

  return { rows, totalAssets: assetCountRes.count ?? 0 };
}

async function fetchReplacementData(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ rows: ReplacementRow[]; total: number }> {
  // Fetch full table ordered by priority, slice to top 5 for display.
  const { data, error } = await supabase
    .from('replacement_priority_scores')
    .select('asset_id, age_score, failure_score, availability_score, maintenance_burden_score, spare_part_score, risk_score, cost_score, replacement_priority_index, rank, justification, equipment_assets(asset_code, name, departments(name))')
    .order('replacement_priority_index', { ascending: false })
    .limit(500); // performance guard; returns all candidates for total count

  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[Command/Section5] replacement query error:', error);
    return { rows: [], total: 0 };
  }

  const all = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const asset = row.equipment_assets as { asset_code: string; name: string; departments?: { name: string } | null } | null;
    return {
      asset_id: row.asset_id as string,
      asset_name: asset?.name ?? 'Unknown',
      asset_code: asset?.asset_code ?? 'N/A',
      department_name: asset?.departments?.name ?? 'Unknown',
      age_score: row.age_score as number | null,
      failure_score: row.failure_score as number | null,
      availability_score: row.availability_score as number | null,
      maintenance_burden_score: row.maintenance_burden_score as number | null,
      spare_part_score: row.spare_part_score as number | null,
      risk_score: row.risk_score as number | null,
      cost_score: row.cost_score as number | null,
      priority_index: Number(row.replacement_priority_index ?? 0),
      rank: Number(row.rank ?? 0),
      justification: (row.justification as string | null) ?? null,
    };
  });

  if (process.env.NODE_ENV === 'development') {
    console.log(`[Command/Section5] replacement priority rows: ${all.length}`);
  }

  return { rows: all.slice(0, 5), total: all.length }; // top 5 by design; total for footer
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function CommandCenterPage() {
  const profile = await getServerProfile();
  const primaryRole = profile?.roleNames?.[0] ?? 'viewer';
  const profileId = profile ? ((profile as unknown as Record<string, unknown>).id as string ?? null) : null;
  const departmentId = profile ? ((profile as unknown as Record<string, unknown>).department_id as string ?? null) : null;
  const canMutate = primaryRole !== 'viewer';

  const supabase = await createClient();

  let triage: { rows: TriageRow[]; totalItems: number } = { rows: [], totalItems: 0 };
  let readiness: DeptReadiness[] = [];
  let wip: WorkInProgress = { open_work_orders: 0, in_progress: 0, assigned: 0, on_hold: 0, overdue_pm: 0, overdue_pm_gt30: 0, calibration_due_30d: 0 };
  let risk: { rows: RiskScoreRow[]; totalAssets: number } = { rows: [], totalAssets: 0 };
  let replacement: { rows: ReplacementRow[]; total: number } = { rows: [], total: 0 };

  try {
    [triage, readiness, wip, risk, replacement] = await Promise.all([
      fetchTriageData(supabase, profileId, primaryRole),
      fetchReadinessData(supabase),
      fetchWorkInProgress(supabase),
      fetchRiskData(supabase),
      fetchReplacementData(supabase),
    ]);
  } catch (err) {
    console.error('[Command] Top-level data fetch error:', err);
  }

  // Build RPN bands from the full risk rows set.
  const bandCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  const bandAssets: Record<RiskBand['key'], RiskScoreRow[]> = { low: [], medium: [], high: [], critical: [] };
  for (const row of risk.rows) {
    const band = rpnBand(row.rpn);
    bandCounts[band]++;
    if (bandAssets[band].length < 5) bandAssets[band].push(row);
  }
  const totalAssessed = risk.rows.length;

  const bands: RiskBand[] = (['low', 'medium', 'high', 'critical'] as RiskBand['key'][]).map((key) => ({
    key,
    ...BAND_META[key],
    count: bandCounts[key],
    percentage: totalAssessed > 0 ? Math.round((bandCounts[key] / totalAssessed) * 100) : 0,
    topAssets: bandAssets[key],
  }));

  const triageHeading =
    primaryRole === 'technician'
      ? 'Your urgent items'
      : primaryRole === 'department_user'
        ? 'Department readiness focus'
        : primaryRole === 'store_user'
          ? 'Parts and procurement focus'
          : 'Hospital triage';
  const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Command Center"
        description={`Live operational status — ${now}`}
        actions={<RefreshButton />}
      />

      {/* ── Section 1: Today's Triage ─────────────────────────────────────── */}
      <section aria-label="Triage queue">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-rose-400" />
                  {triageHeading}
                </span>
              </CardTitle>
              {triage.totalItems > 10 && (
                <Link href="/command/triage" className="text-xs text-violet-300 hover:text-violet-200">
                  View all →
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {triage.rows.length === 0 ? (
              <div className="py-8 text-center">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                <p className="text-sm font-medium text-[var(--foreground)]">No urgent items right now</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">All systems within normal parameters</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-[760px] w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                        <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Asset</th>
                        <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Department</th>
                        <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Reason</th>
                        <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Score</th>
                        <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Action</th>
                        {canMutate && <th className="pb-2 font-medium text-[var(--text-muted)]">Ack</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]/60">
                      {triage.rows.map((row) => {
                        const action = actionForFlagType(row.flag_type ?? '', row.asset_id);
                        const isProcurementRelevant = row.flag_type === 'part_shortage' || row.flag_type === 'low_stock';
                        return (
                          <tr key={row.id} className="group">
                            <td className="py-3 pr-4">
                              <Link href={`/inventory/${row.asset_id}`} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                                {row.asset_name}
                              </Link>
                              <p className="text-xs text-[var(--text-muted)]">{row.asset_code}</p>
                            </td>
                            <td className="py-3 pr-4 text-[var(--text-muted)]">{row.department_name}</td>
                            <td className="max-w-md py-3 pr-4">
                              <p className="line-clamp-2 text-[var(--foreground)]">{row.recommendation}</p>
                              {row.rationale.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {row.rationale.slice(0, 4).map((item) => (
                                    <span key={item} className="rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                                      {item}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="py-3 pr-4">
                              <Badge variant={row.score >= 75 ? 'error' : row.score >= 45 ? 'warning' : 'info'}>
                                {row.score.toFixed(1)}
                              </Badge>
                            </td>
                            <td className="py-3 pr-4">
                              <Link
                                href={action.href}
                                className={`inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] transition hover:border-violet-400 hover:text-violet-300 ${isProcurementRelevant ? 'bg-amber-500/10 text-amber-300' : ''}`}
                              >
                                {action.label}
                              </Link>
                            </td>
                            {canMutate && (
                              <td className="py-3">
                                <AcknowledgeButton
                                  queueId={row.id}
                                  assetId={row.asset_id}
                                  hasActiveFlag={Boolean(row.flag_id)}
                                  label={`Acknowledge triage item for ${row.asset_name}`}
                                />
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-right text-xs text-[var(--text-muted)]">
                  Showing top {triage.rows.length} of {triage.totalItems} triage item{triage.totalItems !== 1 ? 's' : ''}
                  {triage.totalItems > 10 && (
                    <> — <Link href="/command/triage" className="text-violet-300 hover:text-violet-200">View all</Link></>
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Section 2: Hospital Readiness Strip ───────────────────────────── */}
      <section aria-label="Department readiness">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-violet-400" />
                Department readiness
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {readiness.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">No essential equipment data available</p>
            ) : (
              <>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {readiness.map((dept) => {
                    const colors = readinessColor(dept.readiness_score);
                    const isFocusedDepartment = primaryRole === 'department_user' && departmentId === dept.department_id;
                    return (
                      <Link
                        key={dept.department_id}
                        href={`/inventory?department=${dept.department_id}`}
                        className={`flex min-w-[140px] flex-col items-center rounded-lg border p-4 transition hover:opacity-80 ${colors.ring} ${isFocusedDepartment ? 'ring-2 ring-[var(--brand)] ring-offset-2 ring-offset-[var(--background)]' : ''}`}
                        aria-label={`${dept.department_name}: ${dept.readiness_score}% ready`}
                      >
                        <span className={`text-3xl font-bold ${colors.text}`}>{dept.readiness_score}%</span>
                        <span className="mt-1 text-center text-xs font-medium text-[var(--foreground)]">{dept.department_name}</span>
                        <span className="mt-1 text-center text-[10px] text-[var(--text-muted)]">
                          {dept.essential_functional}/{dept.essential_total} essential functional
                        </span>
                      </Link>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-[var(--text-muted)]">{readiness.length} departments monitored</p>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Section 3: Work In Progress ───────────────────────────────────── */}
      <section aria-label="Work in progress">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-[var(--text-muted)]">Work in progress</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Open Work Orders */}
          <Link href="/work-orders?status=open" className="panel-surface rounded-lg p-5 transition hover:border-[var(--brand)]/50">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--text-muted)]">Open Work Orders</p>
                <p className="mt-1 text-3xl font-bold text-[var(--foreground)]">{wip.open_work_orders}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {wip.in_progress > 0 && <span className="text-xs text-[var(--text-muted)]">{wip.in_progress} in progress</span>}
                  {wip.assigned > 0 && <span className="text-xs text-[var(--text-muted)]">{wip.assigned} assigned</span>}
                  {wip.on_hold > 0 && <span className="text-xs text-amber-400">{wip.on_hold} on hold</span>}
                </div>
              </div>
              <div className="rounded-lg bg-blue-500/15 p-3 text-blue-300">
                <ClipboardList className="h-6 w-6" />
              </div>
            </div>
          </Link>

          {/* Overdue PM */}
          <Link href="/pm?status=overdue" className="panel-surface rounded-lg p-5 transition hover:border-[var(--brand)]/50">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--text-muted)]">Overdue PM</p>
                <p className="mt-1 text-3xl font-bold text-[var(--foreground)]">{wip.overdue_pm}</p>
                {wip.overdue_pm_gt30 > 0 && (
                  <p className="mt-2 text-xs text-rose-400">{wip.overdue_pm_gt30} overdue &gt;30 days</p>
                )}
              </div>
              <div className="rounded-lg bg-amber-500/15 p-3 text-amber-300">
                <CalendarCheck className="h-6 w-6" />
              </div>
            </div>
          </Link>

          {/* Calibration Due */}
          <Link href="/calibration?due_within=30" className="panel-surface rounded-lg p-5 transition hover:border-[var(--brand)]/50">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--text-muted)]">Calibration Due (30d)</p>
                <p className="mt-1 text-3xl font-bold text-[var(--foreground)]">{wip.calibration_due_30d}</p>
              </div>
              <div className="rounded-lg bg-violet-500/15 p-3 text-violet-300">
                <Wrench className="h-6 w-6" />
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* ── Section 4: Risk Distribution ──────────────────────────────────── */}
      <section aria-label="Equipment risk distribution">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-orange-400" />
                  Equipment by risk priority (RPN)
                </span>
              </CardTitle>
              <span className="text-xs text-[var(--text-muted)]">
                Total: {totalAssessed} of {risk.totalAssets} equipment assessed
                {risk.totalAssets > totalAssessed && (
                  <span
                    title="Some equipment has not yet been risk-scored. Complete a maintenance event to trigger scoring."
                    className="ml-1 inline-flex cursor-help items-center text-amber-400"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </span>
                )}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {totalAssessed === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">No risk scores computed yet</p>
            ) : (
              <>
                <RiskBandDrilldown bands={bands} totalAssessed={totalAssessed} />
                <p className="mt-4 text-xs text-[var(--text-muted)]">
                  Methodology: RPN = Severity × Occurrence × Detectability —{' '}
                  <Link href="/reports" className="text-violet-300 hover:text-violet-200">methodology reference</Link>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Section 5: Replacement Watchlist ──────────────────────────────── */}
      <section aria-label="Replacement watchlist">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <ArrowUpDown className="h-5 w-5 text-amber-400" />
                  Top replacement candidates
                </span>
              </CardTitle>
              {replacement.total > 0 && (
                <Link href="/replacement" className="text-xs text-violet-300 hover:text-violet-200">
                  View full ranking ({replacement.total} candidates) →
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {replacement.rows.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">No replacement candidates scored yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[720px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Rank</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Asset</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Department</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Priority Index</th>
                      <th className="pb-2 font-medium text-[var(--text-muted)]">Key Driver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {replacement.rows.map((row) => (
                      <tr key={row.asset_id}>
                        <td className="py-3 pr-4">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-300">
                            {row.rank}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <Link href={`/inventory/${row.asset_id}`} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                            {row.asset_name}
                          </Link>
                          <p className="text-xs text-[var(--text-muted)]">{row.asset_code}</p>
                        </td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{row.department_name}</td>
                        <td className="py-3 pr-4">
                          <Badge variant="warning">{row.priority_index.toFixed(1)}</Badge>
                        </td>
                        <td className="max-w-md py-3">
                          <p className="line-clamp-2 text-xs text-[var(--text-muted)]">
                            {generateReplacementDriver(row)}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* TODO Task 6: sensitivity analysis sliders */}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
