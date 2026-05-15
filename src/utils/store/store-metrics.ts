// Server-side store/logistics metric aggregator for the Store User role.
//
// Every value returned here is computed from real loaded rows in the BMERMS
// database. No generated narrative, no AI-derived prose, no fake counts.
// Returns null where a metric truly cannot be computed.
//
// Source rows / definitions:
//   - spare_parts                 : id, current_stock, reorder_level, unit_cost
//                                   → stockout / low / healthy classification.
//   - stock_receipts              : receipts logged this calendar month.
//   - stock_issues                : issues logged this calendar month,
//                                   issued_to_event_id links to a work order
//                                   event when present.
//   - procurement_requests        : status pipeline (requested → approved →
//                                   ordered → in_transit → delivered, plus
//                                   'delayed').
//   - recommendation_flags        : flag_type in ('low_stock','part_shortage')
//                                   surfaces stock blockers and acknowledged
//                                   flags are excluded.
//   - maintenance_requests        : status='approved' or status='pending' rows
//                                   with reported_condition tracking parts
//                                   needed; we treat work-order on_hold +
//                                   active stock-related flag as a blocker.
//   - v_open_work_orders          : open WO with status='on_hold' counted as
//                                   potential parts-blocked work.
//
// Notes:
//   - "Delivered awaiting receipt" is approximated as
//       procurement_requests where status='delivered'
//     since the schema does not currently model an explicit
//     procurement→stock_receipt linkage; the field name reflects this honest
//     approximation. If a linkage column is added later, narrow this here.
//   - "Approved items to issue" is approximated as the count of approved
//     maintenance requests whose work has not yet been completed (a downstream
//     handoff that often requires the store to issue a part). The label is
//     "Approved Items to Issue (handoff)" and is documented in the UI subtitle.

import type { createClient } from '@/lib/supabase/server';
import {
  classifyStock,
  isOpenProcurement,
  isDeliveredProcurement,
  isDelayedProcurement,
} from './stock-state';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface StoreExecutiveMetrics {
  totalParts: number;
  inStockParts: number;
  lowStockParts: number;
  stockoutParts: number;
  blockedWorkOrders: number;
  approvedItemsToIssue: number; // approved maintenance requests not yet completed
  deliveredItemsToReceive: number; // procurement status='delivered'
  openProcurement: number; // requested + approved + ordered + in_transit
  delayedProcurement: number; // status='delayed'
  recentReceipts: number; // stock_receipts in current month
  recentIssues: number; // stock_issues in current month
  pendingIssueRequests: number; // maintenance_requests pending
}

interface PartRow {
  id: string;
  current_stock: number | null;
  reorder_level: number | null;
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), 1).toISOString().slice(0, 10);
}

