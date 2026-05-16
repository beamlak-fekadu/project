'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, Monitor, ShieldAlert, TrendingUp, Wrench } from 'lucide-react';
import { PageHeader, Badge } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { getEquipmentList } from '@/services/equipment.service';
import { getOpenMaintenanceRequests, getOpenWorkOrders } from '@/services/maintenance.service';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  formatCacheAge,
  getOfflineReadCache,
  saveOfflineReadCache,
  type OfflineCacheScope,
} from '@/lib/offline/cache';
import { CloudOff } from 'lucide-react';
import {
  formatEquipmentCondition,
  getConditionBadgeClass,
  EQUIPMENT_CONDITION_OPTIONS,
  isFaulted,
} from '@/utils/equipment/condition-labels';
import { MISSING_DEPARTMENT_MESSAGE } from '@/utils/department/department-scope';
import {
  deptCreateCalibrationRequest,
  deptCreateMaintenanceRequest,
  deptCreateTrainingRequest,
  deptEquipmentDetail,
} from '@/utils/department/department-evidence-links';

interface AssetRow {
  id: string;
  asset_code: string;
  name: string;
  condition: string;
  status: string;
  departments: { id: string; name: string } | null;
  equipment_categories: { id: string; name: string; criticality_level?: string | null } | null;
  manufacturers: { id: string; name: string } | null;
  equipment_models: { id: string; name: string } | null;
  updated_at: string | null;
  installation_date: string | null;
  [key: string]: unknown;
}

interface OpenReq { id: string; asset_id: string; status: string; urgency: string }
interface OpenWO { id: string; asset_id: string; status: string; assigned_to: string | null }

interface EnrichedRow extends AssetRow {
  openRequest?: OpenReq;
  openWorkOrder?: OpenWO;
}

const COLOR_MAP: Record<string, string> = {
  blue: 'bg-blue-500/15 text-blue-400',
  green: 'bg-emerald-500/15 text-emerald-400',
  yellow: 'bg-amber-500/15 text-amber-400',
  red: 'bg-rose-500/15 text-rose-400',
  purple: 'bg-violet-500/15 text-violet-400',
  orange: 'bg-orange-500/15 text-orange-400',
};

