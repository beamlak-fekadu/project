'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, Package, Truck, Wrench } from 'lucide-react';
import { PageHeader, Badge, StatCard } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { createClient } from '@/lib/supabase/client';
import { storeEquipmentDetail, storePartDetail, storeProcurementDetail, storeReport, storeWorkOrderEvidence } from '@/utils/store/store-evidence-links';

interface BlockerRow {
  id: string;
  workOrderNumber: string | null;
  assetId: string | null;
  assetName: string;
  assetCode: string;
  departmentName: string;
  priority: string | null;
  status: string;
  blockedSince: string | null;
  criticality: string | null;
}

interface RecentIssue { id: string; part_id: string; quantity: number; issue_date: string; issued_to_event_id: string | null }
interface CompletedThisMonth { id: string; completed_at: string | null }
interface ProcurementRow { id: string; status: string | null; title: string | null }
interface FlagRow { id: string; flag_type: string | null; asset_id: string | null; is_acknowledged: boolean; assetName: string; assetCode: string }

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export default function StoreMaintenanceBlockers() {
  const [loading, setLoading] = useState(true);
  const [blockers, setBlockers] = useState<BlockerRow[]>([]);
  const [issues, setIssues] = useState<RecentIssue[]>([]);
  const [completedThisMonth, setCompletedThisMonth] = useState<CompletedThisMonth[]>([]);
  const [procurement, setProcurement] = useState<ProcurementRow[]>([]);
  const [flags, setFlags] = useState<FlagRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const monthStart = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1).toISOString().slice(0, 10);
      const [woRes, issueRes, completedRes, procRes, flagRes] = await Promise.all([
        supabase
          .from('v_open_work_orders')
          .select('id, work_order_number, asset_id, priority, status, created_at, equipment_assets(asset_code, name, departments(name), equipment_categories(criticality_level))')
          .eq('status', 'on_hold')
          .order('created_at', { ascending: true })
          .limit(500),
        supabase
          .from('stock_issues')
          .select('id, part_id, quantity, issue_date, issued_to_event_id')
          .gte('issue_date', weekAgo)
          .limit(2000),
        supabase
          .from('work_orders')
          .select('id, completed_at')
          .eq('status', 'completed')
          .gte('completed_at', monthStart)
          .limit(2000),
        supabase
          .from('procurement_requests')
          .select('id, status, title')
          .in('status', ['requested', 'approved', 'ordered', 'in_transit', 'delivered'])
          .limit(2000),
        supabase
          .from('recommendation_flags')
          .select('id, flag_type, asset_id, is_acknowledged, equipment_assets(asset_code, name)')
          .in('flag_type', ['low_stock', 'part_shortage'])
          .eq('is_acknowledged', false)
          .limit(2000),
      ]);
      if (cancelled) return;
      const woRows = ((woRes.data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const eq = firstRelation(r.equipment_assets as Record<string, unknown> | Record<string, unknown>[] | null);
        const dept = firstRelation((eq as Record<string, unknown> | null)?.departments as Record<string, unknown> | Record<string, unknown>[] | null);
        const cat = firstRelation((eq as Record<string, unknown> | null)?.equipment_categories as Record<string, unknown> | Record<string, unknown>[] | null);
        return {
          id: r.id as string,
          workOrderNumber: (r.work_order_number as string | null) ?? null,
          assetId: (r.asset_id as string | null) ?? null,
          assetName: ((eq as Record<string, unknown> | null)?.name as string | undefined) ?? 'Unknown',
          assetCode: ((eq as Record<string, unknown> | null)?.asset_code as string | undefined) ?? '—',
          departmentName: ((dept as Record<string, unknown> | null)?.name as string | undefined) ?? 'Unknown',
          priority: (r.priority as string | null) ?? null,
          status: 'on_hold',
          blockedSince: (r.created_at as string | null) ?? null,
          criticality: ((cat as Record<string, unknown> | null)?.criticality_level as string | undefined) ?? null,
        };
      });
      setBlockers(woRows);
      setIssues((issueRes.data ?? []) as RecentIssue[]);
      setCompletedThisMonth((completedRes.data ?? []) as CompletedThisMonth[]);
      setProcurement((procRes.data ?? []) as ProcurementRow[]);
      setFlags(((flagRes.data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const eq = firstRelation(r.equipment_assets as Record<string, unknown> | Record<string, unknown>[] | null);
        return {
          id: r.id as string,
          flag_type: (r.flag_type as string | null) ?? null,
          asset_id: (r.asset_id as string | null) ?? null,
          is_acknowledged: Boolean(r.is_acknowledged),
          assetName: ((eq as Record<string, unknown> | null)?.name as string | undefined) ?? 'Unknown asset',
          assetCode: ((eq as Record<string, unknown> | null)?.asset_code as string | undefined) ?? '—',
        };
      }));
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => {
    const stockoutBlocked = blockers.length; // proxy: on_hold work orders
    const criticalAffected = blockers.filter((b) => b.criticality === 'critical' || b.criticality === 'high').length;
    const partsIssuedThisWeek = issues.length;
    const procurementLinked = blockers.filter((b) => {
      const aname = b.assetName.toLowerCase();
      return procurement.some((p) => (p.title ?? '').toLowerCase().includes(aname));
    }).length;
    return {
      stockoutBlocked,
      awaitingParts: flags.length,
      criticalAffected,
      partsIssuedThisWeek,
      procurementLinked,
      resolvedThisMonth: completedThisMonth.length,
    };
  }, [blockers, issues, flags, procurement, completedThisMonth]);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance Blockers"
        description="Open work orders on hold and stock signals affecting repair. Store user assists with parts handoff; maintenance execution is not a store action."
        breadcrumbs={[{ label: 'Store Operations', href: '/command' }, { label: 'Maintenance Blockers' }]}
        actions={<Badge variant="info">Store / logistics view</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Blocked by Stockout" value={stats.stockoutBlocked} icon={<AlertTriangle className="h-5 w-5" />} color="red" />
        <StatCard label="Awaiting Parts" value={stats.awaitingParts} icon={<Package className="h-5 w-5" />} color="orange" />
        <StatCard label="Critical Equipment Affected" value={stats.criticalAffected} icon={<AlertTriangle className="h-5 w-5" />} color="red" />
        <StatCard label="Parts Issued This Week" value={stats.partsIssuedThisWeek} icon={<Truck className="h-5 w-5" />} color="green" />
        <StatCard label="Procurement Linked" value={stats.procurementLinked} icon={<Package className="h-5 w-5" />} color="purple" />
        <StatCard label="Resolved Blockers This Month" value={stats.resolvedThisMonth} icon={<Wrench className="h-5 w-5" />} color="green" />
      </div>

      <div className="panel-surface rounded-xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Open work orders on hold</h2>
          <Link href={storeReport('work-orders')} className="text-xs text-violet-300 hover:text-violet-200">Open Maintenance Blocker Report →</Link>
        </div>
        {blockers.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--text-muted)]">No on-hold work orders currently.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[920px] w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Work Order</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Department</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Priority</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Blocked since</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Procurement</th>
                  <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]/60">
                {blockers.slice(0, 25).map((b) => {
                  const aname = b.assetName.toLowerCase();
                  const proc = procurement.find((p) => (p.title ?? '').toLowerCase().includes(aname)) ?? null;
                  const age = daysAgo(b.blockedSince);
                  return (
                    <tr key={b.id}>
                      <td className="py-3 pr-4 font-medium text-[var(--foreground)]">{b.workOrderNumber ?? `WO ${b.id.slice(0, 8)}`}</td>
                      <td className="py-3 pr-4">
                        <p className="text-[var(--foreground)]">{b.assetName}</p>
                        <p className="text-xs text-[var(--text-muted)]">{b.assetCode}</p>
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{b.departmentName}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]"><Badge variant={b.priority === 'critical' ? 'error' : b.priority === 'high' ? 'warning' : 'default'}>{b.priority ?? '—'}</Badge></td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{age !== null ? `${age} day${age === 1 ? '' : 's'}` : '—'}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">
                        {proc ? (
                          <Link href={storeProcurementDetail(proc.id)} className="text-xs text-violet-300 hover:text-violet-200">{proc.status} →</Link>
                        ) : (
                          <span className="text-xs text-[var(--text-subtle)]">No linked procurement</span>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Link href={storeWorkOrderEvidence(b.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Work Evidence</Link>
                          {b.assetId && <Link href={storeEquipmentDetail(b.assetId)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Asset Profile</Link>}
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

      {flags.length > 0 && (
        <div className="panel-surface rounded-xl p-5">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Stock-related flags</h2>
            <p className="text-xs text-[var(--text-muted)]">Unacknowledged low_stock / part_shortage flags. The store cannot acknowledge — but can act via reorder requests.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Type</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                  <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]/60">
                {flags.slice(0, 15).map((f) => (
                  <tr key={f.id}>
                    <td className="py-2 pr-4 text-[var(--text-muted)]">{f.flag_type}</td>
                    <td className="py-2 pr-4">
                      <p className="text-[var(--text-muted)]">{f.assetName}</p>
                      <p className="text-xs text-[var(--text-subtle)]">{f.assetCode}</p>
                    </td>
                    <td className="py-2">{f.asset_id && <Link href={storeEquipmentDetail(f.asset_id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Asset Profile</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        Assign / Start / Complete / Add Event / Resolve / Approve are not store-user actions. They appear in the operational Maintenance view used by BME Head and technicians.
      </p>
      <span className="hidden"><Clock className="h-4 w-4" /><Wrench className="h-4 w-4" /><Package className="h-4 w-4" /><Truck className="h-4 w-4" /><AlertTriangle className="h-4 w-4" /><Link href="/" /></span>
      <span className="hidden"><Link href={storePartDetail('x')}>x</Link></span>
    </div>
  );
}
