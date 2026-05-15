'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Clock, ShieldAlert, TrendingUp, Wrench,
} from 'lucide-react';
import { PageHeader, Badge } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { BarChart, DoughnutChart, ChartCard } from '@/components/charts';
import { createClient } from '@/lib/supabase/client';
import {
  viewerEquipmentDetail,
  viewerWorkOrderEvidence,
  viewerReport,
} from '@/utils/viewer/evidence-links';

// work_orders has no scheduled_date column. "Aging" (open > 14 days) is used
// as the operational proxy for overdue work.
const AGING_THRESHOLD_DAYS = 14;

interface OpenWO {
  id: string;
  work_order_number: string | null;
  priority: string | null;
  status: string | null;
  created_at: string | null;
  asset_id: string | null;
  asset_name: string;
  asset_code: string;
  department_name: string;
}

interface CompletedWO {
  id: string;
  completed_at: string | null;
  repair_duration_hours: number | null;
}

interface RecurringFailureRow {
  id: string;
  asset_id: string;
  asset_name: string;
  asset_code: string;
  department_name: string;
  count: number;
}

interface DeptBacklogRow {
  departmentId: string;
  departmentName: string;
  openWork: number;
  criticalOpenWork: number;
  onHold: number;
  averageAgeDays: number | null;
}

const COLOR_MAP: Record<string, string> = {
  blue: 'bg-blue-500/15 text-blue-400',
  green: 'bg-emerald-500/15 text-emerald-400',
  yellow: 'bg-amber-500/15 text-amber-400',
  red: 'bg-rose-500/15 text-rose-400',
  purple: 'bg-violet-500/15 text-violet-400',
  orange: 'bg-orange-500/15 text-orange-400',
};

function SummaryCard({ label, value, icon, color = 'blue', sub }: { label: string; value: number | string; icon: React.ReactNode; color?: string; sub?: string }) {
  return (
    <div className="panel-surface flex flex-col gap-1 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-bold leading-none text-[var(--foreground)]">{value}</span>
        <span className={`rounded-lg p-1.5 ${COLOR_MAP[color] ?? COLOR_MAP.blue}`}>{icon}</span>
      </div>
      <span className="text-xs font-medium leading-tight text-[var(--text-muted)]">{label}</span>
      {sub && <span className="text-[10px] leading-tight text-[var(--text-subtle)]">{sub}</span>}
    </div>
  );
}

