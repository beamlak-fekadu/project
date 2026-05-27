// QR identity service (Phase 1).
//
// Server-only. Provides token lifecycle operations on equipment_assets plus a
// scan-logging helper that will be used in later phases. No UI is wired to
// these functions beyond the Developer Lab coverage section and the equipment
// detail QR panel.

// NOTE: Server-only. Uses @/lib/supabase/server which cannot run in client
// components. Do not import this module from client code.
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { generateQrToken, isValidQrTokenFormat, maskQrToken } from '@/utils/qr/token';
import { QR_SCAN_DEDUP_WINDOW_MINUTES } from '@/types/qr';
import { OPEN_MAINTENANCE_REQUEST_STATUSES, OPEN_WORK_ORDER_STATUSES } from '@/utils/maintenance/request-status';
import type {
  QrLabelStatus,
  QrCoverageStats,
  QrScanSource,
  QrOnlineStatus,
  QrLabelAsset,
  QrLabelFilter,
  AssetQrScanSummary,
  QrAssetScanMetric,
  QrScanCoverageStats,
  QrScanHistoryFilters,
  QrScanHistoryRow,
  QrSecurityEventRow,
  QrSecurityScanStatus,
} from '@/types/qr';

type AssetQrRow = {
  id: string;
  qr_token: string | null;
  qr_generated_at: string | null;
  qr_label_status: QrLabelStatus | null;
  qr_label_printed_at: string | null;
  qr_label_attached_at: string | null;
  qr_label_replaced_at: string | null;
  qr_token_regenerated_at: string | null;
};

const ASSET_QR_SELECT =
  'id, qr_token, qr_generated_at, qr_label_status, qr_label_printed_at, qr_label_attached_at, qr_label_replaced_at, qr_token_regenerated_at';

const MAX_COLLISION_RETRIES = 5;

type Client = SupabaseClient;

async function resolveClient(client?: Client): Promise<Client> {
  if (client) return client;
  return (await createClient()) as unknown as Client;
}

// ─── Read helpers ──────────────────────────────────────────────────────────

export async function getAssetQrIdentity(assetId: string, client?: Client) {
  const supabase = await resolveClient(client);
  return supabase
    .from('equipment_assets')
    .select(ASSET_QR_SELECT)
    .eq('id', assetId)
    .is('deleted_at', null)
    .maybeSingle<AssetQrRow>();
}

export async function getAssetByQrToken(token: string, client?: Client) {
  if (!isValidQrTokenFormat(token)) {
    return { data: null, error: { message: 'Invalid QR token format' } };
  }
  const supabase = await resolveClient(client);
  const { data, error } = await supabase
    .from('equipment_assets')
    .select(`${ASSET_QR_SELECT}, asset_code, name, department_id, condition, status`)
    .eq('qr_token', token)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: { message: 'QR token not found' } };
  if ((data as AssetQrRow).qr_label_status === 'revoked') {
    return { data: null, error: { message: 'QR token has been revoked' } };
  }
  return { data, error: null };
}

// ─── Token lifecycle ───────────────────────────────────────────────────────

async function tokenExists(supabase: Client, token: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('equipment_assets')
    .select('id')
    .eq('qr_token', token)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

async function generateUniqueToken(supabase: Client): Promise<string> {
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt += 1) {
    const candidate = generateQrToken();
    if (!(await tokenExists(supabase, candidate))) return candidate;
  }
  throw new Error('Could not generate a unique QR token after multiple attempts');
}

export type EnsureQrTokenResult = {
  token: string;
  created: boolean;
};

export async function ensureAssetQrToken(
  assetId: string,
  client?: Client,
): Promise<EnsureQrTokenResult> {
  const supabase = await resolveClient(client);
  const { data: existing, error } = await getAssetQrIdentity(assetId, supabase);
  if (error) throw new Error(error.message);
  if (!existing) throw new Error('Equipment asset not found');

  if (existing.qr_token) {
    return { token: existing.qr_token, created: false };
  }

  const token = await generateUniqueToken(supabase);
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('equipment_assets')
    .update({
      qr_token: token,
      qr_generated_at: now,
      qr_label_status: 'generated',
    } as never)
    .eq('id', assetId);

  if (updateError) throw new Error(updateError.message);
  return { token, created: true };
}

export async function regenerateAssetQrToken(
  assetId: string,
  client?: Client,
): Promise<EnsureQrTokenResult> {
  const supabase = await resolveClient(client);
  const { data: existing, error } = await getAssetQrIdentity(assetId, supabase);
  if (error) throw new Error(error.message);
  if (!existing) throw new Error('Equipment asset not found');

  const token = await generateUniqueToken(supabase);
  const now = new Date().toISOString();

  const update: Record<string, unknown> = {
    qr_token: token,
    qr_generated_at: now,
    qr_token_regenerated_at: now,
    qr_label_status: 'generated',
    qr_label_printed_at: null,
    qr_label_attached_at: null,
  };

  if (existing.qr_token || existing.qr_label_status === 'needs_replacement' || existing.qr_label_status === 'revoked') {
    update.qr_label_replaced_at = now;
  }

  const { error: updateError } = await supabase
    .from('equipment_assets')
    .update(update as never)
    .eq('id', assetId);

  if (updateError) throw new Error(updateError.message);
  return { token, created: true };
}

