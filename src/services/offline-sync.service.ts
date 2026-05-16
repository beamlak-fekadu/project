import { createClient } from '@/lib/supabase/server';
import type { OfflineConflictDetail } from '@/types/offline';

export type OfflineSyncEventRow = {
  id: string;
  client_action_id: string;
  actor_user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action_type: string;
  payload: unknown;
  sync_status: string;
  created_at: string;
  synced_at: string | null;
  // Phase 3 first-class columns (migration 00046). NULL on rows written before
  // the migration; consumers should fall back to payload-derived values.
  reported_status?: string | null;
  resolution_status?: string | null;
  conflict_type?: string | null;
  conflict_reason?: string | null;
  error_message?: string | null;
  role_name?: string | null;
  source_route?: string | null;
  asset_id?: string | null;
  retry_count?: number | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
};

export type OfflineSyncEventEnriched = OfflineSyncEventRow & {
  reported_status: string;
  role_name: string | null;
  source_route: string | null;
  conflict_reason: string | null;
  conflict_detail: OfflineConflictDetail | null;
  error_message: string | null;
  queued_at: string | null;
  asset_id: string | null;
  resolution_status: string | null;
  retry_count: number | null;
  actor_full_name: string | null;
  actor_email: string | null;
};

export type OfflineSyncServerSummary = {
  recentEvents: OfflineSyncEventEnriched[];
  recentFailedEvents: OfflineSyncEventEnriched[];
  inferredConflictEvents: OfflineSyncEventEnriched[];
  actionsByRole: Array<{ roleName: string; count: number }>;
  actionsByActionType: Array<{ actionType: string; count: number }>;
  actionsByUser: Array<{ profileId: string; displayName: string; count: number }>;
  reportedStatusCounts: Array<{ status: string; count: number }>;
  totalEvents: number;
  schemaSupportsConflictStatus: false;
  schemaNote: string;
};

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function pickString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function pickNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function asConflictDetail(value: unknown): OfflineConflictDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.conflict_type !== 'string' || typeof obj.conflict_reason !== 'string') return null;
  return obj as unknown as OfflineConflictDetail;
}

export function enrichSyncEvent(row: OfflineSyncEventRow, profileMap: Map<string, { full_name: string | null; email: string | null }> = new Map()): OfflineSyncEventEnriched {
  const payload = payloadObject(row.payload);
  // Prefer first-class columns (Phase 3, migration 00046) over payload mirrors.
  // Payload remains the fallback for rows written by Phase 1/Phase 2 callers.
  const reportedStatus = row.reported_status ?? pickString(payload, 'reported_status') ?? row.sync_status;
  const actorProfile = row.actor_user_id ? profileMap.get(row.actor_user_id) ?? null : null;
  const conflictDetail = asConflictDetail(payload.conflict_detail);
  const conflictType = row.conflict_type ?? conflictDetail?.conflict_type ?? null;
  return {
    ...row,
    reported_status: reportedStatus,
    role_name: row.role_name ?? pickString(payload, 'role_name'),
    source_route: row.source_route ?? pickString(payload, 'source_route'),
    conflict_reason: row.conflict_reason ?? pickString(payload, 'conflict_reason'),
    conflict_detail: conflictDetail ?? (conflictType ? {
      conflict_type: conflictType as OfflineConflictDetail['conflict_type'],
      conflict_reason: row.conflict_reason ?? pickString(payload, 'conflict_reason') ?? '',
      created_at: row.created_at,
    } : null),
    error_message: row.error_message ?? pickString(payload, 'error_message'),
    queued_at: pickString(payload, 'queued_at'),
    asset_id: row.asset_id ?? pickString(payload, 'asset_id'),
    resolution_status: row.resolution_status ?? pickString(payload, 'resolution_status'),
    retry_count: row.retry_count ?? pickNumber(payload, 'retry_count'),
    actor_full_name: actorProfile?.full_name ?? null,
    actor_email: actorProfile?.email ?? null,
  };
}

