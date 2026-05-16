'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Boxes, Package, PackageCheck, PackageMinus, PackagePlus, TrendingUp } from 'lucide-react';
import { PageHeader, Badge, Button } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { createProcurementRequestAction } from '@/actions/procurement.actions';
import { createStockIssueAction, createStockReceiptAction } from '@/actions/spare-parts.actions';
import { OfflineActionResult } from '@/components/offline/OfflineActionResult';
import OfflineQueuedBadge from '@/components/offline/OfflineQueuedBadge';
import OfflineSubmitBanner from '@/components/offline/OfflineSubmitBanner';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  formatCacheAge,
  getOfflineReadCache,
  saveOfflineReadCache,
  type OfflineCacheScope,
} from '@/lib/offline/cache';
import { CloudOff } from 'lucide-react';
import { useRole } from '@/hooks/useRole';
import { OFFLINE_QUEUE_CHANGED_EVENT } from '@/lib/offline/db';
import { getOfflineQueue, runOfflineCapableAction } from '@/lib/offline/queue';
import { getSpareParts } from '@/services/spare-parts.service';
import { getProcurementPipeline } from '@/services/procurement.service';
import { createClient } from '@/lib/supabase/client';
import { classifyStock, stockDeficit, stockStateBadgeClass, stockStateLabel, isOpenProcurement } from '@/utils/store/stock-state';
import {
  storeBinCardLink,
  storeCreateReorderLink,
  storeIssueLink,
  storePartDetail,
  storeProcurementDetail,
  storeReceiveLink,
} from '@/utils/store/store-evidence-links';
import type { OfflineActionRunResult, OfflineQueueRecord } from '@/types/offline';

interface PartRow {
  id: string;
  part_code: string;
  name: string;
  category: string | null;
  current_stock: number | null;
  reorder_level: number | null;
  unit_cost: number | null;
  is_active: boolean;
}

interface ProcurementRow {
  id: string;
  status: string | null;
  title: string | null;
}

interface ReceiptRow { id: string; part_id: string; received_date: string }
interface IssueRow { id: string; part_id: string; issue_date: string; issued_to_event_id: string | null }

const COLOR_MAP: Record<string, string> = {
  blue: 'bg-blue-500/15 text-blue-400',
  green: 'bg-emerald-500/15 text-emerald-400',
  yellow: 'bg-amber-500/15 text-amber-400',
  red: 'bg-rose-500/15 text-rose-400',
  purple: 'bg-violet-500/15 text-violet-400',
  orange: 'bg-orange-500/15 text-orange-400',
};