async function setQrLabelStatusInternal(
  supabase: Client,
  assetId: string,
  status: QrLabelStatus,
  extraFields: Record<string, unknown> = {},
  requireToken = true,
) {
  const { data: existing, error } = await getAssetQrIdentity(assetId, supabase);
  if (error) throw new Error(error.message);
  if (!existing) throw new Error('Equipment asset not found');
  if (requireToken && !existing.qr_token) {
    throw new Error('Generate a QR token before updating the label status');
  }

  const { error: updateError } = await supabase
    .from('equipment_assets')
    .update({ qr_label_status: status, ...extraFields } as never)
    .eq('id', assetId);

  if (updateError) throw new Error(updateError.message);
}

export async function markQrLabelPrinted(assetId: string, client?: Client) {
  const supabase = await resolveClient(client);
  await setQrLabelStatusInternal(supabase, assetId, 'printed', {
    qr_label_printed_at: new Date().toISOString(),
  });
}

export async function markQrLabelAttached(assetId: string, client?: Client) {
  const supabase = await resolveClient(client);
  await setQrLabelStatusInternal(supabase, assetId, 'attached', {
    qr_label_attached_at: new Date().toISOString(),
  });
}

export async function markQrLabelNeedsReplacement(assetId: string, client?: Client) {
  const supabase = await resolveClient(client);
  await setQrLabelStatusInternal(supabase, assetId, 'needs_replacement');
}

/**
 * Soft-revoke the current QR token.
 *
 * Design choice: we keep the qr_token value but set status to 'revoked'. The
 * future /qr/a/[token] landing page (Phase 3) must reject revoked tokens, and
 * regenerateAssetQrToken() is the canonical path to issue a new one. Keeping
 * the old token row visible preserves history and allows scans of obsolete
 * labels to be diagnosed instead of silently 404-ing.
 */
export async function revokeAssetQrToken(assetId: string, client?: Client) {
  const supabase = await resolveClient(client);
  await setQrLabelStatusInternal(supabase, assetId, 'revoked');
}

// ─── Bulk generation ───────────────────────────────────────────────────────

export type BulkGenerateResult = {
  generated: number;
  skipped: number;
  failed: number;
};

export async function bulkGenerateMissingQrTokens(client?: Client): Promise<BulkGenerateResult> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase
    .from('equipment_assets')
    .select('id, qr_token')
    .is('deleted_at', null)
    .is('qr_token', null);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{ id: string; qr_token: string | null }>;
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.qr_token) {
      skipped += 1;
      continue;
    }
    try {
      const result = await ensureAssetQrToken(row.id, supabase);
      if (result.created) generated += 1;
      else skipped += 1;
    } catch (err) {
      console.error('[qr.bulkGenerate] Failed for asset', row.id, err);
      failed += 1;
    }
  }

  return { generated, skipped, failed };
}

// ─── Coverage stats ────────────────────────────────────────────────────────

export async function getQrCoverageStats(client?: Client): Promise<QrCoverageStats> {
  const supabase = await resolveClient(client);
  const [assetsRes, scansRes] = await Promise.all([
    supabase
      .from('equipment_assets')
      .select('qr_token, qr_label_status')
      .is('deleted_at', null)
      .limit(5000),
    supabase.from('equipment_qr_scans').select('id', { count: 'exact', head: true }),
  ]);

  const assets = (assetsRes.data ?? []) as Array<{
    qr_token: string | null;
    qr_label_status: QrLabelStatus | null;
  }>;

  const totalActiveAssets = assets.length;
  let withoutToken = 0;
  let generated = 0;
  let printed = 0;
  let attached = 0;
  let needsReplacement = 0;
  let revoked = 0;

  for (const row of assets) {
    if (!row.qr_token) withoutToken += 1;
    switch (row.qr_label_status) {
      case 'generated':
        generated += 1;
        break;
      case 'printed':
        printed += 1;
        break;
      case 'attached':
        attached += 1;
        break;
      case 'needs_replacement':
        needsReplacement += 1;
        break;
      case 'revoked':
        revoked += 1;
        break;
      default:
        break;
    }
  }

  return {
    totalActiveAssets,
    withoutToken,
    generated,
    printed,
    attached,
    needsReplacement,
    revoked,
    recentScanCount: scansRes.count ?? 0,
  };
}

// ─── Phase 3 — QR landing resolution ───────────────────────────────────────
//
// Discriminated result so the /qr/a/[token] route can show distinct
// invalid / not-found / revoked / ok states without conflating them through
// a single string error. The "revoked" branch intentionally returns no asset
// metadata in the UI — only the timestamp the label was retired. The asset id
// is kept in the service result so the route can write privileged security
// evidence without exposing it publicly.

