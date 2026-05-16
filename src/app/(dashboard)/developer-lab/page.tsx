import Link from 'next/link';
import { Activity, Beaker, ClipboardCheck, DatabaseZap, FileDown, ShieldCheck } from 'lucide-react';
import { requireRole } from '@/lib/auth/helpers';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import DeveloperLabClient, { type LabReplacementRow } from './DeveloperLabClient';
import QrCoverageSection from './QrCoverageSection';
import OfflineDiagnosticsPanel from './OfflineDiagnosticsPanel';
import { getQrCoverageStats, getQrScanCoverageStats } from '@/services/qr.service';
import { getOfflineSyncServerSummary } from '@/services/offline-sync.service';
import {
  countLowStock,
  countStockout,
  countOverdueCalibration,
  countOverduePM,
  countPMPlansWithoutUpcomingTask,
  countDelayedProcurement,
  countReplacementCandidates,
} from '@/utils/decision-support/canonical-counts';
import { REPLACEMENT_STRONG_THRESHOLD } from '@/utils/decision-support/replacement-thresholds';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type HealthCheck = {
  label: string;
  count: number | string;
  severity: 'critical' | 'warning' | 'info' | 'ok';
  explanation: string;
  href?: string;
  actionLabel?: string;
  group: 'data' | 'workflow' | 'decision-support' | 'security';
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

function normalizeScore(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function countByMissing<T>(rows: T[], predicate: (row: T) => boolean) {
  return rows.filter(predicate).length;
}

export default async function DeveloperLabPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(['developer']);
  await searchParams;
  const supabase = await createClient();

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
    workOrdersRes,
    pmSchedulesAssignedRes,
    demoProfilesRes,
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
    supabase.from('work_orders').select('id, assigned_to, status').limit(5000),
    supabase.from('pm_schedules').select('id, assigned_to, status').not('assigned_to', 'is', null).limit(5000),
    supabase
      .from('profiles')
      .select('id, email, full_name, user_id, is_active, user_roles(id, roles(name))')
      .in('email', [
        'developer@bmerms-demo.local',
        'bme.head@bmerms-demo.local',
        'technician@bmerms-demo.local',
        'department.head@bmerms-demo.local',
        'department.user@bmerms-demo.local',
        'store.user@bmerms-demo.local',
        'viewer@bmerms-demo.local',
      ]),
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
  const calibrationAssetIds = new Set(calibrationRecords.map((row) => row.asset_id).filter(Boolean));
  const profileIds = new Set(profiles.map((row) => row.id as string).filter(Boolean));
  const workOrderRows = (workOrdersRes.data ?? []) as Array<Record<string, unknown>>;
  const pmAssignedRows = (pmSchedulesAssignedRes.data ?? []) as Array<Record<string, unknown>>;
  const workOrdersWithMissingAssignee = workOrderRows.filter((row) => row.assigned_to && !profileIds.has(row.assigned_to as string)).length;
  const pmSchedulesWithMissingAssignee = pmAssignedRows.filter((row) => row.assigned_to && !profileIds.has(row.assigned_to as string)).length;
  const profilesWithoutRoles = profiles.filter((row) => !Array.isArray(row.user_roles) || row.user_roles.length === 0).length;
  const disposalAssetIds = new Set(disposalRequests.map((row) => row.asset_id).filter(Boolean));
  const departmentIdsWithEquipment = new Set(assets.map((row) => row.department_id).filter(Boolean));
  const demoProfiles = ((demoProfilesRes.data ?? []) as unknown) as Array<{ id: string; email: string; full_name: string | null; user_id: string | null; is_active: boolean | null; user_roles: Array<{ id: string; roles: Array<{ name: string }> | { name: string } | null }> | null }>;
  const DEMO_EXPECTED: Array<{ email: string; role: string; nav: string }> = [
    { email: 'developer@bmerms-demo.local', role: 'developer', nav: 'Everything + Developer Lab' },
    { email: 'bme.head@bmerms-demo.local', role: 'bme_head', nav: 'All operational modules; no Developer Lab' },
    { email: 'technician@bmerms-demo.local', role: 'technician', nav: 'Work execution + parts + alerts' },
    { email: 'department.head@bmerms-demo.local', role: 'department_head', nav: 'Department equipment + requests + reports' },
    { email: 'department.user@bmerms-demo.local', role: 'department_user', nav: 'Create/view department requests' },
    { email: 'store.user@bmerms-demo.local', role: 'store_user', nav: 'Spare parts / logistics / procurement' },
    { email: 'viewer@bmerms-demo.local', role: 'viewer', nav: 'Read-only command center + reports' },
  ];

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

  // Strong replacement candidates only (RPI >= 0.70) — narrow signal for the
  // "without disposal request" check below. Uses the canonical threshold.
  const highReplacementAssetIds = new Set(
    replacementRows
      .filter((row) => (row.priorityIndex ?? 0) >= REPLACEMENT_STRONG_THRESHOLD)
      .map((row) => row.assetId)
  );

  const replacementCandidateCount = countReplacementCandidates(
    replacementRows.map((row) => ({ priority_index: row.priorityIndex }))
  );

  const healthChecks: HealthCheck[] = [
    {
      label: 'Assets without department',
      count: countByMissing(assets, (row) => !row.department_id),
      severity: countByMissing(assets, (row) => !row.department_id) > 0 ? 'warning' : 'ok',
      explanation: 'Department assignment is required for readiness, reports, and ownership filters.',
      href: '/equipment',
      actionLabel: 'Open Equipment List',
      group: 'data',
    },
    {
      label: 'Assets without category',
      count: countByMissing(assets, (row) => !row.category_id),
      severity: countByMissing(assets, (row) => !row.category_id) > 0 ? 'warning' : 'ok',
      explanation: 'Category drives criticality, PM expectations, and replacement interpretation.',
      href: '/equipment',
      actionLabel: 'Open Equipment List',
      group: 'data',
    },
    {
      label: 'Active equipment without risk score',
      count: countByMissing(assets, (row) => row.status === 'active' && !riskAssetIds.has(row.id as string)),
      severity: countByMissing(assets, (row) => row.status === 'active' && !riskAssetIds.has(row.id as string)) > 0 ? 'critical' : 'ok',
      explanation: 'FMEA coverage is needed for risk bands, triage, alerts, and replacement planning.',
      href: '/developer-lab?focus=risk-scores',
      actionLabel: 'Review Risk Scores',
      group: 'decision-support',
    },
    (() => {
      const c = countPMPlansWithoutUpcomingTask(pmPlans as Array<{ id?: string | null; is_active?: boolean | null }>, pmSchedules as Array<{ plan_id?: string | null; status?: string | null }>);
      return {
        label: 'PM plans without upcoming task',
        count: c,
        severity: c > 0 ? 'warning' : 'ok',
        explanation: 'Active PM plans should normally have one unfinished scheduled task or clear history state. Source: canonical-counts.ts → countPMPlansWithoutUpcomingTask.',
        href: '/pm?filter=needs-next-task&source=developer-lab',
        actionLabel: 'Open PM Plans Needing Next Task',
        group: 'workflow',
      } as HealthCheck;
    })(),
    (() => {
      const c = countOverduePM(pmSchedules as Array<{ status?: string | null; scheduled_date?: string | null }>);
      return {
        label: 'Overdue PM',
        count: c,
        severity: c > 0 ? 'critical' : 'ok',
        explanation: 'Overdue PM weakens preventive control. Counts scheduled_date < today AND status not completed/skipped/canceled/deferred. Source: canonical-counts.ts → countOverduePM.',
        href: '/pm?filter=overdue&source=developer-lab',
        actionLabel: 'Open Overdue PM',
        group: 'workflow',
      } as HealthCheck;
    })(),
    (() => {
      const c = countOverdueCalibration(calibrationRecords as Array<{ next_due_date?: string | null }>);
      return {
        label: 'Overdue calibration',
        count: c,
        severity: c > 0 ? 'critical' : 'ok',
        explanation: 'Overdue = next_due_date earlier than today. Seed contains historical dates; this count is expected until records are updated. Source: canonical-counts.ts → countOverdueCalibration (matches v_calibration_due).',
        href: '/calibration?tab=overdue&source=developer-lab',
        actionLabel: 'Open Overdue Calibration',
        group: 'workflow',
      } as HealthCheck;
    })(),
    (() => {
      const c = countLowStock(parts as Array<{ current_stock?: number | null; reorder_level?: number | null; is_active?: boolean | null }>);
      return {
        label: 'Low stock',
        count: c,
        severity: c > 0 ? 'warning' : 'ok',
        explanation: 'current_stock ≤ reorder_level AND current_stock > 0. Stockouts are tracked separately. Source: canonical-counts.ts → countLowStock.',
        href: '/spare-parts?tab=lowstock&source=developer-lab',
        actionLabel: 'Open Low Stock Parts',
        group: 'workflow',
      } as HealthCheck;
    })(),
    (() => {
      const c = countStockout(parts as Array<{ current_stock?: number | null; is_active?: boolean | null }>);
      return {
        label: 'Stockout blockers',
        count: c,
        severity: c > 0 ? 'critical' : 'ok',
        explanation: 'current_stock ≤ 0. Procurement linkage is by part name today (no FK), so verify open procurement manually for each stockout. Source: canonical-counts.ts → countStockout.',
        href: '/spare-parts?tab=blockers&source=developer-lab',
        actionLabel: 'Open Stock Blockers',
        group: 'workflow',
      } as HealthCheck;
    })(),
    (() => {
      const c = countDelayedProcurement(procurementRows as Array<{ status?: string | null; expected_delivery_date?: string | null }>);
      return {
        label: 'Procurement delayed',
        count: c,
        severity: c > 0 ? 'warning' : 'ok',
        explanation: 'expected_delivery_date < today AND status not delivered/canceled. Source: canonical-counts.ts → countDelayedProcurement.',
        href: '/procurement?filter=delayed&source=developer-lab',
        actionLabel: 'Open Delayed Procurement',
        group: 'workflow',
      } as HealthCheck;
    })(),
    {
      label: 'Profiles without roles',
      count: profilesWithoutRoles,
      severity: profilesWithoutRoles > 0 ? 'warning' : 'ok',
      explanation: 'Profiles need roles for route access, server actions, and RLS behavior. Should be 0 after seed/02 + seed/100 run.',
      href: '/settings?tab=staff-access&filter=missing-role',
      actionLabel: 'Open Profiles Missing Roles',
      group: 'security',
    },
    {
      label: 'Work orders with missing assignee profile',
      count: workOrdersWithMissingAssignee,
      severity: workOrdersWithMissingAssignee > 0 ? 'critical' : 'ok',
      explanation: 'work_orders.assigned_to points to a profiles.id that no longer exists. Indicates orphaned assignment data.',
      href: '/work-orders?filter=unassigned&source=developer-lab',
      actionLabel: 'Review Work Orders',
      group: 'security',
    },
    {
      label: 'PM schedules with missing assignee profile',
      count: pmSchedulesWithMissingAssignee,
      severity: pmSchedulesWithMissingAssignee > 0 ? 'critical' : 'ok',
      explanation: 'pm_schedules.assigned_to points to a profiles.id that no longer exists. Indicates orphaned assignment data.',
      href: '/pm?source=developer-lab',
      actionLabel: 'Review PM Schedules',
      group: 'security',
    },
    {
      label: 'Auth users without profiles',
      count: 'Requires Supabase Auth admin API',
      severity: 'info',
      explanation: 'The app can show profile-to-auth links, but cannot safely enumerate auth.users from the browser/client service. Use a server admin script for this check.',
      group: 'security',
    },
    {
      label: 'Departments without equipment',
      count: countByMissing(departments, (row) => !departmentIdsWithEquipment.has(row.id as string)),
      severity: countByMissing(departments, (row) => !departmentIdsWithEquipment.has(row.id as string)) > 0 ? 'info' : 'ok',
      explanation: 'Empty departments may be valid, but readiness and reports should explain them.',
      href: '/settings?tab=departments',
      actionLabel: 'Review Departments',
      group: 'data',
    },
    {
      label: 'Categories without criticality',
      count: countByMissing(categories, (row) => !row.criticality_level),
      severity: countByMissing(categories, (row) => !row.criticality_level) > 0 ? 'warning' : 'ok',
      explanation: 'Criticality is needed for readiness and lifecycle scoring interpretation.',
      href: '/settings?tab=equipment-categories',
      actionLabel: 'Review Equipment Categories',
      group: 'data',
    },
    {
      label: 'Calibration-relevant equipment without history',
      count: countByMissing(assets, (row) => row.status === 'active' && !calibrationAssetIds.has(row.id as string)),
      severity: countByMissing(assets, (row) => row.status === 'active' && !calibrationAssetIds.has(row.id as string)) > 0 ? 'info' : 'ok',
      explanation: 'The current schema does not flag calibration-required assets, so this check uses active equipment as a broad coverage proxy.',
      href: '/calibration?tab=records&source=developer-lab',
      actionLabel: 'Review Calibration Records',
      group: 'decision-support',
    },
    {
      label: 'Replacement candidates (RPI ≥ 0.55)',
      count: replacementCandidateCount,
      severity: replacementCandidateCount > 0 ? 'info' : 'ok',
      explanation: 'Canonical: assets above the review threshold. Strong (RPI ≥ 0.70) + Review (0.55 ≤ RPI < 0.70). Monitor band is excluded. Source: canonical-counts.ts → countReplacementCandidates.',
      href: '/replacement?filter=candidates&source=developer-lab',
      actionLabel: 'Open Replacement Candidates',
      group: 'decision-support',
    },
    {
      label: 'Strong replacement candidates without disposal request',
      count: Array.from(highReplacementAssetIds).filter((assetId) => !disposalAssetIds.has(assetId)).length,
      severity: Array.from(highReplacementAssetIds).filter((assetId) => !disposalAssetIds.has(assetId)).length > 0 ? 'info' : 'ok',
      explanation: 'Strong (RPI ≥ 0.70) replacement evidence without a formal disposal request. Replacement and disposal are related but separate workflows.',
      href: '/disposal?tab=candidates&source=developer-lab',
      actionLabel: 'Open Disposal Candidates',
      group: 'decision-support',
    },
  ];

  const lastRefresh = refreshLogRes.data as Record<string, unknown> | null;

  const [qrCoverageStats, qrScanStats, offlineSyncSummary] = await Promise.all([
    getQrCoverageStats(),
    getQrScanCoverageStats(),
    getOfflineSyncServerSummary(),
  ]);

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

      <QrCoverageSection stats={qrCoverageStats} scanStats={qrScanStats} />

      <OfflineDiagnosticsPanel serverSummary={offlineSyncSummary} />

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

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Score Connection Status</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Each composite score must be Live or Snapshot to appear on operational pages.
            Sandbox-only scores are simulation surfaces here in Developer Lab and do not affect
            decisions taken on Command Center, Equipment, or Reports.
          </p>
        </div>
        <div className="panel-surface overflow-x-auto rounded-lg">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Appears in</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Sandbox → live?</th>
                <th className="px-3 py-2">Last refresh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]/60">
              {([
                { name: 'RPN (FMEA)', src: 'equipment_risk_scores · fn_compute_rpn', pages: 'Command Center risk band, Equipment risk, Alerts', status: 'Snapshot', sandbox: 'No' },
                { name: 'RPI (Replacement Priority)', src: 'replacement_priority_scores · v_replacement_decision', pages: 'Command Center, /replacement, /reports/replacement-planning, /developer-lab', status: 'Snapshot', sandbox: 'No' },
                { name: 'Equipment Health Score', src: 'equipment_health_snapshots + operational fallback', pages: 'Command Center (interactive), Equipment detail', status: 'Snapshot', sandbox: 'No' },
                { name: 'Department / Clinical Readiness', src: 'v_department_readiness', pages: 'Command Center readiness cards, /reports/department-readiness', status: 'Live', sandbox: 'No' },
                { name: 'PM Compliance (PMC)', src: 'pm_compliance_metrics · fn_compute_pmc', pages: '/pm, /reports/pm, Command Center', status: 'Snapshot', sandbox: 'No' },
                { name: 'Calibration Risk', src: 'calibration_records · calibration_requests · equipment_assets', pages: '/calibration, Command Center calibration triage, /alerts', status: 'Live', sandbox: 'No' },
                { name: 'Critical Action Score', src: 'command-center-data.ts buildCriticalActions', pages: 'Command Center critical action strip', status: 'Live', sandbox: 'No' },
                { name: 'Stock Blocker Priority', src: 'spare_parts · stock_issues · work_orders', pages: '/spare-parts, Command Center, /logistics', status: 'Live', sandbox: 'No' },
                { name: 'Procurement Delay Priority', src: 'procurement_requests', pages: '/procurement, Command Center', status: 'Live', sandbox: 'No' },
                { name: 'Workload / Capacity', src: 'work_orders · profiles (technician scope)', pages: 'Command Center workload, /work-orders', status: 'Live', sandbox: 'No' },
                { name: 'Availability', src: 'equipment_reliability_metrics · fn_compute_availability', pages: 'Equipment detail, /reports', status: 'Snapshot', sandbox: 'No' },
                { name: 'MTBF', src: 'equipment_reliability_metrics · fn_compute_mtbf', pages: 'Equipment detail, /reports', status: 'Snapshot', sandbox: 'No' },
                { name: 'MTTR', src: 'equipment_reliability_metrics · fn_compute_mttr', pages: 'Equipment detail, /reports', status: 'Snapshot', sandbox: 'No' },
                { name: 'Sensitivity sandbox RPI', src: 'In-memory recompute (Developer Lab only)', pages: 'Developer Lab Sandbox tab — never operational', status: 'Sandbox only', sandbox: 'No (simulation only)' },
              ] as const).map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-medium text-[var(--foreground)]">{row.name}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{row.src}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{row.pages}</td>
                  <td className="px-3 py-2">
                    <Badge variant={row.status === 'Live' ? 'success' : row.status === 'Snapshot' ? 'info' : 'warning'}>{row.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{row.sandbox}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">
                    {row.status === 'Snapshot' ? (lastRefresh?.started_at ? new Date(String(lastRefresh.started_at)).toLocaleString() : 'No log') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          Live = computed from current operational rows on each request.
          Snapshot = read from a precomputed table refreshed via the snapshot tools below.
          Sandbox only = Developer Lab simulation that never writes to operational tables.
        </p>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Role Demo Validation</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Linkage status for the seven Supabase Auth demo logins. Source: profiles · user_roles · roles.
            Driven by [[src/lib/rbac.ts]] capability matrix and supabase/seed/100_demo_role_users.sql.
          </p>
        </div>
        <div className="panel-surface overflow-x-auto rounded-lg">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-3 py-2">Demo Email</th>
                <th className="px-3 py-2">Profile</th>
                <th className="px-3 py-2">Auth linked</th>
                <th className="px-3 py-2">Expected role</th>
                <th className="px-3 py-2">Assigned roles</th>
                <th className="px-3 py-2">Navigation focus</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]/60">
              {DEMO_EXPECTED.map((expected) => {
                const profile = demoProfiles.find((p) => p.email === expected.email);
                const assignedRoles = (profile?.user_roles ?? []).flatMap((ur) => {
                  const r = ur.roles;
                  if (!r) return [];
                  if (Array.isArray(r)) return r.map((x) => x.name);
                  return [r.name];
                }).filter(Boolean) as string[];
                const hasExpected = assignedRoles.includes(expected.role);
                const isLinked = !!profile?.user_id;
                let status: 'ok' | 'warning' | 'critical';
                let statusLabel: string;
                if (!profile) {
                  status = 'critical';
                  statusLabel = 'Missing profile';
                } else if (!isLinked) {
                  status = 'warning';
                  statusLabel = 'Profile exists, not linked';
                } else if (!hasExpected) {
                  status = 'warning';
                  statusLabel = 'Linked, wrong role';
                } else {
                  status = 'ok';
                  statusLabel = 'Healthy';
                }
                return (
                  <tr key={expected.email}>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--foreground)]">{expected.email}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{profile?.full_name ?? '—'}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{isLinked ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{expected.role}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{assignedRoles.length > 0 ? assignedRoles.join(', ') : '—'}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{expected.nav}</td>
                    <td className="px-3 py-2">
                      <Badge variant={status === 'ok' ? 'success' : status === 'warning' ? 'warning' : 'error'}>
                        {statusLabel}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          Healthy = profile exists, linked to a Supabase Auth user, and has the expected role. Fix linkage via supabase/seed/100_demo_role_users.sql or by adjusting user_roles directly in Settings → Role Permissions.
        </p>
      </section>

      <DeveloperLabClient replacementRows={replacementRows} />

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">System Health Checks</h2>
          <p className="text-sm text-[var(--text-muted)]">Counts come from real tables/views. Missing schema support is labeled instead of simulated.</p>
        </div>
        {([
          { id: 'data', label: 'Data Integrity', description: 'Asset metadata completeness affecting all downstream scoring and reporting.' },
          { id: 'workflow', label: 'Workflow Integrity', description: 'Operational workflows (PM, calibration, stock, procurement) in a healthy execution state.' },
          { id: 'decision-support', label: 'Decision-Support Integrity', description: 'FMEA coverage, replacement evidence, and calibration history supporting scoring outputs.' },
          { id: 'security', label: 'Security / Auth Integrity', description: 'Profile and role linkage for RLS, access control, and server action authorization.' },
        ] as Array<{ id: HealthCheck['group']; label: string; description: string }>).map((group) => {
          const groupChecks = healthChecks.filter((check) => check.group === group.id);
          const criticalCount = groupChecks.filter((check) => check.severity === 'critical').length;
          const warningCount = groupChecks.filter((check) => check.severity === 'warning').length;
          return (
            <div key={group.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-[var(--foreground)]">{group.label}</h3>
                  <p className="text-sm text-[var(--text-muted)]">{group.description}</p>
                </div>
                <div className="flex gap-2">
                  {criticalCount > 0 && <Badge variant="error">{criticalCount} critical</Badge>}
                  {warningCount > 0 && <Badge variant="warning">{warningCount} warning</Badge>}
                  {criticalCount === 0 && warningCount === 0 && <Badge variant="success">Healthy</Badge>}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {groupChecks.map((check) => (
                  <Card key={check.label}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{check.label}</p>
                        <p className="mt-1 text-sm text-[var(--text-muted)]">{check.explanation}</p>
                      </div>
                      <Badge variant={variantForSeverity(check.severity)}>{check.count}</Badge>
                    </div>
                    {check.href ? (
                      <Link className="mt-3 inline-flex text-xs font-medium text-[var(--brand)] hover:underline" href={check.href}>
                        {check.actionLabel ?? 'Open Source Records'}
                      </Link>
                    ) : (
                      <span className="mt-3 inline-flex text-xs text-[var(--text-subtle)]">
                        No app-level action available
                      </span>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Thesis Defense Evidence Pack</CardTitle>
          <Beaker className="h-5 w-5 text-violet-300" />
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-[var(--text-muted)]">
            Defense / examiner evidence tools. These reports are intentionally hosted here
            (not in the operational /reports surface) so the Reports page stays focused on
            asset lifecycle, maintenance compliance, and resource workflows.
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Link href="/reports/biomedical-operations">
              <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm hover:border-[var(--brand)]/50">
                <FileDown className="mb-2 h-4 w-4 text-[var(--brand)]" />
                Biomedical Engineering Operations Report
                <p className="mt-1 text-xs text-[var(--text-muted)]">Unified executive snapshot for defense.</p>
              </div>
            </Link>
            <Link href="/reports/evaluation-demo">
              <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm hover:border-[var(--brand)]/50">
                <FileDown className="mb-2 h-4 w-4 text-[var(--brand)]" />
                Evaluation / Demo Evidence Report
                <p className="mt-1 text-xs text-[var(--text-muted)]">Capability evidence and workflow coverage.</p>
              </div>
            </Link>
            <Link href="/reports/department-readiness">
              <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm hover:border-[var(--brand)]/50">
                <FileDown className="mb-2 h-4 w-4 text-[var(--brand)]" />
                Department Readiness Report
                <p className="mt-1 text-xs text-[var(--text-muted)]">Essential asset availability per department.</p>
              </div>
            </Link>
            <Link href="/reports/decision-support-methodology">
              <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm hover:border-[var(--brand)]/50">
                <FileDown className="mb-2 h-4 w-4 text-[var(--brand)]" />
                Decision-Support Methodology Report
                <p className="mt-1 text-xs text-[var(--text-muted)]">Formulas, weights, source tables, explainability.</p>
              </div>
            </Link>
            <Link href="/reports/replacement-planning">
              <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm hover:border-[var(--brand)]/50">
                <FileDown className="mb-2 h-4 w-4 text-[var(--brand)]" />
                Export Replacement Evidence
                <p className="mt-1 text-xs text-[var(--text-muted)]">RPI rankings and lifecycle drivers.</p>
              </div>
            </Link>
            <Link href="/reports/audit-security">
              <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm hover:border-[var(--brand)]/50">
                <FileDown className="mb-2 h-4 w-4 text-[var(--brand)]" />
                Audit / Security Evidence
                <p className="mt-1 text-xs text-[var(--text-muted)]">Governance and high-risk event log.</p>
              </div>
            </Link>
          </div>
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
            Demo reset is intentionally disabled until a safe reset migration/script exists.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
