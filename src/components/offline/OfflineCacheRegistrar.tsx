'use client';

import { useEffect } from 'react';
import { saveOfflineReadCache, type OfflineCacheScope } from '@/lib/offline/cache';

type Props = {
  cacheKey: string;
  scope: OfflineCacheScope | null;
  data: unknown;
  sourceRoute?: string | null;
};

export default function OfflineCacheRegistrar({ cacheKey, scope, data, sourceRoute }: Props) {
  useEffect(() => {
    if (!scope) return;
    if (data === null || data === undefined) return;
    void saveOfflineReadCache(cacheKey, data, scope, { sourceRoute: sourceRoute ?? null }).catch(() => undefined);
  }, [cacheKey, data, scope, sourceRoute]);
  return null;
}