function daysBetween(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export default function ViewerMaintenanceOverview() {
  const [loading, setLoading] = useState(true);
  const [openWOs, setOpenWOs] = useState<OpenWO[]>([]);
  const [completedThisMonth, setCompletedThisMonth] = useState<CompletedWO[]>([]);
  const [recurringFailures, setRecurringFailures] = useState<RecurringFailureRow[]>([]);
  const [completionTrend, setCompletionTrend] = useState<{ labels: string[]; values: number[] }>({ labels: [], values: [] });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const monthStart = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1).toISOString().slice(0, 10);
      const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      // Use direct view columns (asset_id, asset_name, asset_code, department_name now
      // exposed via migration 00044). No nested FK queries to avoid Supabase type conflicts.
      const [openRes, completedRes, recurringRes, trendRes] = await Promise.all([
        supabase
          .from('v_open_work_orders')
          .select('id, work_order_number, priority, status, created_at, asset_id, asset_name, asset_code, department_name')
          .limit(2000),
        supabase
          .from('work_orders')
          .select('id, completed_at, repair_duration_hours')
          .eq('status', 'completed')
          .gte('completed_at', monthStart)
          .limit(2000),
        supabase
          .from('recommendation_flags')
          .select('id, asset_id, details, equipment_assets(asset_code, name, departments(name))')
          .eq('flag_type', 'recurring_failure')
          .eq('is_acknowledged', false)
          .limit(500),
        supabase
          .from('work_orders')
          .select('id, completed_at')
          .eq('status', 'completed')
          .gte('completed_at', sixMonthsAgo)
          .limit(5000),
      ]);
      if (cancelled) return;

      const open: OpenWO[] = ((openRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        work_order_number: (r.work_order_number as string | null) ?? null,
        priority: (r.priority as string | null) ?? null,
        status: (r.status as string | null) ?? null,
        created_at: (r.created_at as string | null) ?? null,
        asset_id: (r.asset_id as string | null) ?? null,
        asset_name: (r.asset_name as string | undefined) ?? 'Unknown',
        asset_code: (r.asset_code as string | undefined) ?? '—',
        department_name: (r.department_name as string | undefined) ?? 'Unknown',
      }));
      setOpenWOs(open);

      setCompletedThisMonth((completedRes.data ?? []) as CompletedWO[]);

      const recurring: RecurringFailureRow[] = ((recurringRes.data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const eqRel = Array.isArray(r.equipment_assets) ? (r.equipment_assets as unknown[])[0] as Record<string, unknown> : r.equipment_assets as Record<string, unknown> | null;
        const deptRel = eqRel?.departments;
        const dept = Array.isArray(deptRel) ? (deptRel as unknown[])[0] as Record<string, unknown> | null : deptRel as Record<string, unknown> | null;
        const details = (r.details as Record<string, unknown> | null) ?? null;
        const count = Number(details?.failure_count ?? details?.count ?? 0);
        return {
          id: r.id as string,
          asset_id: r.asset_id as string,
          asset_name: (eqRel?.name as string | undefined) ?? 'Unknown',
          asset_code: (eqRel?.asset_code as string | undefined) ?? '—',
          department_name: (dept?.name as string | undefined) ?? 'Unknown',
          count,
        };
      });
      setRecurringFailures(recurring);

      const buckets = new Map<string, number>();
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setUTCMonth(d.getUTCMonth() - i);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        buckets.set(key, 0);
      }
      for (const wo of (trendRes.data ?? []) as Array<{ completed_at: string | null }>) {
        if (!wo.completed_at) continue;
        const d = new Date(wo.completed_at);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      setCompletionTrend({
        labels: Array.from(buckets.keys()),
        values: Array.from(buckets.values()),
      });

      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => {
    let critical = 0, aging = 0, onHold = 0;
    for (const wo of openWOs) {
      const p = (wo.priority ?? '').toLowerCase();
      if (p === 'critical' || p === 'high') critical++;
      const age = daysBetween(wo.created_at) ?? 0;
      if (age >= AGING_THRESHOLD_DAYS) aging++;
      if (wo.status === 'on_hold') onHold++;
    }
    const totalDuration = completedThisMonth.reduce((acc, w) => acc + (Number(w.repair_duration_hours ?? 0) || 0), 0);
    const validDurations = completedThisMonth.filter((w) => Number(w.repair_duration_hours ?? 0) > 0).length;
    const avgRepair = validDurations > 0 ? Math.round((totalDuration / validDurations) * 10) / 10 : null;
    return {
      openWO: openWOs.length,
      critical,
      aging,
      onHold,
      completed: completedThisMonth.length,
      avgRepair,
      recurring: recurringFailures.length,
    };
  }, [openWOs, completedThisMonth, recurringFailures]);

  const statusChart = useMemo(() => {
    const map = new Map<string, number>();
    for (const wo of openWOs) {
      map.set(wo.status ?? 'unknown', (map.get(wo.status ?? 'unknown') ?? 0) + 1);
    }
    const entries = Array.from(map.entries());
    return { labels: entries.map(([k]) => k), values: entries.map(([, v]) => v) };
  }, [openWOs]);

  const deptChart = useMemo(() => {
    const map = new Map<string, number>();
    for (const wo of openWOs) map.set(wo.department_name, (map.get(wo.department_name) ?? 0) + 1);
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    return { labels: entries.map(([k]) => k), values: entries.map(([, v]) => v) };
  }, [openWOs]);

  // Aging critical/high work: open > AGING_THRESHOLD_DAYS or already very old.
  const agingCritical = useMemo(() => {
    return openWOs
      .filter((wo) => {
        const p = (wo.priority ?? '').toLowerCase();
        if (p !== 'critical' && p !== 'high') return false;
        const age = daysBetween(wo.created_at) ?? 0;
        return age >= AGING_THRESHOLD_DAYS;
      })
      .sort((a, b) => (daysBetween(b.created_at) ?? 0) - (daysBetween(a.created_at) ?? 0))
      .slice(0, 15);
  }, [openWOs]);

  const deptBacklog: DeptBacklogRow[] = useMemo(() => {
    const map = new Map<string, DeptBacklogRow>();
    for (const wo of openWOs) {
      const key = wo.department_name;
      const existing = map.get(key) ?? {
        departmentId: key,
        departmentName: key,
        openWork: 0,
        criticalOpenWork: 0,
        onHold: 0,
        averageAgeDays: 0,
      };
      existing.openWork++;
      const p = (wo.priority ?? '').toLowerCase();
      if (p === 'critical' || p === 'high') existing.criticalOpenWork++;
      if (wo.status === 'on_hold') existing.onHold++;
      const age = daysBetween(wo.created_at) ?? 0;
      existing.averageAgeDays = (existing.averageAgeDays ?? 0) + age;
      map.set(key, existing);
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, averageAgeDays: r.openWork > 0 ? Math.round((r.averageAgeDays ?? 0) / r.openWork) : null }))
      .sort((a, b) => b.openWork - a.openWork);
  }, [openWOs]);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance Overview"
        description="Read-only view of corrective maintenance activity. Row actions open evidence — no workflow initiation."
        breadcrumbs={[{ label: 'Command Center', href: '/command' }, { label: 'Maintenance Overview' }]}
        actions={<Badge variant="default">Read-only view</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <SummaryCard label="Open Work Orders" value={stats.openWO} icon={<Wrench className="h-4 w-4" />} color="blue" />
        <SummaryCard label="Critical/High Active" value={stats.critical} icon={<ShieldAlert className="h-4 w-4" />} color="red" />
        <SummaryCard label="Aging Work (>14d)" value={stats.aging} icon={<AlertTriangle className="h-4 w-4" />} color="orange" sub="open without resolution > 14 days" />
        <SummaryCard label="On Hold" value={stats.onHold} icon={<Clock className="h-4 w-4" />} color="yellow" />
        <SummaryCard label="Completed This Month" value={stats.completed} icon={<CheckCircle2 className="h-4 w-4" />} color="green" />
        <SummaryCard label="Avg Repair Time (h)" value={stats.avgRepair === null ? 'N/A' : stats.avgRepair} icon={<TrendingUp className="h-4 w-4" />} color="purple" sub="from completed WOs this month" />
        <SummaryCard label="Recurring Failure Flags" value={stats.recurring} icon={<AlertCircle className="h-4 w-4" />} color="red" sub="unacknowledged" />
        <SummaryCard label="Departments Active" value={deptBacklog.length} icon={<Wrench className="h-4 w-4" />} color="blue" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Open Work Orders by Status">
          {statusChart.labels.length > 0 ? <DoughnutChart labels={statusChart.labels} data={statusChart.values} /> : <p className="py-6 text-center text-sm text-[var(--text-muted)]">No data.</p>}
        </ChartCard>
        <ChartCard title="Open Work Orders by Department">
          {deptChart.labels.length > 0 ? <BarChart labels={deptChart.labels} datasets={[{ label: 'Open WOs', data: deptChart.values }]} /> : <p className="py-6 text-center text-sm text-[var(--text-muted)]">No data.</p>}
        </ChartCard>
        <ChartCard title="Completion Trend — Last 6 Months">
          {completionTrend.labels.length > 0 ? <BarChart labels={completionTrend.labels} datasets={[{ label: 'Completed', data: completionTrend.values }]} /> : <p className="py-6 text-center text-sm text-[var(--text-muted)]">No data.</p>}
        </ChartCard>
        <ChartCard title="Critical Work Aging">
          {(() => {
            const buckets = { '0–3 days': 0, '4–7 days': 0, '8–30 days': 0, '> 30 days': 0 };
            for (const wo of openWOs.filter((w) => { const p = (w.priority ?? '').toLowerCase(); return p === 'critical' || p === 'high'; })) {
              const age = daysBetween(wo.created_at) ?? 0;
              if (age <= 3) buckets['0–3 days']++;
              else if (age <= 7) buckets['4–7 days']++;
              else if (age <= 30) buckets['8–30 days']++;
              else buckets['> 30 days']++;
            }
            return <BarChart labels={Object.keys(buckets)} datasets={[{ label: 'Items', data: Object.values(buckets) }]} />;
          })()}
        </ChartCard>
      </div>

      {/* Aging Critical Work */}
      <div className="panel-surface rounded-xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">Aging Critical/High Work</h2>
            <p className="text-xs text-[var(--text-muted)]">Critical or high priority work orders open &gt; {AGING_THRESHOLD_DAYS} days. No scheduled_date on work orders — age from creation date.</p>
          </div>
          <Link href={viewerReport('work-orders')} className="text-xs text-violet-300 hover:text-violet-200">Open Maintenance Report →</Link>
        </div>
        {agingCritical.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--text-muted)]">No aging critical/high work orders.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[820px] w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Work / Asset</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Department</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Priority</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Age (days)</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Status</th>
                  <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]/60">
                {agingCritical.map((wo) => {
                  const age = daysBetween(wo.created_at);
                  return (
                    <tr key={wo.id}>
                      <td className="py-3 pr-4">
                        <Link href={viewerWorkOrderEvidence(wo.id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                          {wo.work_order_number ?? `WO ${wo.id.slice(0, 8)}`}
                        </Link>
                        <p className="text-xs text-[var(--text-muted)]">{wo.asset_name} · {wo.asset_code}</p>
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{wo.department_name}</td>
                      <td className="py-3 pr-4"><Badge variant={wo.priority === 'critical' ? 'error' : 'warning'}>{wo.priority}</Badge></td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{age !== null ? `${age}d` : '—'}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{wo.status}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Link href={viewerWorkOrderEvidence(wo.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Work Evidence</Link>
                          {wo.asset_id && (
                            <Link href={viewerEquipmentDetail(wo.asset_id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Asset Profile</Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recurring Failures */}
      <div className="panel-surface rounded-xl p-5">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Recurring Failure Assets</h2>
          <p className="text-xs text-[var(--text-muted)]">Assets flagged with repeated corrective failures (failure_count ≥ 4).</p>
        </div>
        {recurringFailures.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--text-muted)]">No recurring failure flags currently active.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[640px] w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Department</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Failure count</th>
                  <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]/60">
                {recurringFailures.map((rf) => (
                  <tr key={rf.id}>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-[var(--foreground)]">{rf.asset_name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{rf.asset_code}</p>
                    </td>
                    <td className="py-3 pr-4 text-[var(--text-muted)]">{rf.department_name}</td>
                    <td className="py-3 pr-4 text-[var(--text-muted)]">{rf.count || '—'}</td>
                    <td className="py-3">
                      <Link href={viewerEquipmentDetail(rf.asset_id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Maintenance History</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Department backlog */}
      <div className="panel-surface rounded-xl p-5">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Department Maintenance Backlog</h2>
          <p className="text-xs text-[var(--text-muted)]">Open work orders summarized by department.</p>
        </div>
        {deptBacklog.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--text-muted)]">No open maintenance backlog.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[640px] w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Department</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Open Work</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Critical/High</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">On Hold</th>
                  <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Avg age (days)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]/60">
                {deptBacklog.map((d) => (
                  <tr key={d.departmentName}>
                    <td className="py-3 pr-4 font-medium text-[var(--foreground)]">{d.departmentName}</td>
                    <td className="py-3 pr-4 text-[var(--text-muted)]">{d.openWork}</td>
                    <td className="py-3 pr-4 text-[var(--text-muted)]">{d.criticalOpenWork}</td>
                    <td className="py-3 pr-4 text-[var(--text-muted)]">{d.onHold}</td>
                    <td className="py-3 text-[var(--text-muted)]">{d.averageAgeDays ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