export type QrLandingResolution =
  | { status: 'invalid' }
  | { status: 'not_found' }
  | { status: 'revoked'; replacedAt: string | null; assetId: string | null; departmentId: string | null }
  | { status: 'ok'; asset: QrLandingAsset };

export type QrLandingAsset = {
  id: string;
  asset_code: string;
  name: string;
  condition: string | null;
  status: string | null;
  department_id: string | null;
  department_name: string | null;
  category_name: string | null;
  criticality_level: string | null;
  qr_token: string | null;
  qr_label_status: QrLabelStatus;
  qr_generated_at: string | null;
  qr_label_printed_at: string | null;
  qr_label_attached_at: string | null;
  qr_label_replaced_at: string | null;
  qr_token_regenerated_at: string | null;
};

const LANDING_SELECT = `
  id,
  asset_code,
  name,
  condition,
  status,
  department_id,
  qr_token,
  qr_label_status,
  qr_generated_at,
  qr_label_printed_at,
  qr_label_attached_at,
  qr_label_replaced_at,
  qr_token_regenerated_at,
  departments ( name ),
  equipment_categories ( name, criticality_level )
`;

type RawLandingRow = {
  id: string;
  asset_code: string;
  name: string;
  condition: string | null;
  status: string | null;
  department_id: string | null;
  qr_token: string | null;
  qr_label_status: QrLabelStatus | null;
  qr_generated_at: string | null;
  qr_label_printed_at: string | null;
  qr_label_attached_at: string | null;
  qr_label_replaced_at: string | null;
  qr_token_regenerated_at: string | null;
  departments: { name: string | null } | { name: string | null }[] | null;
  equipment_categories:
    | { name: string | null; criticality_level: string | null }
    | { name: string | null; criticality_level: string | null }[]
    | null;
};

export async function resolveQrLandingAsset(
  token: string,
  client?: Client,
): Promise<QrLandingResolution> {
  if (!isValidQrTokenFormat(token)) return { status: 'invalid' };
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from('equipment_assets')
    .select(LANDING_SELECT)
    .eq('qr_token', token)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    console.error('[qr.resolveQrLandingAsset]', error.message);
    return { status: 'not_found' };
  }
  if (!data) return { status: 'not_found' };

  const row = data as unknown as RawLandingRow;
  if (row.qr_label_status === 'revoked') {
    return {
      status: 'revoked',
      replacedAt: row.qr_label_replaced_at,
      assetId: row.id,
      departmentId: row.department_id,
    };
  }

  const dept = Array.isArray(row.departments) ? row.departments[0] : row.departments;
  const cat = Array.isArray(row.equipment_categories)
    ? row.equipment_categories[0]
    : row.equipment_categories;

  return {
    status: 'ok',
    asset: {
      id: row.id,
      asset_code: row.asset_code,
      name: row.name,
      condition: row.condition,
      status: row.status,
      department_id: row.department_id,
      department_name: dept?.name ?? null,
      category_name: cat?.name ?? null,
      criticality_level: cat?.criticality_level ?? null,
      qr_token: row.qr_token,
      qr_label_status: (row.qr_label_status ?? 'not_generated') as QrLabelStatus,
      qr_generated_at: row.qr_generated_at,
      qr_label_printed_at: row.qr_label_printed_at,
      qr_label_attached_at: row.qr_label_attached_at,
      qr_label_replaced_at: row.qr_label_replaced_at,
      qr_token_regenerated_at: row.qr_token_regenerated_at,
    },
  };
}

// ─── Phase 3 — QR landing evidence summary ─────────────────────────────────
//
// Best-effort counts pulled live from real tables. Each query is wrapped so a
// single failure (RLS denial, network blip) does not crash the QR landing
// page — the failing card just shows "Not available" in the UI.

export type QrAssetContext = {
  openRequestsCount: number | null;
  openWorkOrdersCount: number | null;
  upcomingOrOverduePmCount: number | null;
  overduePmCount: number | null;
  calibrationDueState: 'overdue' | 'due_soon' | 'current' | 'no_history' | 'unavailable';
  lastWorkOrderStatus: string | null;
  errors: string[];
};

const ACTIVE_PM_STATUSES = ['scheduled', 'in_progress', 'overdue', 'deferred'];

const CALIBRATION_DUE_SOON_DAYS = 30;