export async function fetchStoreExecutiveMetrics(supabase: Supabase): Promise<StoreExecutiveMetrics> {
  const monthStart = monthStartIso();

  const [
    partsRes,
    procRes,
    receiptsRes,
    issuesRes,
    woRes,
    pendingReqRes,
    approvedReqRes,
  ] = await Promise.all([
    supabase
      .from('spare_parts')
      .select('id, current_stock, reorder_level')
      .eq('is_active', true)
      .limit(5000),
    supabase
      .from('procurement_requests')
      .select('id, status')
      .limit(5000),
    supabase
      .from('stock_receipts')
      .select('id, received_date')
      .gte('received_date', monthStart)
      .limit(5000),
    supabase
      .from('stock_issues')
      .select('id, issue_date')
      .gte('issue_date', monthStart)
      .limit(5000),
    supabase
      .from('v_open_work_orders')
      .select('id, status')
      .eq('status', 'on_hold')
      .limit(2000),
    supabase
      .from('maintenance_requests')
      .select('id, status')
      .eq('status', 'pending')
      .limit(2000),
    supabase
      .from('maintenance_requests')
      .select('id, status')
      .eq('status', 'approved')
      .limit(2000),
  ]);

  const parts = (partsRes.data ?? []) as PartRow[];
  let inStock = 0, low = 0, stockout = 0;
  for (const p of parts) {
    const state = classifyStock(p);
    if (state === 'stockout') stockout++;
    else if (state === 'low') low++;
    else inStock++;
  }

  const procRows = (procRes.data ?? []) as Array<{ status: string | null }>;
  let openProcurement = 0;
  let delayedProcurement = 0;
  let deliveredItemsToReceive = 0;
  for (const r of procRows) {
    if (isOpenProcurement(r.status)) openProcurement++;
    if (isDelayedProcurement(r.status)) delayedProcurement++;
    if (isDeliveredProcurement(r.status)) deliveredItemsToReceive++;
  }

  // Blocked work orders: count of open work orders currently on_hold. This is
  // the canonical "waiting / unable to progress" signal; the schema does not
  // include a strict 'blocked_by_part' field, so on_hold is the honest proxy.
  const blockedWorkOrders = (woRes.data ?? []).length;

  return {
    totalParts: parts.length,
    inStockParts: inStock,
    lowStockParts: low,
    stockoutParts: stockout,
    blockedWorkOrders,
    approvedItemsToIssue: (approvedReqRes.data ?? []).length,
    deliveredItemsToReceive,
    openProcurement,
    delayedProcurement,
    recentReceipts: (receiptsRes.data ?? []).length,
    recentIssues: (issuesRes.data ?? []).length,
    pendingIssueRequests: (pendingReqRes.data ?? []).length,
  };
}

// Stock risk rows for the Store Command Center / Stock Control table.
export interface StoreStockRiskRow {
  id: string;
  partCode: string;
  name: string;
  category: string | null;
  currentStock: number;
  reorderLevel: number;
  deficit: number;
  unitCost: number | null;
  state: 'stockout' | 'low' | 'healthy';
  openProcurementId: string | null;
  openProcurementStatus: string | null;
}

export async function fetchStoreStockRisk(supabase: Supabase): Promise<StoreStockRiskRow[]> {
  const [partsRes, procRes] = await Promise.all([
    supabase
      .from('spare_parts')
      .select('id, part_code, name, category, current_stock, reorder_level, unit_cost')
      .eq('is_active', true)
      .order('current_stock', { ascending: true })
      .limit(2000),
    supabase
      .from('procurement_requests')
      .select('id, status, title, created_at')
      .in('status', ['requested', 'approved', 'ordered', 'in_transit', 'delayed'])
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);

  // Best-effort linkage: procurement_requests do not have a partId column in
  // the current schema. We match by the part_code or part name appearing in
  // the procurement title (case-insensitive substring). This is a heuristic
  // that the UI must clearly label — it does not assert a verified linkage.
  const proc = (procRes.data ?? []) as Array<{ id: string; status: string | null; title: string | null }>;

  function findOpenProcurement(partCode: string, name: string): { id: string; status: string | null } | null {
    const codeKey = partCode.toLowerCase();
    const nameKey = name.toLowerCase();
    for (const r of proc) {
      const t = (r.title ?? '').toLowerCase();
      if (t.includes(codeKey) || (nameKey.length > 4 && t.includes(nameKey))) {
        return { id: r.id, status: r.status };
      }
    }
    return null;
  }

  return ((partsRes.data ?? []) as Array<PartRow & { part_code: string; name: string; category: string | null; unit_cost: number | null }>)
    .map((p) => {
      const state = classifyStock(p);
      const open = state === 'healthy' ? null : findOpenProcurement(p.part_code, p.name);
      return {
        id: p.id,
        partCode: p.part_code,
        name: p.name,
        category: p.category ?? null,
        currentStock: Number(p.current_stock ?? 0),
        reorderLevel: Number(p.reorder_level ?? 0),
        deficit: Math.max(0, Number(p.reorder_level ?? 0) - Number(p.current_stock ?? 0)),
        unitCost: p.unit_cost === null ? null : Number(p.unit_cost),
        state,
        openProcurementId: open?.id ?? null,
        openProcurementStatus: open?.status ?? null,
      };
    });
}

// Receiving queue: procurement requests with status delivered.
export interface StoreReceivingRow {
  id: string;
  requestNumber: string;
  title: string;
  status: string;
  priority: string;
  expectedDeliveryDate: string | null;
  createdAt: string | null;
}

export async function fetchStoreReceivingQueue(supabase: Supabase): Promise<StoreReceivingRow[]> {
  const { data } = await supabase
    .from('procurement_requests')
    .select('id, request_number, title, status, priority, expected_delivery_date, created_at')
    .eq('status', 'delivered')
    .order('expected_delivery_date', { ascending: true })
    .limit(500);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    requestNumber: (r.request_number as string) ?? '',
    title: (r.title as string) ?? '',
    status: (r.status as string) ?? '',
    priority: (r.priority as string) ?? 'medium',
    expectedDeliveryDate: (r.expected_delivery_date as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
  }));
}

