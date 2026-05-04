import Link from 'next/link';
import {
  ArrowUpDown, Info, ShieldAlert,
} from 'lucide-react';
import { requireRole } from '@/lib/auth/helpers';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import ExpandableText from '@/components/ui/ExpandableText';
import { RefreshButton } from './_components/RefreshButton';
import CommandCenterInteractive from './_components/CommandCenterInteractive';
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

function normalizeRationale(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => `${key}=${Array.isArray(val) ? val.join(', ') : String(val)}`)
      .filter(Boolean);
  }
  if (typeof value === 'string') return [value];
  return [];
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
  // Fetch asset_ids for distinct-count, and a larger set of rows for dedup.
  let assetIdQuery = supabase
    .from('v_command_center_triage')
    .select('asset_id')
    .eq('status', 'open')
    .limit(500);

  let rowsQuery = supabase
    .from('v_command_center_triage')
    .select('triage_id, asset_id, asset_code, asset_name, department_id, department_name, priority_score, recommendation, rationale, top_flag_id, top_flag_type, top_flag_severity')
    .eq('status', 'open')
    .order('priority_score', { ascending: false });

  if (primaryRole === 'technician' && profileId) {
    assetIdQuery = assetIdQuery.eq('assigned_to', profileId);
    rowsQuery = rowsQuery.eq('assigned_to', profileId);
  }

  const [assetIdRes, rowsRes] = await Promise.all([
    assetIdQuery,
    rowsQuery.limit(100),
  ]);

  if (assetIdRes.error || rowsRes.error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[Command/Section1] triage queue query error:', assetIdRes.error ?? rowsRes.error);
    }
    return { rows: [], totalItems: 0 };
  }

  // Count distinct asset_ids for the footer total.
  const totalUniqueAssets = new Set(
    (assetIdRes.data ?? []).map((r: Record<string, unknown>) => r.asset_id as string).filter(Boolean)
  ).size;

  const allRows = (rowsRes.data ?? []) as Array<Record<string, unknown>>;

  // Deduplicate by asset_id — keep highest priority_score per asset, then take top 10.
  const deduped = new Map<string, Record<string, unknown>>();
  for (const row of allRows) {
    const aid = row.asset_id as string;
    const existing = deduped.get(aid);
    if (!existing || Number(row.priority_score) > Number(existing.priority_score)) {
      deduped.set(aid, row);
    }
  }
  const queueRows = Array.from(deduped.values())
    .sort((a, b) => Number(b.priority_score) - Number(a.priority_score))
    .slice(0, 10);

  const rows = queueRows.map((row) => {
    return {
      id: row.triage_id as string,
      flag_id: (row.top_flag_id as string | undefined) ?? null,
      flag_type: (row.top_flag_type as string | undefined) ?? null,
      flag_severity: (row.top_flag_severity as string | undefined) ?? null,
      asset_id: row.asset_id as string,
      asset_name: (row.asset_name as string | undefined) ?? 'Unknown asset',
      asset_code: (row.asset_code as string | undefined) ?? 'N/A',
      department_id: (row.department_id as string | null) ?? null,
      department_name: (row.department_name as string | undefined) ?? 'Unknown',
      recommendation: generateTriageReason({
        flagType: (row.top_flag_type as string | undefined) ?? null,
        rationale: normalizeRationale(row.rationale),
        fallbackRecommendation: (row.recommendation as string | undefined) ?? null,
      }),
      rationale: normalizeRationale(row.rationale),
      score: Number(row.priority_score ?? 0),
    };
  });

  return { rows, totalItems: totalUniqueAssets };
}

async function fetchReadinessData(supabase: Awaited<ReturnType<typeof createClient>>): Promise<DeptReadiness[]> {
  const { data, error } = await supabase
    .from('v_department_readiness')
    .select('department_id, department_name, readiness_score, essential_total, essential_functional')
    .order('department_name', { ascending: true })
    .limit(500);

  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[Command/Section2] readiness query error:', error);
    return [];
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      department_id: row.department_id as string,
      department_name: (row.department_name as string | undefined) ?? 'Unknown',
      essential_total: Number(row.essential_total ?? 0),
      essential_functional: Number(row.essential_functional ?? 0),
      readiness_score: Math.round(Number(row.readiness_score ?? 0)),
    }));

  if (process.env.NODE_ENV === 'development') {
    console.log(`[Command/Section2] latest clinical readiness snapshot departments: ${rows.length}`);
  }

  return rows.sort((a, b) => a.department_name.localeCompare(b.department_name));
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
    .from('v_replacement_decision')
    .select('asset_id, asset_code, asset_name, department_name, age_score, failure_score, availability_score, maintenance_burden_score, spare_part_score, risk_score, cost_score, replacement_priority_index, replacement_rank, justification')
    .order('replacement_priority_index', { ascending: false })
    .limit(500); // performance guard; returns all candidates for total count

  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[Command/Section5] replacement query error:', error);
    return { rows: [], total: 0 };
  }

  const all = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    return {
      asset_id: row.asset_id as string,
      asset_name: (row.asset_name as string | undefined) ?? 'Unknown',
      asset_code: (row.asset_code as string | undefined) ?? 'N/A',
      department_name: (row.department_name as string | undefined) ?? 'Unknown',
      age_score: row.age_score as number | null,
      failure_score: row.failure_score as number | null,
      availability_score: row.availability_score as number | null,
      maintenance_burden_score: row.maintenance_burden_score as number | null,
      spare_part_score: row.spare_part_score as number | null,
      risk_score: row.risk_score as number | null,
      cost_score: row.cost_score as number | null,
      priority_index: Number(row.replacement_priority_index ?? 0),
      rank: Number(row.replacement_rank ?? 0),
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
  const profile = await requireRole(['developer', 'admin', 'technician', 'department_user', 'store_user', 'viewer']);
  const primaryRole = profile.roleNames?.[0] ?? 'viewer';
  const profileId = ((profile as unknown as Record<string, unknown>).id as string | undefined) ?? null;
  const departmentId = ((profile as unknown as Record<string, unknown>).department_id as string | undefined) ?? null;
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
    bandAssets[band].push(row);
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

      <CommandCenterInteractive
        triageRows={triage.rows}
        triageTotalItems={triage.totalItems}
        triageHeading={triageHeading}
        canMutate={canMutate}
        readiness={readiness}
        wip={wip}
        primaryRole={primaryRole}
        departmentId={departmentId}
      />

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
                          <Link href={`/equipment/${row.asset_id}`} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                            {row.asset_name}
                          </Link>
                          <p className="text-xs text-[var(--text-muted)]">{row.asset_code}</p>
                        </td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{row.department_name}</td>
                        <td className="py-3 pr-4">
                          <Badge variant="warning">{row.priority_index.toFixed(1)}</Badge>
                        </td>
                        <td className="max-w-md py-3">
                          <ExpandableText text={generateReplacementDriver(row)} lines={2} className="text-xs text-[var(--text-muted)]" />
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