export async function getQrAssetContext(assetId: string, client?: Client): Promise<QrAssetContext> {
  const supabase = await resolveClient(client);
  const errors: string[] = [];

  const [reqRes, woRes, latestWoRes, pmRes, calRes] = await Promise.all([
    supabase
      .from('maintenance_requests')
      .select('id', { count: 'exact', head: true })
      .eq('asset_id', assetId)
      .in('status', [...OPEN_MAINTENANCE_REQUEST_STATUSES]),
    supabase
      .from('work_orders')
      .select('id', { count: 'exact', head: true })
      .eq('asset_id', assetId)
      .in('status', [...OPEN_WORK_ORDER_STATUSES]),
    supabase
      .from('work_orders')
      .select('status, created_at')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('pm_schedules')
      .select('id, status, scheduled_date')
      .eq('asset_id', assetId)
      .in('status', ACTIVE_PM_STATUSES)
      .limit(200),
    supabase
      .from('calibration_records')
      .select('next_due_date')
      .eq('asset_id', assetId)
      .order('calibration_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (reqRes.error) errors.push('open requests');
  if (woRes.error) errors.push('open work orders');
  if (pmRes.error) errors.push('pm schedule');
  if (calRes.error) errors.push('calibration');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pmRows = (pmRes.data ?? []) as Array<{ status: string | null; scheduled_date: string | null }>;
  let overduePm = 0;
  for (const row of pmRows) {
    if (row.status === 'overdue') {
      overduePm += 1;
      continue;
    }
    if (row.status === 'scheduled' && row.scheduled_date) {
      const due = new Date(row.scheduled_date);
      due.setHours(0, 0, 0, 0);
      if (due < today) overduePm += 1;
    }
  }

  let calibrationDueState: QrAssetContext['calibrationDueState'] = 'unavailable';
  if (!calRes.error) {
    const due = (calRes.data as { next_due_date: string | null } | null)?.next_due_date ?? null;
    if (!calRes.data) {
      calibrationDueState = 'no_history';
    } else if (!due) {
      calibrationDueState = 'no_history';
    } else {
      const dueDate = new Date(due);
      dueDate.setHours(0, 0, 0, 0);
      const diffDays = Math.round((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) calibrationDueState = 'overdue';
      else if (diffDays <= CALIBRATION_DUE_SOON_DAYS) calibrationDueState = 'due_soon';
      else calibrationDueState = 'current';
    }
  }

  return {
    openRequestsCount: reqRes.error ? null : reqRes.count ?? 0,
    openWorkOrdersCount: woRes.error ? null : woRes.count ?? 0,
    upcomingOrOverduePmCount: pmRes.error ? null : pmRows.length,
    overduePmCount: pmRes.error ? null : overduePm,
    calibrationDueState,
    lastWorkOrderStatus: latestWoRes.error
      ? null
      : ((latestWoRes.data as { status: string | null } | null)?.status ?? null),
    errors,
  };
}

// ─── Phase 2 — label-asset fetchers ────────────────────────────────────────

const LABEL_ASSET_SELECT = `
  id,
  asset_code,
  name,
  qr_token,
  qr_label_status,
  qr_generated_at,
  qr_label_printed_at,
  qr_label_attached_at,
  qr_label_replaced_at,
  qr_token_regenerated_at,
  departments ( name ),
  equipment_categories ( name, criticality_level )
`;

type RawLabelAsset = {
  id: string;
  asset_code: string;
  name: string;
  qr_token: string | null;
  qr_label_status: QrLabelStatus | null;
  qr_generated_at: string | null;
  qr_label_printed_at: string | null;
  qr_label_attached_at: string | null;
  qr_label_replaced_at: string | null;
  qr_token_regenerated_at: string | null;
  departments: { name: string | null } | { name: string | null }[] | null;
  equipment_categories:
    | { name: string | null; criticality_level: string | null }
    | { name: string | null; criticality_level: string | null }[]
    | null;
};

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function toLabelAsset(row: RawLabelAsset): QrLabelAsset {
  const dept = pickOne(row.departments);
  const cat = pickOne(row.equipment_categories);
  return {
    id: row.id,
    asset_code: row.asset_code,
    name: row.name,
    department_name: dept?.name ?? null,
    category_name: cat?.name ?? null,
    criticality_level: cat?.criticality_level ?? null,
    qr_token: row.qr_token,
    qr_label_status: (row.qr_label_status ?? 'not_generated') as QrLabelStatus,
    qr_generated_at: row.qr_generated_at,
    qr_label_printed_at: row.qr_label_printed_at,
    qr_label_attached_at: row.qr_label_attached_at,
    qr_label_replaced_at: row.qr_label_replaced_at,
    qr_token_regenerated_at: row.qr_token_regenerated_at,
  };
}

export type LabelAssetsFilter = {
  status?: QrLabelFilter;
  search?: string;
  ids?: string[];
};

export async function getQrLabelAssets(
  filter: LabelAssetsFilter = {},
  client?: Client,
): Promise<QrLabelAsset[]> {
  const supabase = await resolveClient(client);
  let query = supabase
    .from('equipment_assets')
    .select(LABEL_ASSET_SELECT)
    .is('deleted_at', null);

  if (filter.ids && filter.ids.length > 0) {
    query = query.in('id', filter.ids);
  }

  if (filter.status && filter.status !== 'all') {
    if (filter.status === 'missing_token') {
      query = query.or('qr_token.is.null,qr_label_status.eq.not_generated');
    } else {
      query = query.eq('qr_label_status', filter.status);
    }
  }

  if (filter.search && filter.search.trim().length > 0) {
    const term = filter.search.trim();
    query = query.or(`name.ilike.%${term}%,asset_code.ilike.%${term}%`);
  }

  const { data, error } = await query.order('asset_code', { ascending: true }).limit(2000);
  if (error) {
    console.error('[qr.getQrLabelAssets]', error.message);
    return [];
  }
  return (data as unknown as RawLabelAsset[]).map(toLabelAsset);
}

export async function getQrLabelAsset(
  assetId: string,
  client?: Client,
): Promise<QrLabelAsset | null> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase
    .from('equipment_assets')
    .select(LABEL_ASSET_SELECT)
    .eq('id', assetId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) return null;
  return toLabelAsset(data as unknown as RawLabelAsset);
}

// ─── Bulk lifecycle helpers (Phase 2) ──────────────────────────────────────

export type BulkLabelUpdateResult = {
  updated: number;
  skipped: number;
};

async function bulkSetLabelStatus(
  supabase: Client,
  assetIds: string[],
  status: QrLabelStatus,
  extraFields: Record<string, unknown> = {},
): Promise<BulkLabelUpdateResult> {
  if (assetIds.length === 0) return { updated: 0, skipped: 0 };

  const { data: existing, error: lookupError } = await supabase
    .from('equipment_assets')
    .select('id, qr_token')
    .in('id', assetIds)
    .is('deleted_at', null);

  if (lookupError) throw new Error(lookupError.message);

  const rows = (existing ?? []) as Array<{ id: string; qr_token: string | null }>;
  const eligible = rows.filter((row) => !!row.qr_token).map((row) => row.id);
  const skipped = assetIds.length - eligible.length;

  if (eligible.length === 0) return { updated: 0, skipped };

  const { error: updateError } = await supabase
    .from('equipment_assets')
    .update({ qr_label_status: status, ...extraFields } as never)
    .in('id', eligible);

  if (updateError) throw new Error(updateError.message);
  return { updated: eligible.length, skipped };
}

export async function bulkMarkQrLabelsPrinted(
  assetIds: string[],
  client?: Client,
): Promise<BulkLabelUpdateResult> {
  const supabase = await resolveClient(client);
  return bulkSetLabelStatus(supabase, assetIds, 'printed', {
    qr_label_printed_at: new Date().toISOString(),
  });
}

export async function bulkMarkQrLabelsAttached(
  assetIds: string[],
  client?: Client,
): Promise<BulkLabelUpdateResult> {
  const supabase = await resolveClient(client);
  return bulkSetLabelStatus(supabase, assetIds, 'attached', {
    qr_label_attached_at: new Date().toISOString(),
  });
}

export async function bulkMarkQrLabelsNeedsReplacement(
  assetIds: string[],
  client?: Client,
): Promise<BulkLabelUpdateResult> {
  const supabase = await resolveClient(client);
  return bulkSetLabelStatus(supabase, assetIds, 'needs_replacement');
}

// ─── Phase 6 — scan evidence + deduplication ──────────────────────────────

const QR_SCAN_SELECT = `
  id,
  asset_id,
  scanned_by,
  role_name,
  scanned_at,
  scan_source,
  online_status,
  action_taken,
  metadata,
  created_at,
  equipment_assets (
    id,
    asset_code,
    name,
    department_id,
    qr_label_status,
    departments ( id, name )
  ),
  profiles!qr_security_events_scanner_profile_id_fkey (
    id,
    full_name,
    email
  )
`;

type RawQrScanRow = {
  id: string;
  asset_id: string;
  scanned_by: string | null;
  role_name: string | null;
  scanned_at: string;
  scan_source: string | null;
  online_status: string | null;
  action_taken: string | null;
  scan_status?: string | null;
  auth_user_id?: string | null;
  deduped_from_scan_id?: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  equipment_assets:
    | {
        id: string;
        asset_code: string | null;
        name: string | null;
        department_id: string | null;
        qr_label_status?: QrLabelStatus | null;
        departments: { id: string | null; name: string | null } | { id: string | null; name: string | null }[] | null;
      }
    | {
        id: string;
        asset_code: string | null;
        name: string | null;
        department_id: string | null;
        qr_label_status?: QrLabelStatus | null;
        departments: { id: string | null; name: string | null } | { id: string | null; name: string | null }[] | null;
      }[]
    | null;
  profiles:
    | { id: string; full_name: string | null; email: string | null }
    | { id: string; full_name: string | null; email: string | null }[]
    | null;
};

function toScanHistoryRow(row: RawQrScanRow): QrScanHistoryRow {
  const asset = pickOne(row.equipment_assets);
  const dept = pickOne(asset?.departments);
  const profile = pickOne(row.profiles);
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const metadataRoute = typeof metadata.route === 'string' ? metadata.route : null;

  return {
    id: row.id,
    asset_id: row.asset_id,
    asset_code: asset?.asset_code ?? null,
    asset_name: asset?.name ?? null,
    department_id: dept?.id ?? asset?.department_id ?? null,
    department_name: dept?.name ?? null,
    scanned_by: row.scanned_by,
    scanned_by_name: profile?.full_name || profile?.email || 'Unknown user',
    scanned_by_email: profile?.email ?? null,
    role_name: row.role_name,
    scanned_at: row.scanned_at,
    scan_source: row.scan_source,
    online_status: row.online_status,
    action_taken: row.action_taken,
    metadata_route: metadataRoute,
    created_at: row.created_at,
  };
}

function clampScanLimit(limit: number | null | undefined): number {
  if (!limit || !Number.isFinite(limit)) return 200;
  return Math.min(Math.max(Math.trunc(limit), 1), 2000);
}

export async function getQrScanHistory(
  filters: QrScanHistoryFilters = {},
  client?: Client,
): Promise<QrScanHistoryRow[]> {
  const supabase = await resolveClient(client);
  const limit = clampScanLimit(filters.limit);
  let query = supabase
    .from('equipment_qr_scans')
    .select(QR_SCAN_SELECT)
    .order('scanned_at', { ascending: false })
    .limit(limit);

  if (filters.assetId) query = query.eq('asset_id', filters.assetId);
  if (filters.role) query = query.eq('role_name', filters.role);
  if (filters.onlineStatus) query = query.eq('online_status', filters.onlineStatus);
  if (filters.scanSource) query = query.eq('scan_source', filters.scanSource);
  if (filters.actionTaken) query = query.eq('action_taken', filters.actionTaken);
  if (filters.dateFrom) query = query.gte('scanned_at', filters.dateFrom);
  if (filters.dateTo) query = query.lte('scanned_at', filters.dateTo);

  const { data, error } = await query;
  if (error) {
    console.error('[qr.getQrScanHistory]', error.message);
    return [];
  }

  let rows = ((data ?? []) as unknown as RawQrScanRow[]).map(toScanHistoryRow);
  if (filters.departmentId) {
    rows = rows.filter((row) => row.department_id === filters.departmentId);
  }
  return rows;
}

export async function getRecentAssetQrScans(
  assetId: string,
  limit = 10,
  client?: Client,
): Promise<QrScanHistoryRow[]> {
  return getQrScanHistory({ assetId, limit }, client);
}

export async function getAssetQrScanSummary(
  assetId: string,
  client?: Client,
): Promise<AssetQrScanSummary> {
  const supabase = await resolveClient(client);
  const [countRes, recentScans] = await Promise.all([
    supabase
      .from('equipment_qr_scans')
      .select('id', { count: 'exact', head: true })
      .eq('asset_id', assetId),
    getRecentAssetQrScans(assetId, 8, supabase),
  ]);

  const roles = Array.from(new Set(recentScans.map((scan) => scan.role_name).filter(Boolean) as string[]));
  const last = recentScans[0] ?? null;
  return {
    totalScans: countRes.count ?? 0,
    lastScannedAt: last?.scanned_at ?? null,
    lastScannedBy: last?.scanned_by_name ?? null,
    roles,
    recentScans,
  };
}

export async function shouldLogQrScan(
  params: {
    assetId: string;
    profileId?: string | null;
    actionTaken?: string | null;
    windowMinutes?: number;
  },
  client?: Client,
): Promise<{ shouldLog: boolean; existingScanId?: string | null }> {
  if (params.actionTaken !== 'open_qr_landing' || !params.profileId) {
    return { shouldLog: true };
  }

  const supabase = await resolveClient(client);
  const windowMinutes = params.windowMinutes ?? QR_SCAN_DEDUP_WINDOW_MINUTES;
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('equipment_qr_scans')
    .select('id')
    .eq('asset_id', params.assetId)
    .eq('scanned_by', params.profileId)
    .eq('action_taken', 'open_qr_landing')
    .gte('scanned_at', cutoff)
    .order('scanned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[qr.shouldLogQrScan] Dedup lookup failed:', error.message);
    return { shouldLog: true };
  }

  if (data?.id) return { shouldLog: false, existingScanId: data.id as string };
  return { shouldLog: true };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type LogQrSecurityEventParams = {
  token: string;
  scanStatus: QrSecurityScanStatus;
  assetId?: string | null;
  scannerProfileId?: string | null;
  authUserId?: string | null;
  roleName?: string | null;
  scanSource?: QrScanSource;
  onlineStatus?: QrOnlineStatus;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logQrSecurityEvent(params: LogQrSecurityEventParams, client?: Client) {
  try {
    const supabase = await resolveClient(client);
    const { data, error } = await supabase
      .from('qr_security_events')
      .insert({
        token_hash: tokenHash(params.token),
        masked_token: maskQrToken(params.token),
        scan_status: params.scanStatus,
        asset_id: params.assetId ?? null,
        scanner_profile_id: params.scannerProfileId ?? null,
        auth_user_id: params.authUserId ?? null,
        role_name: params.roleName ?? null,
        scan_source: params.scanSource ?? 'web',
        online_status: params.onlineStatus ?? 'online',
        user_agent: params.userAgent ?? null,
        metadata: params.metadata ?? {},
      } as never)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[qr.logSecurityEvent] Failed to record security event:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true, eventId: (data as { id?: string } | null)?.id ?? null };
  } catch (err) {
    console.error('[qr.logSecurityEvent] Threw:', err);
    return { success: false, error: 'Failed to record QR security event' };
  }
}

const QR_SECURITY_SELECT = `
  id,
  token_hash,
  masked_token,
  scan_status,
  asset_id,
  scanner_profile_id,
  auth_user_id,
  role_name,
  scan_source,
  online_status,
  user_agent,
  metadata,
  created_at,
  equipment_assets (
    id,
    asset_code,
    name
  ),
  profiles (
    id,
    full_name,
    email
  )
`;

type RawQrSecurityEventRow = {
  id: string;
  token_hash: string;
  masked_token: string;
  scan_status: string;
  asset_id: string | null;
  scanner_profile_id: string | null;
  auth_user_id: string | null;
  role_name: string | null;
  scan_source: string | null;
  online_status: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  equipment_assets: { id: string; asset_code: string | null; name: string | null } | { id: string; asset_code: string | null; name: string | null }[] | null;
  profiles: { id: string; full_name: string | null; email: string | null } | { id: string; full_name: string | null; email: string | null }[] | null;
};

function toSecurityEventRow(row: RawQrSecurityEventRow): QrSecurityEventRow {
  const asset = pickOne(row.equipment_assets);
  const profile = pickOne(row.profiles);
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return {
    id: row.id,
    token_hash: row.token_hash,
    masked_token: row.masked_token,
    scan_status: row.scan_status,
    asset_id: row.asset_id,
    asset_code: asset?.asset_code ?? null,
    asset_name: asset?.name ?? null,
    scanner_profile_id: row.scanner_profile_id,
    scanner_name: profile?.full_name ?? null,
    scanner_email: profile?.email ?? null,
    auth_user_id: row.auth_user_id,
    role_name: row.role_name,
    scan_source: row.scan_source,
    online_status: row.online_status,
    user_agent: row.user_agent,
    metadata_route: typeof metadata.route === 'string' ? metadata.route : null,
    created_at: row.created_at,
  };
}

export async function getQrSecurityEvents(
  filters: { status?: string; limit?: number } = {},
  client?: Client,
): Promise<QrSecurityEventRow[]> {
  const supabase = await resolveClient(client);
  let query = supabase
    .from('qr_security_events')
    .select(QR_SECURITY_SELECT)
    .order('created_at', { ascending: false })
    .limit(clampScanLimit(filters.limit));
  if (filters.status) query = query.eq('scan_status', filters.status);
  const { data, error } = await query;
  if (error) {
    console.error('[qr.getQrSecurityEvents]', error.message);
    return [];
  }
  return ((data ?? []) as unknown as RawQrSecurityEventRow[]).map(toSecurityEventRow);
}

export async function getQrAssetScanMetrics(
  client?: Client,
): Promise<Record<string, QrAssetScanMetric>> {
  const scans = await getQrScanHistory({ limit: 10000 }, client);
  const since30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const metrics: Record<string, QrAssetScanMetric> = {};

  for (const scan of scans) {
    const existing = metrics[scan.asset_id] ?? {
      assetId: scan.asset_id,
      totalScans: 0,
      lastScannedAt: null,
      lastScannedByRole: null,
      scansLast30Days: 0,
    };
    existing.totalScans += 1;
    if (!existing.lastScannedAt || scan.scanned_at > existing.lastScannedAt) {
      existing.lastScannedAt = scan.scanned_at;
      existing.lastScannedByRole = scan.role_name;
    }
    if (new Date(scan.scanned_at).getTime() >= since30) {
      existing.scansLast30Days += 1;
    }
    metrics[scan.asset_id] = existing;
  }

  return metrics;
}

function countGrouped(rows: QrScanHistoryRow[], key: (row: QrScanHistoryRow) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = key(row) || 'Unknown';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getAssetsNeverScanned(client?: Client): Promise<QrLabelAsset[]> {
  const supabase = await resolveClient(client);
  const [assets, scans] = await Promise.all([
    getQrLabelAssets({}, supabase),
    getQrScanHistory({ limit: 10000 }, supabase),
  ]);
  const scannedAssetIds = new Set(scans.map((scan) => scan.asset_id));
  return assets.filter((asset) => !scannedAssetIds.has(asset.id));
}

export async function getAttachedAssetsNeverScanned(client?: Client): Promise<QrLabelAsset[]> {
  const neverScanned = await getAssetsNeverScanned(client);
  return neverScanned.filter((asset) => !!asset.qr_token && asset.qr_label_status === 'attached');
}

export async function getMostScannedAssets(limit = 10, client?: Client) {
  const scans = await getQrScanHistory({ limit: 10000 }, client);
  const counts = new Map<string, { assetId: string; assetCode: string | null; assetName: string | null; count: number }>();
  for (const scan of scans) {
    const current = counts.get(scan.asset_id) ?? {
      assetId: scan.asset_id,
      assetCode: scan.asset_code,
      assetName: scan.asset_name,
      count: 0,
    };
    current.count += 1;
    counts.set(scan.asset_id, current);
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function getQrScansByRole(client?: Client) {
  return countGrouped(await getQrScanHistory({ limit: 10000 }, client), (scan) => scan.role_name);
}

export async function getQrScansByDepartment(client?: Client) {
  return countGrouped(await getQrScanHistory({ limit: 10000 }, client), (scan) => scan.department_name);
}

export async function getQrScanCoverageStats(client?: Client): Promise<QrScanCoverageStats> {
  const supabase = await resolveClient(client);
  const [scans, attachedNeverScannedAssets] = await Promise.all([
    getQrScanHistory({ limit: 10000 }, supabase),
    getAttachedAssetsNeverScanned(supabase),
  ]);
  const since7 = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const mostScanned = await getMostScannedAssets(1, supabase);
  const riskyStatus = new Set<QrLabelStatus>(['needs_replacement', 'revoked']);
  const riskyAssetIds = new Set(
    (await getQrLabelAssets({}, supabase))
      .filter((asset) => riskyStatus.has(asset.qr_label_status))
      .map((asset) => asset.id),
  );
  const since30 = Date.now() - 30 * 24 * 60 * 60 * 1000;

  return {
    totalScans: scans.length,
    scansLast7Days: scans.filter((scan) => new Date(scan.scanned_at).getTime() >= since7).length,
    attachedAssetsNeverScanned: attachedNeverScannedAssets.length,
    mostScannedAsset: mostScanned[0] ?? null,
    scansByRole: countGrouped(scans, (scan) => scan.role_name).slice(0, 8),
    scansByDepartment: countGrouped(scans, (scan) => scan.department_name).slice(0, 8),
    recentScans: scans.slice(0, 12),
    attachedNeverScannedAssets: attachedNeverScannedAssets.slice(0, 12),
    revokedOrNeedsReplacementRecentScans: scans
      .filter((scan) => riskyAssetIds.has(scan.asset_id) && new Date(scan.scanned_at).getTime() >= since30)
      .slice(0, 12),
  };
}

// ─── Scan logging (deduped for Phase 6 page-render scans) ─────────────────

export type LogQrScanParams = {
  assetId: string;
  scannedBy?: string | null;
  authUserId?: string | null;
  roleName?: string | null;
  scanSource?: QrScanSource;
  onlineStatus?: QrOnlineStatus;
  userAgent?: string | null;
  actionTaken?: string | null;
  metadata?: Record<string, unknown>;
  token?: string | null;
};

export async function logQrScan(params: LogQrScanParams, client?: Client) {
  try {
    const supabase = await resolveClient(client);
    const dedup = await shouldLogQrScan(
      {
        assetId: params.assetId,
        profileId: params.scannedBy ?? null,
        actionTaken: params.actionTaken ?? null,
        windowMinutes: QR_SCAN_DEDUP_WINDOW_MINUTES,
      },
      supabase,
    );
    if (!dedup.shouldLog) {
      if (params.token) {
        await logQrSecurityEvent(
          {
            token: params.token,
            scanStatus: 'deduped',
            assetId: params.assetId,
            scannerProfileId: params.scannedBy ?? null,
            authUserId: params.authUserId ?? null,
            roleName: params.roleName ?? null,
            scanSource: params.scanSource ?? 'web',
            onlineStatus: params.onlineStatus ?? 'online',
            userAgent: params.userAgent ?? null,
            metadata: {
              ...(params.metadata ?? {}),
              route: (params.metadata ?? {}).route ?? 'qr.landing.v2',
              deduped_from_scan_id: dedup.existingScanId ?? null,
            },
          },
          supabase,
        );
      }
      return { success: true, deduped: true, existingScanId: dedup.existingScanId ?? null };
    }

    const { data, error } = await supabase.from('equipment_qr_scans').insert({
      asset_id: params.assetId,
      scanned_by: params.scannedBy ?? null,
      auth_user_id: params.authUserId ?? null,
      scan_status: 'valid',
      role_name: params.roleName ?? null,
      scan_source: params.scanSource ?? 'web',
      online_status: params.onlineStatus ?? 'online',
      user_agent: params.userAgent ?? null,
      action_taken: params.actionTaken ?? null,
      metadata: params.metadata ?? {},
    } as never).select('id').maybeSingle();
    if (error) {
      console.error('[qr.logScan] Failed to record scan:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true, deduped: false, scanId: (data as { id?: string } | null)?.id ?? null };
  } catch (err) {
    console.error('[qr.logScan] Threw:', err);
    return { success: false, error: 'Failed to record scan' };
  }
}