function StoreCard({ label, value, icon, color = 'blue', sub, onClick, active }: { label: string; value: number; icon: React.ReactNode; color?: string; sub?: string; onClick?: () => void; active?: boolean }) {
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

type StockFilter = 'all' | 'low' | 'stockout' | 'healthy' | 'with-procurement' | 'no-procurement' | 'recent-received' | 'recent-issued';
type StoreDraftType = 'reorder' | 'receipt' | 'issue';

export default function StoreSparePartsStockControl() {
  const { user } = useAuth();
  const { profile } = useProfile(user?.id);
  const { roles, primaryRole } = useRole();
  const online = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [parts, setParts] = useState<PartRow[]>([]);
  const [procurement, setProcurement] = useState<ProcurementRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [cacheState, setCacheState] = useState<{ cachedAt: string; isStale: boolean; fromCache: boolean } | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [page, setPage] = useState(1);
  const [draftType, setDraftType] = useState<StoreDraftType>('reorder');
  const [draftPartId, setDraftPartId] = useState('');
  const [draftQuantity, setDraftQuantity] = useState('1');
  const [draftNote, setDraftNote] = useState('');
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [draftResult, setDraftResult] = useState<OfflineActionRunResult | null>(null);
  const [localDrafts, setLocalDrafts] = useState<OfflineQueueRecord[]>([]);
  const PAGE_SIZE = 25;

  const profileId = profile?.id ?? null;
  const storeScope: OfflineCacheScope | null = useMemo(() => (
    profileId ? { profileId, roleName: primaryRole, departmentId: profile?.department_id ?? null } : null
  ), [primaryRole, profile?.department_id, profileId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = createClient();
        const monthStart = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1).toISOString().slice(0, 10);
        const [partsRes, procRes, receiptsRes, issuesRes] = await Promise.all([
          getSpareParts({ is_active: true }),
          getProcurementPipeline(),
          supabase.from('stock_receipts').select('id, part_id, received_date').gte('received_date', monthStart).limit(5000),
          supabase.from('stock_issues').select('id, part_id, issue_date, issued_to_event_id').gte('issue_date', monthStart).limit(5000),
        ]);
        if (cancelled) return;
        const partsData = (partsRes.data ?? []) as unknown as PartRow[];
        setParts(partsData);
        setProcurement((procRes.data ?? []) as unknown as ProcurementRow[]);
        setReceipts((receiptsRes.data ?? []) as unknown as ReceiptRow[]);
        setIssues((issuesRes.data ?? []) as unknown as IssueRow[]);
        setLoading(false);
        if (storeScope) {
          void saveOfflineReadCache('store.stock_list', partsData, storeScope, { sourceRoute: '/spare-parts' });
          setCacheState({ cachedAt: new Date().toISOString(), isStale: false, fromCache: false });
        }
      } catch (error) {
        if (cancelled) return;
        if (storeScope) {
          const cached = await getOfflineReadCache<PartRow[]>('store.stock_list', storeScope);
          if (cached) {
            setParts(cached.data);
            setCacheState({ cachedAt: cached.cachedAt, isStale: cached.isStale, fromCache: true });
            setLoading(false);
            return;
          }
        }
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[spare-parts] Failed to load stock list', error);
        }
        setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [storeScope]);

  useEffect(() => {
    let active = true;
    const loadLocalDrafts = async () => {
      const queue = await getOfflineQueue();
      if (!active) return;
      setLocalDrafts(queue.filter((action) => ['store_reorder.create', 'stock_receipt.draft', 'stock_issue.draft'].includes(action.action_type)));
    };
    void loadLocalDrafts();
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, loadLocalDrafts);
    return () => {
      active = false;
      window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, loadLocalDrafts);
    };
  }, []);

  const openProcurementByPart = useMemo(() => {
    const map = new Map<string, ProcurementRow>();
    for (const p of procurement) {
      if (!isOpenProcurement(p.status)) continue;
      const title = (p.title ?? '').toLowerCase();
      for (const part of parts) {
        const codeKey = part.part_code.toLowerCase();
        const nameKey = part.name.toLowerCase();
        if (title.includes(codeKey) || (nameKey.length > 4 && title.includes(nameKey))) {
          if (!map.has(part.id)) map.set(part.id, p);
        }
      }
    }
    return map;
  }, [procurement, parts]);

  const receiptsByPart = useMemo(() => {
    const map = new Map<string, ReceiptRow>();
    for (const r of receipts) {
      const existing = map.get(r.part_id);
      if (!existing || r.received_date > existing.received_date) map.set(r.part_id, r);
    }
    return map;
  }, [receipts]);

  const issuesByPart = useMemo(() => {
    const map = new Map<string, IssueRow>();
    for (const r of issues) {
      const existing = map.get(r.part_id);
      if (!existing || r.issue_date > existing.issue_date) map.set(r.part_id, r);
    }
    return map;
  }, [issues]);

  const counts = useMemo(() => {
    let inStock = 0, low = 0, stockout = 0;
    for (const p of parts) {
      const s = classifyStock(p);
      if (s === 'stockout') stockout++;
      else if (s === 'low') low++;
      else inStock++;
    }
    let openProcurementCount = 0;
    for (const p of procurement) if (isOpenProcurement(p.status)) openProcurementCount++;
    return {
      total: parts.length,
      inStock,
      low,
      stockout,
      blocked: 0, // unknown without strict linkage — surface via separate metric
      openProcurement: openProcurementCount,
      receipts: receipts.length,
      issues: issues.length,
    };
  }, [parts, procurement, receipts, issues]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of parts) if (p.category) set.add(p.category);
    return Array.from(set).sort();
  }, [parts]);

  const filtered = useMemo(() => {
    let rows = parts;
    const q = search.toLowerCase();
    if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q) || p.part_code.toLowerCase().includes(q));
    if (filterCategory) rows = rows.filter((p) => p.category === filterCategory);
    if (filter === 'low') rows = rows.filter((p) => classifyStock(p) === 'low');
    if (filter === 'stockout') rows = rows.filter((p) => classifyStock(p) === 'stockout');
    if (filter === 'healthy') rows = rows.filter((p) => classifyStock(p) === 'healthy');
    if (filter === 'with-procurement') rows = rows.filter((p) => openProcurementByPart.has(p.id));
    if (filter === 'no-procurement') rows = rows.filter((p) => classifyStock(p) !== 'healthy' && !openProcurementByPart.has(p.id));
    if (filter === 'recent-received') rows = rows.filter((p) => receiptsByPart.has(p.id));
    if (filter === 'recent-issued') rows = rows.filter((p) => issuesByPart.has(p.id));
    return rows.sort((a, b) => classifyStock(a) === classifyStock(b) ? a.name.localeCompare(b.name) : (classifyStock(a) === 'stockout' ? -1 : classifyStock(b) === 'stockout' ? 1 : classifyStock(a) === 'low' ? -1 : 1));
  }, [parts, search, filterCategory, filter, openProcurementByPart, receiptsByPart, issuesByPart]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedDraftPart = parts.find((part) => part.id === draftPartId) ?? null;

  async function submitStoreDraft() {
    if (!selectedDraftPart) return;
    const quantity = Number(draftQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    setDraftSubmitting(true);

    const basePayload = {
      part_id: selectedDraftPart.id,
      part_name: selectedDraftPart.name,
      current_stock_snapshot: selectedDraftPart.current_stock ?? 0,
      reorder_level_snapshot: selectedDraftPart.reorder_level ?? 0,
      quantity,
      note: draftNote || null,
    };
    const result = draftType === 'reorder'
      ? await runOfflineCapableAction({
          actionType: 'store_reorder.create',
          entityType: 'procurement_requests',
          entityId: selectedDraftPart.id,
          payload: {
            ...basePayload,
            requested_quantity: quantity,
            reason: draftNote || `Reorder draft for ${selectedDraftPart.name}`,
            title: `Procure ${selectedDraftPart.name}`,
            justification: [
              draftNote || 'Store reorder draft',
              `Current stock: ${selectedDraftPart.current_stock ?? 0}`,
              `Reorder level: ${selectedDraftPart.reorder_level ?? 0}`,
              `Requested quantity: ${quantity}`,
            ].join('\n'),
            status: 'requested',
            priority: classifyStock(selectedDraftPart) === 'stockout' ? 'critical' : 'high',
            expected_delivery_date: null,
          },
          createdByProfileId: profile?.id ?? null,
          roleName: primaryRole,
          roleNames: roles,
          sourceRoute: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/spare-parts',
          executeOnline: () => createProcurementRequestAction({
            title: `Procure ${selectedDraftPart.name}`,
            justification: [
              draftNote || 'Store reorder draft',
              `Current stock: ${selectedDraftPart.current_stock ?? 0}`,
              `Reorder level: ${selectedDraftPart.reorder_level ?? 0}`,
              `Requested quantity: ${quantity}`,
            ].join('\n'),
            status: 'requested',
            priority: classifyStock(selectedDraftPart) === 'stockout' ? 'critical' : 'high',
            expected_delivery_date: null,
          }),
          metadata: { form: 'store_stock_control_draft' },
        })
      : draftType === 'receipt'
        ? await runOfflineCapableAction({
            actionType: 'stock_receipt.draft',
            entityType: 'stock_receipts',
            entityId: selectedDraftPart.id,
            payload: {
              ...basePayload,
              part_name_snapshot: selectedDraftPart.name,
              part_id: selectedDraftPart.id,
              quantity,
              received_by: null,
              received_date: new Date().toISOString().split('T')[0],
              supplier_id: null,
              invoice_ref: null,
              unit_cost: null,
              notes: draftNote || null,
            },
            createdByProfileId: profile?.id ?? null,
            roleName: primaryRole,
            roleNames: roles,
            sourceRoute: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/spare-parts',
            executeOnline: () => createStockReceiptAction({
              part_id: selectedDraftPart.id,
              quantity,
              received_by: null,
              received_date: new Date().toISOString().split('T')[0],
              supplier_id: null,
              invoice_ref: null,
              unit_cost: null,
              notes: draftNote || null,
            }),
            metadata: { form: 'store_stock_control_draft' },
          })
        : await runOfflineCapableAction({
            actionType: 'stock_issue.draft',
            entityType: 'stock_issues',
            entityId: selectedDraftPart.id,
            payload: {
              ...basePayload,
              part_name_snapshot: selectedDraftPart.name,
              part_id: selectedDraftPart.id,
              quantity,
              issued_to_event_id: null,
              issued_by: null,
              issue_date: new Date().toISOString().split('T')[0],
              department_id: null,
              notes: draftNote || null,
              local_stock_snapshot: selectedDraftPart.current_stock ?? 0,
            },
            createdByProfileId: profile?.id ?? null,
            roleName: primaryRole,
            roleNames: roles,
            sourceRoute: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/spare-parts',
            executeOnline: () => createStockIssueAction({
              part_id: selectedDraftPart.id,
              quantity,
              issued_to_event_id: null,
              issued_by: null,
              issue_date: new Date().toISOString().split('T')[0],
              department_id: null,
              notes: draftNote || null,
            }),
            metadata: { form: 'store_stock_control_draft' },
          });

    setDraftSubmitting(false);
    setDraftResult(result);
    if (result.status === 'queued' || result.status === 'success') {
      setDraftNote('');
      setDraftQuantity('1');
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Spare Parts Stock Control"
        description="Read-write stock view for the Medical Equipment Store Officer. Approvals for procurement and maintenance happen elsewhere."
        breadcrumbs={[{ label: 'Store Operations', href: '/command' }, { label: 'Spare Parts Stock Control' }]}
        actions={<Badge variant="info">Store / logistics view</Badge>}
      />

      {(cacheState?.fromCache || !online.isOnline) && cacheState && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Offline cached data — may be stale</p>
            <p className="mt-0.5">Showing the last-cached parts catalog. Last synced {formatCacheAge(cacheState.cachedAt).toLowerCase()}. Live stock balances may have changed; confirm before issuing.</p>
            {cacheState.isStale && <p className="mt-0.5">Cache exceeds the 12-hour freshness window; verify current stock before acting.</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StoreCard label="Total Parts" value={counts.total} icon={<Package className="h-4 w-4" />} color="blue" onClick={() => setFilter('all')} active={filter === 'all'} />
        <StoreCard label="In Stock" value={counts.inStock} icon={<PackageCheck className="h-4 w-4" />} color="green" onClick={() => setFilter('healthy')} active={filter === 'healthy'} />
        <StoreCard label="Low Stock" value={counts.low} icon={<AlertTriangle className="h-4 w-4" />} color="yellow" onClick={() => setFilter('low')} active={filter === 'low'} />
        <StoreCard label="Stockout" value={counts.stockout} icon={<AlertTriangle className="h-4 w-4" />} color="red" onClick={() => setFilter('stockout')} active={filter === 'stockout'} sub="current_stock ≤ 0" />
        <StoreCard label="Open Procurement" value={counts.openProcurement} icon={<TrendingUp className="h-4 w-4" />} color="purple" onClick={() => setFilter('with-procurement')} active={filter === 'with-procurement'} sub="incoming replenishment" />
        <StoreCard label="No Procurement" value={parts.filter((p) => classifyStock(p) !== 'healthy' && !openProcurementByPart.has(p.id)).length} icon={<PackageMinus className="h-4 w-4" />} color="orange" onClick={() => setFilter('no-procurement')} active={filter === 'no-procurement'} sub="needs reorder" />
        <StoreCard label="Received This Month" value={counts.receipts} icon={<PackagePlus className="h-4 w-4" />} color="green" onClick={() => setFilter('recent-received')} active={filter === 'recent-received'} />
        <StoreCard label="Issued This Month" value={counts.issues} icon={<Boxes className="h-4 w-4" />} color="purple" onClick={() => setFilter('recent-issued')} active={filter === 'recent-issued'} />
      </div>

      <div className="panel-surface rounded-xl p-4">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Offline Store Draft</h2>
          <p className="text-xs text-[var(--text-muted)]">Draft reorder, receipt, and issue intent locally. Stock balances change only after online validation.</p>
        </div>
        <OfflineSubmitBanner actionLabel="Store stock draft" />
        <OfflineActionResult result={draftResult} />
        <div className="mt-4 grid gap-3 md:grid-cols-[160px_1fr_120px_1fr_auto] md:items-end">
          <label className="text-xs font-medium text-[var(--text-muted)]">
            Draft type
            <select value={draftType} onChange={(e) => setDraftType(e.target.value as StoreDraftType)} className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--foreground)]">
              <option value="reorder">Reorder draft</option>
              <option value="receipt">Receipt draft</option>
              <option value="issue">Issue draft</option>
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--text-muted)]">
            Part
            <select value={draftPartId} onChange={(e) => setDraftPartId(e.target.value)} className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--foreground)]">
              <option value="">Select part</option>
              {parts.map((part) => <option key={part.id} value={part.id}>{part.part_code} · {part.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--text-muted)]">
            Quantity
            <input value={draftQuantity} onChange={(e) => setDraftQuantity(e.target.value)} type="number" min="1" className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--foreground)]" />
          </label>
          <label className="text-xs font-medium text-[var(--text-muted)]">
            Note
            <input value={draftNote} onChange={(e) => setDraftNote(e.target.value)} className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--foreground)]" />
          </label>
          <Button onClick={submitStoreDraft} loading={draftSubmitting} disabled={!selectedDraftPart || !draftQuantity}>
            Save Draft
          </Button>
        </div>
        {localDrafts.length > 0 && (
          <div className="mt-4 divide-y divide-[var(--border-subtle)]/60 rounded-lg border border-[var(--border-subtle)]">
            {localDrafts.slice(0, 5).map((action) => (
              <div key={action.client_action_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="text-[var(--text-muted)]">{action.action_type.replace(/_/g, ' ')} · {String(action.payload.part_name ?? action.payload.part_name_snapshot ?? action.entity_id ?? 'part')}</span>
                <OfflineQueuedBadge status={action.sync_status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel-surface flex flex-wrap items-end gap-3 rounded-xl p-4">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by part name or code"
          className="flex-1 min-w-[200px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm"
        />
        <select value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm">
          <option value="">All Categories</option>
          {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="panel-surface overflow-x-auto rounded-xl">
        <table className="min-w-[1080px] w-full text-sm">
          <thead className="border-b border-[var(--border-subtle)]/60">
            <tr className="text-left">
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Part</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Category</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Current</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Reorder</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Deficit</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Unit cost</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">State</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Procurement</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Last receipt</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Last issue</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Next action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]/60">
            {pageRows.map((p) => {
              const state = classifyStock(p);
              const open = openProcurementByPart.get(p.id) ?? null;
              const lastReceipt = receiptsByPart.get(p.id) ?? null;
              const lastIssue = issuesByPart.get(p.id) ?? null;
              return (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <Link href={storePartDetail(p.id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">{p.name}</Link>
                    <p className="text-xs text-[var(--text-muted)]">{p.part_code}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{p.category ?? '—'}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{p.current_stock ?? 0}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{p.reorder_level ?? 0}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{stockDeficit(p)}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{p.unit_cost === null ? '—' : Number(p.unit_cost).toFixed(2)}</td>
                  <td className="px-4 py-3"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${stockStateBadgeClass(state)}`}>{stockStateLabel(state)}</span></td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {open ? (
                      <Link href={storeProcurementDetail(open.id)} className="text-xs text-violet-300 hover:text-violet-200">{open.status} →</Link>
                    ) : <span className="text-xs text-[var(--text-subtle)]">None</span>}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{lastReceipt?.received_date ?? '—'}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{lastIssue?.issue_date ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {state === 'healthy' && <Link href={storeIssueLink(p.id)} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Issue Stock</Link>}
                      {state !== 'healthy' && !open && (
                        <Link href={storeCreateReorderLink(p)} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Create Reorder Request</Link>
                      )}
                      {state !== 'healthy' && open && (
                        <Link href={storeProcurementDetail(open.id)} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Track Procurement</Link>
                      )}
                      <Link href={storeBinCardLink(p.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Bin Card</Link>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">No parts match your filters.</td></tr>
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
        Procurement linkage is detected via best-effort title match (part code/name). Procurement approvals and cancellations are not visible here — they belong to BME Head. Use <Link className="text-violet-300 hover:text-violet-200" href={storeReceiveLink()}>Receiving</Link> to record delivered items.
      </p>
    </div>
  );
}
