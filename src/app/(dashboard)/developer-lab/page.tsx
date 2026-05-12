import Link from 'next/link';
import { Activity, Beaker, ClipboardCheck, DatabaseZap, FileDown, ShieldCheck } from 'lucide-react';
import { requireRole } from '@/lib/auth/helpers';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import DeveloperLabClient, { type LabReplacementRow } from './DeveloperLabClient';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type HealthCheck = {
  label: string;
  count: number | string;
  severity: 'critical' | 'warning' | 'info' | 'ok';
  explanation: string;
  href?: string;
};

const METHOD_CARDS = [
  {
    title: 'FMEA / RPN',
    formula: 'RPN = Severity x Occurrence x Detectability',
    criteria: 'Clinical impact, recent failure behavior, PM/calibration control evidence',
    source: 'equipment_risk_scores, maintenance_events, pm_schedules, calibration_records',
    interpretation: 'Higher RPN means higher risk pressure and stronger need for BME review.',
    href: '/command/drilldown/risk-watch',
  },
  {
    title: 'Replacement Priority Index',
    formula: 'RPI = sum(weight x normalized criterion)',
    criteria: 'Age, failures, availability, maintenance burden, spare support, FMEA risk, cost',
    source: 'replacement_priority_scores, v_replacement_decision',
    interpretation: 'Higher RPI means stronger replacement planning evidence, not an automatic approval.',
    href: '/replacement',
  },
  {
    title: 'Equipment Health Score',
    formula: 'Health = weighted reliability + PM + risk + condition components',
    criteria: 'Availability, PM compliance, RPN penalty, condition/status penalty, active flags',
    source: 'equipment_health_snapshots and operational fallback calculations',
    interpretation: 'Lower health highlights equipment needing operational review.',
    href: '/command',
  },
  {
    title: 'Department Readiness',
    formula: 'Readiness = essential functional assets / total essential assets',
    criteria: 'Department asset criticality, condition, active status',
    source: 'clinical_readiness_snapshots, equipment_assets, equipment_categories',
    interpretation: 'Lower readiness means clinical service continuity is more exposed.',
    href: '/command',
  },
  {
    title: 'Critical Action Score',
    formula: 'Score = category base weight + workflow urgency signals',
    criteria: 'Corrective, PM, calibration, stock, installation, replacement, procurement signals',
    source: 'Command Center typed fetchers and critical action builder',
    interpretation: 'Ranks cross-module work so the BME Head can review the most urgent issues first.',
    href: '/command',
  },
  {
    title: 'PM Compliance',
    formula: 'PMC = completed scheduled PM tasks / total scheduled PM tasks',
    criteria: 'Completed, scheduled, deferred, skipped, and overdue task evidence',
    source: 'pm_schedules, pm_completions',
    interpretation: 'Shows whether preventive maintenance controls are being performed on time.',
    href: '/reports/pm',
  },
  {
    title: 'Calibration Risk',
    formula: 'Priority = overdue severity + criticality + last result + department impact + workflow state',
    criteria: 'Days overdue, equipment criticality, failed/adjusted results, high-impact departments, and open request state',
    source: 'calibration_records, calibration_requests, equipment_assets',
    interpretation: 'Highlights safety and accuracy compliance work without treating every overdue item as equally critical.',
    href: '/calibration',
  },
  {
    title: 'Workload / Capacity Score',
    formula: 'Capacity pressure = open assigned work + overdue work + high-priority work',
    criteria: 'Assigned work orders, in-progress work, on-hold blockers, priority, and age',
    source: 'work_orders, profiles',
    interpretation: 'Supports assignment review; it does not override BME Head staffing judgment.',
    href: '/work-orders',
  },
  {
    title: 'Stock Blocker Priority',
    formula: 'Priority = stockout severity + reorder deficit + open work linkage',
    criteria: 'Current stock, reorder level, linked maintenance work, asset context',
    source: 'spare_parts, stock_issues, maintenance_parts_used, work_orders',
    interpretation: 'Separates true repair blockers from low-stock risks.',
    href: '/spare-parts',
  },
  {
    title: 'Procurement Impact Priority',
    formula: 'Priority = workflow status + delay days + criticality/stockout linkage',
    criteria: 'Status, expected delivery, delay, linked part/asset/workflow text evidence',
    source: 'procurement_requests',
    interpretation: 'Highlights purchases that are delaying biomedical operations.',
    href: '/procurement',
  },
];

