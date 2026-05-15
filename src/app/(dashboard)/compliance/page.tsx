import Link from 'next/link';
import { AlertCircle, Calendar, CalendarCheck, CheckCircle2, Clock, Gauge, ShieldAlert, XCircle } from 'lucide-react';
import { requireRole } from '@/lib/auth/helpers';
import { createClient } from '@/lib/supabase/server';
import DepartmentComplianceStatus from './_components/DepartmentComplianceStatus';
import { detectDepartmentRoleType } from '@/utils/department/department-scope';
import {
  fetchDepartmentMetrics,
  fetchDepartmentOverduePm,
  fetchDepartmentOverdueCalibration,
  fetchDepartmentName,
} from '@/utils/department/department-metrics';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import {
  viewerEquipmentDetail,
  viewerPMScheduleEvidence,
  viewerReport,
} from '@/utils/viewer/evidence-links';

// Compliance Overview combines PM and Calibration evidence into a single
// read-only management view. Data comes from the canonical operational tables
// and views — pm_schedules, pm_compliance_metrics, calibration_records,
// v_calibration_due, v_overdue_pm — so the numbers agree with /pm, /calibration,
// and the Reports module.
//
// This route is Viewer-first but also accessible to Developer/Admin/BME Head.

interface PMScheduleRow {
  id: string;
  status: string | null;
  scheduled_date: string | null;
  asset_id: string | null;
  asset_name: string;
  asset_code: string;
  department_name: string;
  days_overdue: number;
}