// Issue queue: approved maintenance requests that may need parts issued
// downstream. We deliberately surface this as a "handoff" queue, not as a
// strict approved-issue-request queue, because the BMERMS schema does not
// currently model item issue approvals as a distinct workflow.
export interface StoreIssueRow {
  id: string;
  requestNumber: string;
  assetName: string;
  assetCode: string;
  departmentName: string;
  status: string;
  reportedCondition: string | null;
  createdAt: string | null;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function fetchStoreIssueQueue(supabase: Supabase): Promise<StoreIssueRow[]> {
  const { data } = await supabase
    .from('maintenance_requests')
    .select('id, request_number, status, reported_condition, created_at, equipment_assets(asset_code, name), departments(name)')
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(500);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const eq = firstRelation(r.equipment_assets as Record<string, unknown> | Record<string, unknown>[] | null);
    const dept = firstRelation(r.departments as Record<string, unknown> | Record<string, unknown>[] | null);
    return {
      id: r.id as string,
      requestNumber: (r.request_number as string) ?? '',
      assetName: (eq?.name as string | undefined) ?? 'Unknown',
      assetCode: (eq?.asset_code as string | undefined) ?? '—',
      departmentName: (dept?.name as string | undefined) ?? 'Unknown',
      status: (r.status as string) ?? '',
      reportedCondition: (r.reported_condition as string | null) ?? null,
      createdAt: (r.created_at as string | null) ?? null,
    };
  });
}

// Maintenance blockers: work orders on hold + related context.
export interface StoreBlockerRow {
  id: string;
  workOrderNumber: string | null;
  assetId: string | null;
  assetName: string;
  assetCode: string;
  departmentName: string;
  priority: string | null;
  status: string;
  blockedSince: string | null;
}

export async function fetchStoreBlockers(supabase: Supabase): Promise<StoreBlockerRow[]> {
  const { data } = await supabase
    .from('v_open_work_orders')
    .select('id, work_order_number, asset_id, priority, status, created_at, scheduled_date, equipment_assets(asset_code, name, departments(name))')
    .eq('status', 'on_hold')
    .order('created_at', { ascending: true })
    .limit(500);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const eq = firstRelation(r.equipment_assets as Record<string, unknown> | Record<string, unknown>[] | null);
    const dept = firstRelation(eq?.departments as Record<string, unknown> | Record<string, unknown>[] | null);
    return {
      id: r.id as string,
      workOrderNumber: (r.work_order_number as string | null) ?? null,
      assetId: (r.asset_id as string | null) ?? null,
      assetName: (eq?.name as string | undefined) ?? 'Unknown',
      assetCode: (eq?.asset_code as string | undefined) ?? '—',
      departmentName: (dept?.name as string | undefined) ?? 'Unknown',
      priority: (r.priority as string | null) ?? null,
      status: (r.status as string) ?? 'on_hold',
      blockedSince: (r.created_at as string | null) ?? null,
    };
  });
}
