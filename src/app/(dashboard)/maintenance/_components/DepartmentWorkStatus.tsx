'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Clock, Package, ShieldAlert, TrendingUp, Wrench } from 'lucide-react';
import { PageHeader, Badge, StatCard } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { createClient } from '@/lib/supabase/client';
import { MISSING_DEPARTMENT_MESSAGE } from '@/utils/department/department-scope';
import { deptEquipmentDetail, deptWorkOrderEvidence } from '@/utils/department/department-evidence-links';

// work_orders has no scheduled_date. Age from created_at is used as a proxy.
const AGING_THRESHOLD_DAYS = 14;

// Uses direct columns exposed by v_open_work_orders (migration 00044 adds asset_id,
// department_id). No nested FK queries; assigned_to_name is in the view directly.
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
  assigned_to_name: string | null;
}

interface CompletedWO { id: string; completed_at: string | null }

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export default function DepartmentWorkStatus() {
  const { user } = useAuth();
  const { profile, loading: profileLoading } = useProfile(user?.id);
  const departmentId = (profile as unknown as Record<string, unknown>)?.department_id as string | null ?? null;
  const [loading, setLoading] = useState(true);
  const [openWO, setOpenWO] = useState<OpenWO[]>([]);
  const [completedThisMonth, setCompletedThisMonth] = useState<CompletedWO[]>([]);

  useEffect(() => {
    if (profileLoading) return;
    if (!departmentId) return;
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const monthStart = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1).toISOString().slice(0, 10);
      const [openRes, completedRes] = await Promise.all([
        // Direct view columns only — v_open_work_orders exposes asset_id and
        // department_id after migration 00044. No nested FK queries needed.
        supabase
          .from('v_open_work_orders')
          .select('id, work_order_number, priority, status, created_at, asset_id, asset_name, asset_code, department_name, assigned_to_name, department_id')
          .eq('department_id', departmentId)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('work_orders')
          .select('id, completed_at, equipment_assets!inner(department_id)')
          .eq('status', 'completed')
          .gte('completed_at', monthStart)
          .eq('equipment_assets.department_id', departmentId)
          .limit(500),
      ]);
      if (cancelled) return;
      const rows: OpenWO[] = ((openRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        work_order_number: (r.work_order_number as string | null) ?? null,
        priority: (r.priority as string | null) ?? null,
        status: (r.status as string | null) ?? null,
        created_at: (r.created_at as string | null) ?? null,
        asset_id: (r.asset_id as string | null) ?? null,
        asset_name: (r.asset_name as string | undefined) ?? 'Unknown',
        asset_code: (r.asset_code as string | undefined) ?? '—',
        department_name: (r.department_name as string | undefined) ?? 'Unknown',
        assigned_to_name: (r.assigned_to_name as string | null) ?? null,
      }));
      setOpenWO(rows);
      setCompletedThisMonth((completedRes.data ?? []) as CompletedWO[]);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [departmentId, profileLoading]);

  const stats = useMemo(() => {
    let inProgress = 0, awaitingParts = 0, aging = 0, critical = 0;
    for (const wo of openWO) {
      if (wo.status === 'in_progress') inProgress++;
      if (wo.status === 'on_hold') awaitingParts++;
      const age = daysAgo(wo.created_at) ?? 0;
      if (age >= AGING_THRESHOLD_DAYS) aging++;
      const p = (wo.priority ?? '').toLowerCase();
      if (p === 'critical' || p === 'high') critical++;
    }
    return { open: openWO.length, inProgress, awaitingParts, aging, critical, completed: completedThisMonth.length };
  }, [openWO, completedThisMonth]);

  if (profileLoading) return <PageLoader />;
  if (!departmentId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Department Work Status" description="" />
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-6">
          <p className="font-medium text-[var(--foreground)]">No department linked</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{MISSING_DEPARTMENT_MESSAGE}</p>
        </div>
      </div>
    );
  }
  if (loading) return <PageLoader />;

  const deptName = openWO[0]?.department_name ?? 'your department';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Department Work Status"
        description={`Maintenance work affecting equipment in ${deptName}. Read-only view — BME owns execution.`}
        breadcrumbs={[{ label: 'Department Dashboard', href: '/command' }, { label: 'Work Status' }]}
        actions={<Badge variant="info">Department view</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Open Work" value={stats.open} icon={<Wrench className="h-5 w-5" />} color="blue" />
        <StatCard label="In Progress" value={stats.inProgress} icon={<TrendingUp className="h-5 w-5" />} color="purple" />
        <StatCard label="Awaiting Parts" value={stats.awaitingParts} icon={<Package className="h-5 w-5" />} color="orange" />
        <StatCard label={`Aging (>${AGING_THRESHOLD_DAYS}d)`} value={stats.aging} icon={<AlertCircle className="h-5 w-5" />} color="red" />
        <StatCard label="Completed This Month" value={stats.completed} icon={<CheckCircle2 className="h-5 w-5" />} color="green" />
        <StatCard label="Critical Equipment Work" value={stats.critical} icon={<ShieldAlert className="h-5 w-5" />} color="red" />
      </div>

      <div className="panel-surface overflow-x-auto rounded-xl">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="border-b border-[var(--border-subtle)]/60">
            <tr className="text-left">
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Work Order</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Asset</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Priority</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">BME Status</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Technician</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Opened</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Age</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]/60">
            {openWO.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">No open work orders for this department.</td></tr>
            ) : openWO.slice(0, 100).map((wo) => {
              const age = daysAgo(wo.created_at);
              return (
                <tr key={wo.id}>
                  <td className="px-4 py-3 font-medium text-[var(--foreground)]">{wo.work_order_number ?? `WO ${wo.id.slice(0, 8)}`}</td>
                  <td className="px-4 py-3">
                    <p className="text-[var(--foreground)]">{wo.asset_name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{wo.asset_code}</p>
                  </td>
                  <td className="px-4 py-3"><Badge variant={wo.priority === 'critical' ? 'error' : wo.priority === 'high' ? 'warning' : 'default'}>{wo.priority ?? '—'}</Badge></td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{wo.status}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{wo.assigned_to_name ?? 'Unassigned'}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{wo.created_at?.slice(0, 10) ?? '—'}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{age !== null ? `${age}d` : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Link href={deptWorkOrderEvidence(wo.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Work Evidence</Link>
                      {wo.asset_id && <Link href={deptEquipmentDetail(wo.asset_id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Asset Profile</Link>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Assign / Reassign / Start / Complete / Add Event / Resolve / Cancel are BME / technician actions and are not visible here. To request additional service, use{' '}
        <Link href="/requests" className="text-violet-300 hover:text-violet-200">Submit and Track Requests</Link>.
      </p>
      <span className="hidden"><Clock className="h-4 w-4" /></span>
    </div>
  );
}