function variantForSeverity(severity: HealthCheck['severity']) {
  if (severity === 'critical') return 'error';
  if (severity === 'warning') return 'warning';
  if (severity === 'ok') return 'success';
  return 'info';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeScore(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function countByMissing<T>(rows: T[], predicate: (row: T) => boolean) {
  return rows.filter(predicate).length;
}

export default async function DeveloperLabPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(['developer', 'admin']);
  await searchParams;
  const supabase = await createClient();
  const currentDate = today();

  const [
    assetsRes,
    riskRes,
    pmPlansRes,
    pmSchedulesRes,
    calibrationRecordsRes,
    partsRes,
    procurementRes,
    profilesRes,
    departmentsRes,
    categoriesRes,
    disposalRequestsRes,
    replacementRes,
    refreshLogRes,
  ] = await Promise.all([
    supabase.from('equipment_assets').select('id, asset_code, name, department_id, category_id, condition, status').is('deleted_at', null).limit(5000),
    supabase.from('equipment_risk_scores').select('asset_id').limit(5000),
    supabase.from('pm_plans').select('id, is_active').limit(5000),
    supabase.from('pm_schedules').select('id, plan_id, status, scheduled_date').limit(5000),
    supabase.from('calibration_records').select('id, asset_id, next_due_date, result').limit(5000),
    supabase.from('spare_parts').select('id, current_stock, reorder_level, is_active').limit(5000),
    supabase.from('procurement_requests').select('id, status, expected_delivery_date').limit(5000),
    supabase.from('profiles').select('id, user_id, is_active, user_roles(id)').limit(5000),
    supabase.from('departments').select('id, name, is_active').limit(5000),
    supabase.from('equipment_categories').select('id, name, criticality_level').limit(5000),
    supabase.from('disposal_requests').select('id, asset_id, status').limit(5000),
    supabase
      .from('v_replacement_decision')
      .select('asset_id, asset_code, asset_name, department_name, age_score, failure_score, availability_score, maintenance_burden_score, spare_part_score, risk_score, cost_score, replacement_priority_index, replacement_rank')
      .order('replacement_rank', { ascending: true })
      .limit(100),
    supabase.from('decision_support_refresh_log').select('scope, status, started_at, finished_at, error_message').order('started_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const assets = (assetsRes.data ?? []) as Array<Record<string, unknown>>;
  const riskRows = (riskRes.data ?? []) as Array<Record<string, unknown>>;
  const pmPlans = (pmPlansRes.data ?? []) as Array<Record<string, unknown>>;
  const pmSchedules = (pmSchedulesRes.data ?? []) as Array<Record<string, unknown>>;
  const calibrationRecords = (calibrationRecordsRes.data ?? []) as Array<Record<string, unknown>>;
  const parts = (partsRes.data ?? []) as Array<Record<string, unknown>>;
  const procurementRows = (procurementRes.data ?? []) as Array<Record<string, unknown>>;
  const profiles = (profilesRes.data ?? []) as Array<Record<string, unknown>>;
  const departments = (departmentsRes.data ?? []) as Array<Record<string, unknown>>;
  const categories = (categoriesRes.data ?? []) as Array<Record<string, unknown>>;
  const disposalRequests = (disposalRequestsRes.data ?? []) as Array<Record<string, unknown>>;

  const riskAssetIds = new Set(riskRows.map((row) => row.asset_id).filter(Boolean));
  const activeScheduleStatuses = new Set(['scheduled', 'in_progress', 'overdue', 'deferred']);
  const activePlanIds = new Set(pmSchedules.filter((row) => activeScheduleStatuses.has(String(row.status))).map((row) => row.plan_id).filter(Boolean));
  const calibrationAssetIds = new Set(calibrationRecords.map((row) => row.asset_id).filter(Boolean));
  const disposalAssetIds = new Set(disposalRequests.map((row) => row.asset_id).filter(Boolean));
  const departmentIdsWithEquipment = new Set(assets.map((row) => row.department_id).filter(Boolean));

  const replacementRows: LabReplacementRow[] = ((replacementRes.data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => row.asset_id)
    .map((row) => ({
      assetId: String(row.asset_id),
      assetCode: String(row.asset_code ?? 'N/A'),
      assetName: String(row.asset_name ?? 'Unknown asset'),
      departmentName: String(row.department_name ?? 'Unknown department'),
      rank: normalizeScore(row.replacement_rank),
      priorityIndex: normalizeScore(row.replacement_priority_index),
      scores: {
        ageScore: normalizeScore(row.age_score),
        failureScore: normalizeScore(row.failure_score),
        availabilityScore: normalizeScore(row.availability_score),
        maintenanceBurdenScore: normalizeScore(row.maintenance_burden_score),
        sparePartScore: normalizeScore(row.spare_part_score),
        riskScore: normalizeScore(row.risk_score),
        costScore: normalizeScore(row.cost_score),
      },
    }));

  const highReplacementAssetIds = new Set(
    replacementRows
      .filter((row) => (row.priorityIndex ?? 0) >= 0.7 || (row.rank != null && row.rank <= 10))
      .map((row) => row.assetId)
  );

  const healthChecks: HealthCheck[] = [
    {
      label: 'Assets without department',
      count: countByMissing(assets, (row) => !row.department_id),
      severity: countByMissing(assets, (row) => !row.department_id) > 0 ? 'warning' : 'ok',
      explanation: 'Department assignment is required for readiness, reports, and ownership filters.',
      href: '/equipment',
    },
    {
      label: 'Assets without category',
      count: countByMissing(assets, (row) => !row.category_id),
      severity: countByMissing(assets, (row) => !row.category_id) > 0 ? 'warning' : 'ok',
      explanation: 'Category drives criticality, PM expectations, and replacement interpretation.',
      href: '/equipment',
    },
    {
      label: 'Active equipment without risk score',
      count: countByMissing(assets, (row) => row.status === 'active' && !riskAssetIds.has(row.id as string)),
      severity: countByMissing(assets, (row) => row.status === 'active' && !riskAssetIds.has(row.id as string)) > 0 ? 'critical' : 'ok',
      explanation: 'FMEA coverage is needed for risk bands, triage, alerts, and replacement planning.',
      href: '/developer-lab?focus=risk-scores',
    },
    {
      label: 'PM plans without upcoming task',
      count: countByMissing(pmPlans, (row) => row.is_active === true && !activePlanIds.has(row.id as string)),
      severity: countByMissing(pmPlans, (row) => row.is_active === true && !activePlanIds.has(row.id as string)) > 0 ? 'warning' : 'ok',
      explanation: 'Active PM plans should normally have one unfinished scheduled task or clear history state.',
      href: '/pm?filter=needs-next-task&source=developer-lab',
    },
    {
      label: 'Overdue PM',
      count: countByMissing(pmSchedules, (row) => Boolean(row.scheduled_date && String(row.scheduled_date) < currentDate && !['completed', 'skipped', 'canceled'].includes(String(row.status)))),
      severity: countByMissing(pmSchedules, (row) => Boolean(row.scheduled_date && String(row.scheduled_date) < currentDate && !['completed', 'skipped', 'canceled'].includes(String(row.status)))) > 0 ? 'critical' : 'ok',
      explanation: 'Overdue PM weakens preventive control and can increase detectability risk.',
      href: '/pm?filter=overdue&source=developer-lab',
    },
    {
      label: 'Overdue calibration',
      count: countByMissing(calibrationRecords, (row) => Boolean(row.next_due_date && String(row.next_due_date) < currentDate)),
      severity: countByMissing(calibrationRecords, (row) => Boolean(row.next_due_date && String(row.next_due_date) < currentDate)) > 0 ? 'critical' : 'ok',
      explanation: 'Overdue calibration is a safety and accuracy compliance issue.',
      href: '/calibration?tab=upcoming&source=developer-lab',
    },
    {
      label: 'Low stock blockers',
      count: countByMissing(parts, (row) => row.is_active !== false && Number(row.current_stock ?? 0) <= Number(row.reorder_level ?? 0)),
      severity: countByMissing(parts, (row) => row.is_active !== false && Number(row.current_stock ?? 0) <= Number(row.reorder_level ?? 0)) > 0 ? 'warning' : 'ok',
      explanation: 'Low stock can delay repairs and should connect to procurement when needed.',
      href: '/spare-parts?tab=lowstock&source=developer-lab',
    },
    {
      label: 'Stockout without procurement',
      count: countByMissing(parts, (row) => row.is_active !== false && Number(row.current_stock ?? 0) <= 0),
      severity: countByMissing(parts, (row) => row.is_active !== false && Number(row.current_stock ?? 0) <= 0) > 0 ? 'critical' : 'ok',
      explanation: 'Procurement links are stored as textual justification today, so verify stockout requests manually.',
      href: '/procurement?source=developer-lab&filter=stockout',
    },
    {
      label: 'Procurement delayed',
      count: countByMissing(procurementRows, (row) => Boolean(row.expected_delivery_date && String(row.expected_delivery_date) < currentDate && !['delivered', 'canceled'].includes(String(row.status)))),
      severity: countByMissing(procurementRows, (row) => Boolean(row.expected_delivery_date && String(row.expected_delivery_date) < currentDate && !['delivered', 'canceled'].includes(String(row.status)))) > 0 ? 'warning' : 'ok',
      explanation: 'Late procurement can block maintenance, stock recovery, and replacement workflows.',
      href: '/procurement?source=developer-lab&filter=delayed',
    },
    {
      label: 'Profiles without roles',
      count: countByMissing(profiles, (row) => !Array.isArray(row.user_roles) || row.user_roles.length === 0),
      severity: countByMissing(profiles, (row) => !Array.isArray(row.user_roles) || row.user_roles.length === 0) > 0 ? 'warning' : 'ok',
      explanation: 'Profiles need roles for route access, server actions, and RLS behavior.',
      href: '/settings?tab=staff-access',
    },
    {
      label: 'Auth users without profiles',
      count: 'Requires Supabase Auth admin API',
      severity: 'info',
      explanation: 'The app can show profile-to-auth links, but cannot safely enumerate auth.users from the browser/client service.',
      href: '/settings?tab=security-access',
    },
    {
      label: 'Departments without equipment',
      count: countByMissing(departments, (row) => !departmentIdsWithEquipment.has(row.id as string)),
      severity: countByMissing(departments, (row) => !departmentIdsWithEquipment.has(row.id as string)) > 0 ? 'info' : 'ok',
      explanation: 'Empty departments may be valid, but readiness and reports should explain them.',
      href: '/settings?tab=departments',
    },
    {
      label: 'Categories without criticality',
      count: countByMissing(categories, (row) => !row.criticality_level),
      severity: countByMissing(categories, (row) => !row.criticality_level) > 0 ? 'warning' : 'ok',
      explanation: 'Criticality is needed for readiness and lifecycle scoring interpretation.',
      href: '/settings?tab=equipment-categories',
    },
    {
      label: 'Calibration-relevant equipment without history',
      count: countByMissing(assets, (row) => row.status === 'active' && !calibrationAssetIds.has(row.id as string)),
      severity: countByMissing(assets, (row) => row.status === 'active' && !calibrationAssetIds.has(row.id as string)) > 0 ? 'info' : 'ok',
      explanation: 'The current schema does not flag calibration-required assets, so this check uses active equipment as a broad coverage proxy.',
      href: '/calibration?tab=records&source=developer-lab',
    },
    {
      label: 'Replacement candidates without disposal request',
      count: Array.from(highReplacementAssetIds).filter((assetId) => !disposalAssetIds.has(assetId)).length,
      severity: Array.from(highReplacementAssetIds).filter((assetId) => !disposalAssetIds.has(assetId)).length > 0 ? 'info' : 'ok',
      explanation: 'Replacement evidence and formal disposal requests are related but separate workflows.',
      href: '/disposal?tab=candidates&source=developer-lab',
    },
  ];

  const lastRefresh = refreshLogRes.data as Record<string, unknown> | null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer Lab"
        description="Scoring methods, sensitivity testing, data health, debug tools, and thesis demonstration controls."
        actions={<Badge variant="purple">Developer Only</Badge>}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <Activity className="mb-2 h-5 w-5 text-violet-300" />
          <p className="text-sm text-[var(--text-muted)]">Ranked assets</p>
          <p className="text-2xl font-semibold text-[var(--foreground)]">{replacementRows.length}</p>
        </Card>
        <Card>
          <DatabaseZap className="mb-2 h-5 w-5 text-cyan-300" />
          <p className="text-sm text-[var(--text-muted)]">Health checks</p>
          <p className="text-2xl font-semibold text-[var(--foreground)]">{healthChecks.length}</p>
        </Card>
        <Card>
          <ShieldCheck className="mb-2 h-5 w-5 text-emerald-300" />
          <p className="text-sm text-[var(--text-muted)]">Last refresh</p>
          <p className="text-sm font-semibold text-[var(--foreground)]">
            {lastRefresh?.started_at ? new Date(String(lastRefresh.started_at)).toLocaleString() : 'No log'}
          </p>
        </Card>
        <Card>
          <ClipboardCheck className="mb-2 h-5 w-5 text-amber-300" />
          <p className="text-sm text-[var(--text-muted)]">Refresh status</p>
          <Badge variant={lastRefresh?.status === 'error' ? 'error' : lastRefresh?.status === 'success' ? 'success' : 'info'}>
            {String(lastRefresh?.status ?? 'not run')}
          </Badge>
        </Card>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Scoring Methodology</h2>
          <p className="text-sm text-[var(--text-muted)]">Formula, criteria, source data, interpretation, and live records using each method.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {METHOD_CARDS.map((method) => (
            <Card key={method.title}>
              <CardHeader className="items-start">
                <div>
                  <CardTitle>{method.title}</CardTitle>
                  <p className="mt-1 rounded-md bg-[var(--surface-2)]/70 p-2 font-mono text-xs text-[var(--foreground)]">{method.formula}</p>
                </div>
                <Link href={method.href} className="text-xs text-[var(--brand)] hover:underline">Records</Link>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p><span className="text-[var(--text-muted)]">Criteria:</span> {method.criteria}</p>
                <p><span className="text-[var(--text-muted)]">Source:</span> {method.source}</p>
                <p><span className="text-[var(--text-muted)]">Interpretation:</span> {method.interpretation}</p>
                <p><span className="text-[var(--text-muted)]">Example:</span> see the sandbox ranking comparison below or exact record evidence.</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <DeveloperLabClient replacementRows={replacementRows} />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Data Health Checks</h2>
          <p className="text-sm text-[var(--text-muted)]">Counts come from real tables/views. Missing schema support is labeled instead of simulated.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {healthChecks.map((check) => (
            <Card key={check.label}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-[var(--foreground)]">{check.label}</p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">{check.explanation}</p>
                </div>
                <Badge variant={variantForSeverity(check.severity)}>{check.count}</Badge>
              </div>
              {check.href && (
                <Link className="mt-3 inline-flex text-xs text-[var(--brand)] hover:underline" href={check.href}>
                  Open drilldown/action
                </Link>
              )}
            </Card>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Thesis Demo Tools</CardTitle>
          <Beaker className="h-5 w-5 text-violet-300" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Link href="/reports/evaluation-demo">
              <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm hover:border-[var(--brand)]/50">
                <FileDown className="mb-2 h-4 w-4 text-[var(--brand)]" />
                Generate demo evidence report
              </div>
            </Link>
            <Link href="/reports/replacement-planning">
              <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm hover:border-[var(--brand)]/50">
                <FileDown className="mb-2 h-4 w-4 text-[var(--brand)]" />
                Export replacement evidence
              </div>
            </Link>
            <Link href="/reports/audit-security">
              <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm hover:border-[var(--brand)]/50">
                <FileDown className="mb-2 h-4 w-4 text-[var(--brand)]" />
                Audit/security evidence
              </div>
            </Link>
            <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm text-[var(--text-muted)]">
              Demo reset is intentionally disabled until a safe reset migration/script exists.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