function SummaryCard({ label, value, icon, color = 'blue', onClick, active, sub }: { label: string; value: number; icon: React.ReactNode; color?: string; onClick?: () => void; active?: boolean; sub?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`panel-surface flex flex-col gap-1 rounded-xl p-4 text-left transition-colors
        ${onClick ? 'cursor-pointer hover:ring-1 hover:ring-[var(--brand)]/40' : ''}
        ${active ? 'ring-2 ring-[var(--brand)]' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-bold leading-none text-[var(--foreground)]">{value}</span>
        <span className={`rounded-lg p-1.5 ${COLOR_MAP[color] ?? COLOR_MAP.blue}`}>{icon}</span>
      </div>
      <span className="text-xs font-medium leading-tight text-[var(--text-muted)]">{label}</span>
      {sub && <span className="text-[10px] leading-tight text-[var(--text-subtle)]">{sub}</span>}
    </button>
  );
}

type Quick = '' | 'needs_repair' | 'non_functional' | 'under_maintenance' | 'critical' | 'open_request' | 'open_work';

export default function DepartmentEquipmentOverview() {
  const { user } = useAuth();
  const { profile, loading: profileLoading } = useProfile(user?.id);
  const online = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EnrichedRow[]>([]);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [quickFilter, setQuickFilter] = useState<Quick>('');
  const [page, setPage] = useState(1);
  const [cacheState, setCacheState] = useState<{ cachedAt: string; isStale: boolean; fromCache: boolean } | null>(null);
  const PAGE_SIZE = 20;

  const departmentId = profile?.department_id ?? null;
  const departmentName = profile?.department_id ? (rows[0]?.departments?.name ?? null) : null;
  const primaryRole = ((profile as { primaryRole?: string } | null)?.primaryRole) ?? 'department_user';

  const profileId = profile?.id ?? null;
  const cacheScope: OfflineCacheScope | null = useMemo(() => (
    profileId ? { profileId, roleName: primaryRole, departmentId: departmentId ?? null } : null
  ), [departmentId, primaryRole, profileId]);

  useEffect(() => {
    if (profileLoading || !departmentId || !cacheScope) return;
    let cancelled = false;
    async function load() {
      let loadedFromLive = false;
      try {
        const [equipRes, reqRes, woRes] = await Promise.all([
          getEquipmentList({}),
          getOpenMaintenanceRequests(),
          getOpenWorkOrders(),
        ]);
        if (cancelled) return;
        const all = (equipRes.data ?? []) as unknown as AssetRow[];
        const dept = all.filter((r) => r.departments?.id === departmentId);
        const reqMap = new Map<string, OpenReq>();
        for (const r of (reqRes.data as Array<OpenReq> | null) ?? []) if (!reqMap.has(r.asset_id)) reqMap.set(r.asset_id, r);
        const woMap = new Map<string, OpenWO>();
        for (const r of (woRes.data as Array<OpenWO> | null) ?? []) if (!woMap.has(r.asset_id)) woMap.set(r.asset_id, r);
        const enriched: EnrichedRow[] = dept.map((r) => ({ ...r, openRequest: reqMap.get(r.id), openWorkOrder: woMap.get(r.id) }));
        setRows(enriched);
        setLoading(false);
        loadedFromLive = true;
        const cachedAt = new Date().toISOString();
        await saveOfflineReadCache('department.equipment', enriched, cacheScope!, { sourceRoute: '/equipment' });
        setCacheState({ cachedAt, isStale: false, fromCache: false });
      } catch {
        if (!loadedFromLive && cacheScope) {
          const cached = await getOfflineReadCache<EnrichedRow[]>('department.equipment', cacheScope);
          if (!cancelled && cached) {
            setRows(cached.data);
            setLoading(false);
            setCacheState({ cachedAt: cached.cachedAt, isStale: cached.isStale, fromCache: true });
            return;
          }
        }
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [cacheScope, departmentId, profileLoading]);

  const counts = useMemo(() => {
    let functional = 0, needsRepair = 0, nonFunctional = 0, underMaintenance = 0, critical = 0, openReq = 0, openWO = 0;
    for (const r of rows) {
      if (r.condition === 'functional') functional++;
      if (r.condition === 'needs_repair') needsRepair++;
      if (r.condition === 'non_functional') nonFunctional++;
      if (r.condition === 'under_maintenance') underMaintenance++;
      const crit = r.equipment_categories?.criticality_level;
      if (crit === 'high' || crit === 'critical') critical++;
      if (r.openRequest) openReq++;
      if (r.openWorkOrder) openWO++;
    }
    return { total: rows.length, functional, needsRepair, nonFunctional, underMaintenance, critical, openReq, openWO };
  }, [rows]);

  const categoryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (r.equipment_categories?.id) map.set(r.equipment_categories.id, r.equipment_categories.name);
    return Array.from(map.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    const q = search.toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q) || r.asset_code.toLowerCase().includes(q));
    if (filterCategory) out = out.filter((r) => r.equipment_categories?.id === filterCategory);
    if (filterCondition) out = out.filter((r) => r.condition === filterCondition);
    if (quickFilter === 'needs_repair') out = out.filter((r) => r.condition === 'needs_repair');
    if (quickFilter === 'non_functional') out = out.filter((r) => r.condition === 'non_functional');
    if (quickFilter === 'under_maintenance') out = out.filter((r) => r.condition === 'under_maintenance');
    if (quickFilter === 'critical') out = out.filter((r) => {
      const c = r.equipment_categories?.criticality_level;
      return c === 'high' || c === 'critical';
    });
    if (quickFilter === 'open_request') out = out.filter((r) => !!r.openRequest);
    if (quickFilter === 'open_work') out = out.filter((r) => !!r.openWorkOrder);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, search, filterCategory, filterCondition, quickFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (profileLoading) return <PageLoader />;
  if (departmentId && loading) return <PageLoader />;

  if (!departmentId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Department Equipment" description="" />
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-6">
          <p className="font-medium text-[var(--foreground)]">No department linked</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{MISSING_DEPARTMENT_MESSAGE}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Department Equipment"
        description={`Equipment for ${departmentName ?? 'your department'}. Read-only view with request creation only.`}
        breadcrumbs={[{ label: 'Department Dashboard', href: '/command' }, { label: 'Department Equipment' }]}
        actions={<Badge variant="info">Department view</Badge>}
      />

      {(cacheState?.fromCache || !online.isOnline) && cacheState && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Offline cached data — may be stale</p>
            <p className="mt-0.5">Last synced {formatCacheAge(cacheState.cachedAt).toLowerCase()}. Reconnect to refresh from BMERMS.</p>
            {cacheState.isStale && <p className="mt-0.5">Cache exceeds the 12-hour freshness window; verify before acting on critical workflows.</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <SummaryCard label="Total Assets" value={counts.total} icon={<Monitor className="h-4 w-4" />} color="blue" onClick={() => { setQuickFilter(''); setFilterCondition(''); }} active={quickFilter === '' && !filterCondition} />
        <SummaryCard label="Functional" value={counts.functional} icon={<CheckCircle2 className="h-4 w-4" />} color="green" onClick={() => { setFilterCondition('functional'); setQuickFilter(''); }} active={filterCondition === 'functional'} />
        <SummaryCard label="Needs Repair" value={counts.needsRepair} icon={<Wrench className="h-4 w-4" />} color="yellow" onClick={() => setQuickFilter('needs_repair')} active={quickFilter === 'needs_repair'} />
        <SummaryCard label="Non-functional" value={counts.nonFunctional} icon={<AlertTriangle className="h-4 w-4" />} color="red" onClick={() => setQuickFilter('non_functional')} active={quickFilter === 'non_functional'} />
        <SummaryCard label="Under Maintenance" value={counts.underMaintenance} icon={<Clock className="h-4 w-4" />} color="purple" onClick={() => setQuickFilter('under_maintenance')} active={quickFilter === 'under_maintenance'} />
        <SummaryCard label="Critical Assets" value={counts.critical} icon={<ShieldAlert className="h-4 w-4" />} color="orange" onClick={() => setQuickFilter('critical')} active={quickFilter === 'critical'} sub="High/Critical criticality" />
        <SummaryCard label="Open Requests" value={counts.openReq} icon={<ClipboardCheck className="h-4 w-4" />} color="purple" onClick={() => setQuickFilter('open_request')} active={quickFilter === 'open_request'} />
        <SummaryCard label="Open Work" value={counts.openWO} icon={<TrendingUp className="h-4 w-4" />} color="orange" onClick={() => setQuickFilter('open_work')} active={quickFilter === 'open_work'} />
      </div>

      <div className="panel-surface flex flex-wrap items-end gap-3 rounded-xl p-4">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by asset name or code" className="flex-1 min-w-[200px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm" />
        <select value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm">
          <option value="">All Categories</option>
          {categoryOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={filterCondition} onChange={(e) => { setFilterCondition(e.target.value); setPage(1); }} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm">
          <option value="">All Conditions</option>
          {EQUIPMENT_CONDITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="panel-surface overflow-x-auto rounded-xl">
        <table className="min-w-[1080px] w-full text-sm">
          <thead className="border-b border-[var(--border-subtle)]/60">
            <tr className="text-left">
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Asset</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Category</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Condition</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Criticality</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Open Request</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Open Work</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Last Updated</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]/60">
            {pageRows.map((r) => {
              const faulted = isFaulted(r.condition);
              return (
                <tr key={r.id}>
                  <td className="px-4 py-3">
                    <Link href={deptEquipmentDetail(r.id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">{r.name}</Link>
                    <p className="text-xs text-[var(--text-muted)]">{r.asset_code}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{r.equipment_categories?.name ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${getConditionBadgeClass(r.condition)}`}>{formatEquipmentCondition(r.condition)}</span></td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{r.equipment_categories?.criticality_level ?? '—'}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{r.openRequest ? <Badge variant="info">{r.openRequest.status}</Badge> : <span className="text-xs text-[var(--text-subtle)]">—</span>}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{r.openWorkOrder ? <Badge variant="warning">{r.openWorkOrder.status}</Badge> : <span className="text-xs text-[var(--text-subtle)]">—</span>}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{r.updated_at?.slice(0, 10) ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Link href={deptEquipmentDetail(r.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Open Asset Profile</Link>
                      {!r.openRequest && faulted && (
                        <Link href={deptCreateMaintenanceRequest(r.id)} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Create Request</Link>
                      )}
                      {!r.openRequest && !faulted && (
                        <Link href={deptCreateMaintenanceRequest(r.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Create Maintenance Request</Link>
                      )}
                      <Link href={deptCreateCalibrationRequest(r.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Create Calibration Request</Link>
                      <Link href={deptCreateTrainingRequest(r.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Request Training</Link>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">No equipment matches your filters in this department.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-[var(--text-muted)]">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-md border border-[var(--border-subtle)] px-3 py-1 text-xs disabled:opacity-40">Prev</button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-md border border-[var(--border-subtle)] px-3 py-1 text-xs disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        Edit / Delete / Assign / Start / Complete / Create Work Order are not department-role actions. To request action on an asset, use the request buttons.
      </p>
    </div>
  );
}