export async function getOfflineSyncServerSummary(): Promise<OfflineSyncServerSummary> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('offline_sync_events')
    .select('id, client_action_id, actor_user_id, entity_type, entity_id, action_type, payload, sync_status, created_at, synced_at, reported_status, resolution_status, conflict_type, conflict_reason, error_message, role_name, source_route, asset_id, retry_count, resolved_by, resolved_at')
    .order('created_at', { ascending: false })
    .limit(250);

  const rows = ((data ?? []) as unknown) as OfflineSyncEventRow[];
  const actorIds = Array.from(new Set(rows.map((row) => row.actor_user_id).filter(Boolean))) as string[];
  const profileMap = new Map<string, { full_name: string | null; email: string | null }>();
  if (actorIds.length > 0) {
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', actorIds);
    for (const row of (profileRows ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      profileMap.set(row.id, { full_name: row.full_name, email: row.email });
    }
  }
  const enriched = rows.map((row) => enrichSyncEvent(row, profileMap));

  const roleCounts = new Map<string, number>();
  const actionCounts = new Map<string, number>();
  const userCounts = new Map<string, { displayName: string; count: number }>();
  const statusCounts = new Map<string, number>();

  for (const row of enriched) {
    const roleName = row.role_name ?? 'Unknown role';
    roleCounts.set(roleName, (roleCounts.get(roleName) ?? 0) + 1);
    actionCounts.set(row.action_type, (actionCounts.get(row.action_type) ?? 0) + 1);
    if (row.actor_user_id) {
      const display = row.actor_full_name ?? row.actor_email ?? row.actor_user_id;
      const current = userCounts.get(row.actor_user_id);
      userCounts.set(row.actor_user_id, { displayName: display, count: (current?.count ?? 0) + 1 });
    }
    statusCounts.set(row.reported_status, (statusCounts.get(row.reported_status) ?? 0) + 1);
  }

  return {
    recentEvents: enriched.slice(0, 50),
    recentFailedEvents: enriched.filter((row) => row.sync_status === 'failed').slice(0, 50),
    inferredConflictEvents: enriched.filter((row) => row.conflict_reason !== null || row.conflict_detail !== null).slice(0, 50),
    actionsByRole: Array.from(roleCounts.entries())
      .map(([roleName, count]) => ({ roleName, count }))
      .sort((a, b) => b.count - a.count),
    actionsByActionType: Array.from(actionCounts.entries())
      .map(([actionType, count]) => ({ actionType, count }))
      .sort((a, b) => b.count - a.count),
    actionsByUser: Array.from(userCounts.entries())
      .map(([profileId, value]) => ({ profileId, displayName: value.displayName, count: value.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 25),
    reportedStatusCounts: Array.from(statusCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    totalEvents: enriched.length,
    schemaSupportsConflictStatus: false,
    schemaNote:
      'offline_sync_events currently exposes pending/synced/failed only. Phase 3 stores reported_status (queued/syncing/conflict/under_review/resolved_discarded/resolved_synced), conflict_detail, resolution_status, role_name, source_route, asset_id, masked_qr_token, retry_count, and error_message inside payload.',
  };
}

export async function listOfflineSyncEvents(params: { limit?: number } = {}): Promise<OfflineSyncEventEnriched[]> {
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  const supabase = await createClient();
  const { data } = await supabase
    .from('offline_sync_events')
    .select('id, client_action_id, actor_user_id, entity_type, entity_id, action_type, payload, sync_status, created_at, synced_at, reported_status, resolution_status, conflict_type, conflict_reason, error_message, role_name, source_route, asset_id, retry_count, resolved_by, resolved_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = ((data ?? []) as unknown) as OfflineSyncEventRow[];
  const actorIds = Array.from(new Set(rows.map((row) => row.actor_user_id).filter(Boolean))) as string[];
  const profileMap = new Map<string, { full_name: string | null; email: string | null }>();
  if (actorIds.length > 0) {
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', actorIds);
    for (const row of (profileRows ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      profileMap.set(row.id, { full_name: row.full_name, email: row.email });
    }
  }
  return rows.map((row) => enrichSyncEvent(row, profileMap));
}
