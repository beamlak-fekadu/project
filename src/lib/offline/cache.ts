import {
  clearAllOfflineReadCache,
  clearOfflineReadCacheByProfile,
  deleteOfflineReadCacheRecord,
  dispatchOfflineCacheChanged,
  getAllOfflineReadCacheRecords,
  getOfflineReadCacheRecord,
  isIndexedDbAvailable,
  putOfflineReadCacheRecord,
  type OfflineReadCacheRecord,
} from './db';

export const OFFLINE_CACHE_VERSION = 1;
export const DEFAULT_CACHE_TTL_MINUTES = 12 * 60; // 12 hours

export type OfflineCacheScope = {
  profileId: string;
  roleName: string;
  departmentId?: string | null;
};

export type OfflineCacheMetadata = {
  sourceRoute?: string | null;
  expiresAt?: string | null;
  version?: number;
};

export type CachedReadView<T> = {
  data: T;
  cachedAt: string;
  expiresAt: string | null;
  sourceRoute: string | null;
  isStale: boolean;
  ageMinutes: number;
  scope: OfflineCacheScope;
};

export type CacheSummaryEntry = {
  cacheKey: string;
  profileId: string;
  roleName: string;
  departmentId: string | null;
  cachedAt: string;
  expiresAt: string | null;
  isStale: boolean;
  ageMinutes: number;
  sourceRoute: string | null;
};

export type CacheSummary = {
  total: number;
  entries: CacheSummaryEntry[];
  byProfile: Array<{ profileId: string; count: number }>;
  byRole: Array<{ roleName: string; count: number }>;
};

function deviceFingerprint() {
  if (typeof window === 'undefined') return 'server';
  return 'web';
}

export function buildStorageKey(scope: OfflineCacheScope, cacheKey: string) {
  const dept = scope.departmentId ?? 'no-dept';
  return `${deviceFingerprint()}::${scope.profileId}::${scope.roleName}::${dept}::${cacheKey}`;
}

function nowIso() {
  return new Date().toISOString();
}

function ageMinutes(cachedAt: string) {
  const ms = Date.now() - new Date(cachedAt).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

export function isCacheFresh(record: { cached_at: string; expires_at: string | null }) {
  if (record.expires_at) {
    return new Date(record.expires_at).getTime() > Date.now();
  }
  return ageMinutes(record.cached_at) < DEFAULT_CACHE_TTL_MINUTES;
}

export async function saveOfflineReadCache<T>(
  cacheKey: string,
  data: T,
  scope: OfflineCacheScope,
  metadata: OfflineCacheMetadata = {},
): Promise<CachedReadView<T> | null> {
  if (!isIndexedDbAvailable()) return null;
  try {
    JSON.stringify(data);
  } catch {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[offline-cache] Refused to cache non-JSON-safe data for ${cacheKey}`);
    }
    return null;
  }
  const cachedAt = nowIso();
  const record: OfflineReadCacheRecord<T> = {
    storage_key: buildStorageKey(scope, cacheKey),
    cache_key: cacheKey,
    profile_id: scope.profileId,
    role_name: scope.roleName,
    department_id: scope.departmentId ?? null,
    data,
    cached_at: cachedAt,
    expires_at: metadata.expiresAt ?? null,
    source_route: metadata.sourceRoute ?? null,
    version: metadata.version ?? OFFLINE_CACHE_VERSION,
  };
  await putOfflineReadCacheRecord(record);
  dispatchOfflineCacheChanged();
  return {
    data,
    cachedAt,
    expiresAt: record.expires_at,
    sourceRoute: record.source_route,
    isStale: false,
    ageMinutes: 0,
    scope,
  };
}

export async function getOfflineReadCache<T>(
  cacheKey: string,
  scope: OfflineCacheScope,
): Promise<CachedReadView<T> | null> {
  if (!isIndexedDbAvailable()) return null;
  const record = await getOfflineReadCacheRecord<T>(buildStorageKey(scope, cacheKey));
  if (!record) return null;
  if (record.profile_id !== scope.profileId || record.role_name !== scope.roleName) return null;
  if ((record.department_id ?? null) !== (scope.departmentId ?? null)) return null;
  return {
    data: record.data,
    cachedAt: record.cached_at,
    expiresAt: record.expires_at,
    sourceRoute: record.source_route,
    isStale: !isCacheFresh(record),
    ageMinutes: ageMinutes(record.cached_at),
    scope,
  };
}

export async function clearOfflineReadCache(scope?: OfflineCacheScope, cacheKey?: string) {
  if (!isIndexedDbAvailable()) return;
  if (scope && cacheKey) {
    await deleteOfflineReadCacheRecord(buildStorageKey(scope, cacheKey));
  } else if (scope) {
    await clearOfflineReadCacheByProfile(scope.profileId);
  } else {
    await clearAllOfflineReadCache();
  }
  dispatchOfflineCacheChanged();
}

export async function getCacheSummary(): Promise<CacheSummary> {
  if (!isIndexedDbAvailable()) {
    return { total: 0, entries: [], byProfile: [], byRole: [] };
  }
  const records = await getAllOfflineReadCacheRecords();
  const entries: CacheSummaryEntry[] = records.map((record) => ({
    cacheKey: record.cache_key,
    profileId: record.profile_id,
    roleName: record.role_name,
    departmentId: record.department_id,
    cachedAt: record.cached_at,
    expiresAt: record.expires_at,
    isStale: !isCacheFresh(record),
    ageMinutes: ageMinutes(record.cached_at),
    sourceRoute: record.source_route,
  }));
  const profileCounts = new Map<string, number>();
  const roleCounts = new Map<string, number>();
  for (const entry of entries) {
    profileCounts.set(entry.profileId, (profileCounts.get(entry.profileId) ?? 0) + 1);
    roleCounts.set(entry.roleName, (roleCounts.get(entry.roleName) ?? 0) + 1);
  }
  return {
    total: entries.length,
    entries: entries.sort((a, b) => b.cachedAt.localeCompare(a.cachedAt)),
    byProfile: Array.from(profileCounts.entries()).map(([profileId, count]) => ({ profileId, count })),
    byRole: Array.from(roleCounts.entries()).map(([roleName, count]) => ({ roleName, count })),
  };
}

export function formatCacheAge(cachedAt: string | null | undefined): string {
  if (!cachedAt) return 'Not cached yet';
  const minutes = ageMinutes(cachedAt);
  if (minutes < 1) return 'Cached just now';
  if (minutes === 1) return 'Cached 1 minute ago';
  if (minutes < 60) return `Cached ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return 'Cached 1 hour ago';
  if (hours < 24) return `Cached ${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Cached 1 day ago' : `Cached ${days} days ago`;
}

export type RoleCachedView =
  | 'technician.assigned_work'
  | 'technician.recent_qr_scans'
  | 'department.equipment'
  | 'department.my_requests'
  | 'department.requests'
  | 'store.stock_list'
  | 'store.maintenance_blockers'
  | 'viewer.executive_summary'
  | 'bme_head.operational_summary';

export const ROLE_CACHEABLE_VIEWS: Record<string, RoleCachedView[]> = {
  technician: ['technician.assigned_work', 'technician.recent_qr_scans'],
  department_head: ['department.equipment', 'department.my_requests', 'department.requests'],
  department_user: ['department.equipment', 'department.my_requests'],
  store_user: ['store.stock_list', 'store.maintenance_blockers'],
  viewer: ['viewer.executive_summary'],
  bme_head: ['bme_head.operational_summary'],
  admin: ['bme_head.operational_summary'],
};