interface CalRow {
  id: string;
  asset_id: string;
  asset_name: string;
  asset_code: string;
  department_name: string;
  criticality: string | null;
  next_due_date: string | null;
  days_overdue: number;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// Helper isolates the impure Date.now() call so the page component body stays
// pure for the react-hooks/purity rule.
function buildDateWindow() {
  const nowMs = Date.now();
  return {
    nowMs,
    todayIso: new Date(nowMs).toISOString().slice(0, 10),
    in30dIso: new Date(nowMs + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    last90dIso: new Date(nowMs - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  };
}

function ComplianceCard({ label, value, sub, icon, tone = 'info' }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; tone?: 'critical' | 'warning' | 'success' | 'info' }) {
  const tones = {
    critical: 'border-rose-500/40 bg-rose-500/5',
    warning: 'border-amber-500/40 bg-amber-500/5',
    success: 'border-emerald-500/40 bg-emerald-500/5',
    info: 'border-cyan-500/40 bg-cyan-500/5',
  };
  return (
    <div className={`flex flex-col gap-1 rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-bold leading-none text-[var(--foreground)]">{value}</span>
        <span className="rounded-md bg-[var(--surface-2)] p-2">{icon}</span>
      </div>
      <span className="text-sm font-medium text-[var(--foreground)]">{label}</span>
      {sub && <span className="text-xs leading-snug text-[var(--text-muted)]">{sub}</span>}
    </div>
  );
}

export default async function ComplianceOverviewPage() {
  const profile = await requireRole(['developer', 'admin', 'bme_head', 'viewer', 'department_head', 'department_user']);
  const supabase = await createClient();
  const { nowMs, todayIso, in30dIso, last90dIso } = buildDateWindow();

  const deptRole = detectDepartmentRoleType(profile.roleNames ?? []);
  if (deptRole) {
    const departmentId = (profile as unknown as Record<string, unknown>).department_id as string | null | undefined ?? null;
    const [deptName, deptMetrics, overduePm, overdueCal] = await Promise.all([
      fetchDepartmentName(supabase, departmentId).catch(() => null),
      fetchDepartmentMetrics(supabase, departmentId).catch(() => null),
      fetchDepartmentOverduePm(supabase, departmentId).catch(() => []),
      fetchDepartmentOverdueCalibration(supabase, departmentId).catch(() => []),
    ]);
    return (
      <DepartmentComplianceStatus
        departmentId={departmentId}
        departmentName={deptName}
        metrics={deptMetrics ?? {
          totalAssets: 0, functionalAssets: 0, needsRepairAssets: 0, nonFunctionalAssets: 0,
          underMaintenanceAssets: 0, criticalAssets: 0, criticalEquipmentDown: 0,
          readinessPercent: null, openRequests: 0, pendingRequests: 0, openWorkOrders: 0,
          criticalOpenWork: 0, overdueWork: 0, awaitingPartsWork: 0, overduePm: 0,
          overdueCalibration: 0, failedCalibration: 0, monthlyCompletedWork: 0,
          monthlyCompletedPm: 0, monthlyCompletedCalibration: 0, trainingNeeds: 0,
          unacknowledgedAlerts: 0,
        }}
        overduePm={overduePm}
        overdueCalibration={overdueCal}
      />
    );
  }

  const [pmRecentRes, pmOverdueRes, calRes, pmComplianceRes] = await Promise.all([
    supabase
      .from('pm_schedules')
      .select('id, status, scheduled_date, department_id, equipment_assets(department_id, departments(name))')
      .gte('scheduled_date', last90dIso)
      .lte('scheduled_date', todayIso)
      .limit(2000),
    supabase
      .from('v_overdue_pm')
      .select('id, scheduled_date, asset_id, equipment_assets(asset_code, name, departments(name))')
      .limit(500),
    supabase
      .from('v_calibration_due')
      .select('id, asset_id, next_due_date, equipment_assets(asset_code, name, departments(name), equipment_categories(criticality_level))')
      .limit(500),
    supabase
      .from('pm_compliance_metrics')
      .select('department_id, departments(name), completion_rate, scheduled_count, completed_count')
      .order('completion_rate', { ascending: true })
      .limit(50),
  ]);

  const pmRecent = (pmRecentRes.data ?? []) as Array<{ status: string | null; scheduled_date: string | null; department_id: string | null; equipment_assets?: { department_id?: string; departments?: { name?: string } | { name?: string }[] | null } | { department_id?: string; departments?: { name?: string } | { name?: string }[] | null }[] | null }>;
  const pmCompletedCount = pmRecent.filter((p) => (p.status ?? '').toLowerCase() === 'completed').length;
  const pmDeferredCount = pmRecent.filter((p) => ['deferred', 'skipped'].includes((p.status ?? '').toLowerCase())).length;
  const pmCompliancePercent = pmRecent.length > 0 ? Math.round((pmCompletedCount / pmRecent.length) * 100) : null;

  const overduePmRows: PMScheduleRow[] = ((pmOverdueRes.data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const eq = firstRelation(r.equipment_assets as Record<string, unknown> | Record<string, unknown>[] | null);
    const dept = firstRelation((eq as Record<string, unknown> | null)?.departments as Record<string, unknown> | Record<string, unknown>[] | null);
    const sched = r.scheduled_date as string | null;
    const overdueDays = sched ? Math.floor((nowMs - new Date(sched).getTime()) / (1000 * 60 * 60 * 24)) : 0;
    return {
      id: r.id as string,
      status: 'overdue',
      scheduled_date: sched,
      asset_id: (r.asset_id as string | null) ?? null,
      asset_name: ((eq as Record<string, unknown> | null)?.name as string | undefined) ?? 'Unknown',
      asset_code: ((eq as Record<string, unknown> | null)?.asset_code as string | undefined) ?? '—',
      department_name: ((dept as Record<string, unknown> | null)?.name as string | undefined) ?? 'Unknown',
      days_overdue: overdueDays,
    };
  });

  const calRows: CalRow[] = ((calRes.data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const eq = firstRelation(r.equipment_assets as Record<string, unknown> | Record<string, unknown>[] | null);
    const dept = firstRelation((eq as Record<string, unknown> | null)?.departments as Record<string, unknown> | Record<string, unknown>[] | null);
    const cat = firstRelation((eq as Record<string, unknown> | null)?.equipment_categories as Record<string, unknown> | Record<string, unknown>[] | null);
    const due = r.next_due_date as string | null;
    const overdueDays = due && due < todayIso ? Math.floor((nowMs - new Date(due).getTime()) / (1000 * 60 * 60 * 24)) : 0;
    return {
      id: r.id as string,
      asset_id: r.asset_id as string,
      asset_name: ((eq as Record<string, unknown> | null)?.name as string | undefined) ?? 'Unknown',
      asset_code: ((eq as Record<string, unknown> | null)?.asset_code as string | undefined) ?? '—',
      department_name: ((dept as Record<string, unknown> | null)?.name as string | undefined) ?? 'Unknown',
      criticality: ((cat as Record<string, unknown> | null)?.criticality_level as string | undefined) ?? null,
      next_due_date: due,
      days_overdue: overdueDays,
    };
  });

  const calibrationOverdue = calRows.filter((c) => c.days_overdue > 0).sort((a, b) => b.days_overdue - a.days_overdue);
  const calibrationDueSoon = calRows.filter((c) => c.next_due_date && c.next_due_date >= todayIso && c.next_due_date <= in30dIso).length;
  const criticalCalibrationOverdue = calibrationOverdue.filter((c) => c.criticality === 'critical' || c.criticality === 'high').length;

  const deptCompliance = ((pmComplianceRes.data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const dept = firstRelation(r.departments as Record<string, unknown> | Record<string, unknown>[] | null);
    return {
      departmentId: r.department_id as string,
      departmentName: ((dept as Record<string, unknown> | null)?.name as string | undefined) ?? 'Unknown',
      completionRate: r.completion_rate === null ? null : Math.round(Number(r.completion_rate)),
      scheduledCount: Number(r.scheduled_count ?? 0),
      completedCount: Number(r.completed_count ?? 0),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Overview"
        description="Read-only management view combining Preventive Maintenance and Calibration evidence."
        breadcrumbs={[{ label: 'Command Center', href: '/command' }, { label: 'Compliance Overview' }]}
        actions={<Badge variant="default">Read-only view</Badge>}
      />

      {/* Compliance cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <ComplianceCard label="PM Compliance" value={pmCompliancePercent === null ? 'N/A' : `${pmCompliancePercent}%`} sub="Completed / scheduled (rolling 90d). Skipped/deferred not counted as completed." icon={<CalendarCheck className="h-5 w-5 text-emerald-300" />} tone={pmCompliancePercent === null ? 'info' : pmCompliancePercent >= 80 ? 'success' : pmCompliancePercent >= 60 ? 'warning' : 'critical'} />
        <ComplianceCard label="Overdue PM" value={overduePmRows.length} sub="From v_overdue_pm." icon={<AlertCircle className="h-5 w-5 text-rose-300" />} tone={overduePmRows.length > 0 ? 'warning' : 'success'} />
        <ComplianceCard label="Deferred / Skipped PM" value={pmDeferredCount} sub="In last 90 days." icon={<XCircle className="h-5 w-5 text-amber-300" />} tone={pmDeferredCount > 0 ? 'warning' : 'info'} />
        <ComplianceCard label="Calibration Due Soon" value={calibrationDueSoon} sub="Due in next 30 days." icon={<Calendar className="h-5 w-5 text-cyan-300" />} tone={calibrationDueSoon > 0 ? 'info' : 'success'} />
        <ComplianceCard label="Calibration Overdue" value={calibrationOverdue.length} sub="From v_calibration_due." icon={<Gauge className="h-5 w-5 text-rose-300" />} tone={calibrationOverdue.length > 0 ? 'warning' : 'success'} />
        <ComplianceCard label="Critical Calibration Overdue" value={criticalCalibrationOverdue} sub="On essential (high/critical) assets." icon={<ShieldAlert className="h-5 w-5 text-rose-300" />} tone={criticalCalibrationOverdue > 0 ? 'critical' : 'success'} />
        <ComplianceCard label="PM Completed (90d)" value={pmCompletedCount} icon={<CheckCircle2 className="h-5 w-5 text-emerald-300" />} tone="success" />
      </div>

      {/* Department compliance summary */}
      <Card>
        <CardHeader>
          <CardTitle>Department PM Compliance</CardTitle>
        </CardHeader>
        <CardContent>
          {deptCompliance.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">No PM compliance metrics available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[560px] w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Department</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Completion Rate</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Scheduled</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Completed</th>
                    <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]/60">
                  {deptCompliance.map((d) => (
                    <tr key={d.departmentId}>
                      <td className="py-3 pr-4 font-medium text-[var(--foreground)]">{d.departmentName}</td>
                      <td className="py-3 pr-4">
                        {d.completionRate === null ? (
                          <span className="text-xs text-[var(--text-muted)]">Not available</span>
                        ) : (
                          <Badge variant={d.completionRate >= 80 ? 'success' : d.completionRate >= 60 ? 'warning' : 'error'}>{d.completionRate}%</Badge>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{d.scheduledCount}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{d.completedCount}</td>
                      <td className="py-3">
                        <Link href={`/reports/pm-compliance?department=${encodeURIComponent(d.departmentId)}`} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View PM Evidence</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Overdue PM evidence */}
      <Card>
        <CardHeader>
          <CardTitle>Overdue PM Evidence</CardTitle>
        </CardHeader>
        <CardContent>
          {overduePmRows.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">No overdue PM tasks.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[640px] w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Department</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Scheduled date</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Days overdue</th>
                    <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]/60">
                  {overduePmRows.slice(0, 25).map((p) => (
                    <tr key={p.id}>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-[var(--foreground)]">{p.asset_name}</p>
                        <p className="text-xs text-[var(--text-muted)]">{p.asset_code}</p>
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{p.department_name}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{p.scheduled_date ?? '—'}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]"><Badge variant={p.days_overdue > 30 ? 'error' : 'warning'}>{p.days_overdue}</Badge></td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Link href={viewerPMScheduleEvidence(p.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View PM Evidence</Link>
                          {p.asset_id && <Link href={viewerEquipmentDetail(p.asset_id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Asset Profile</Link>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Calibration overdue evidence */}
      <Card>
        <CardHeader>
          <CardTitle>Calibration Overdue Evidence</CardTitle>
        </CardHeader>
        <CardContent>
          {calibrationOverdue.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">No overdue calibration.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[720px] w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Department</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Criticality</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Next due</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Days overdue</th>
                    <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]/60">
                  {calibrationOverdue.slice(0, 25).map((c) => (
                    <tr key={c.id}>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-[var(--foreground)]">{c.asset_name}</p>
                        <p className="text-xs text-[var(--text-muted)]">{c.asset_code}</p>
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{c.department_name}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{c.criticality ?? '—'}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{c.next_due_date ?? '—'}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]"><Badge variant={c.days_overdue > 30 ? 'error' : 'warning'}>{c.days_overdue}</Badge></td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Link href={viewerEquipmentDetail(c.asset_id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Calibration Evidence</Link>
                          <Link href={viewerReport('calibration-compliance')} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Open Compliance Report</Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Critical Compliance Exceptions */}
      <Card>
        <CardHeader>
          <CardTitle>Critical Compliance Exceptions</CardTitle>
        </CardHeader>
        <CardContent>
          {criticalCalibrationOverdue === 0 && overduePmRows.filter((p) => p.days_overdue > 30).length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">No critical compliance exceptions.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {criticalCalibrationOverdue > 0 && (
                <li className="flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 p-3">
                  <ShieldAlert className="mt-0.5 h-4 w-4 text-rose-300" />
                  <span>
                    <b>{criticalCalibrationOverdue}</b> critical/high asset calibration{criticalCalibrationOverdue !== 1 ? 's' : ''} overdue. Safety follow-up required.
                  </span>
                </li>
              )}
              {overduePmRows.filter((p) => p.days_overdue > 30).length > 0 && (
                <li className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                  <Clock className="mt-0.5 h-4 w-4 text-amber-300" />
                  <span>
                    <b>{overduePmRows.filter((p) => p.days_overdue > 30).length}</b> PM task{overduePmRows.filter((p) => p.days_overdue > 30).length !== 1 ? 's' : ''} overdue by more than 30 days.
                  </span>
                </li>
              )}
            </ul>
          )}
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Source: <code>v_overdue_pm</code>, <code>v_calibration_due</code>, <code>pm_compliance_metrics</code>. PM Compliance is computed as completed scheduled PM tasks ÷ total scheduled PM tasks. Skipped/deferred are tracked separately and do not count as completed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
