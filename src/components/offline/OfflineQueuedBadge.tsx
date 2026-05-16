'use client';

import Badge from '@/components/ui/Badge';
import type { OfflineSyncStatus } from '@/types/offline';

type Props = {
  status: OfflineSyncStatus;
};

export default function OfflineQueuedBadge({ status }: Props) {
  if (status === 'queued') return <Badge variant="info">Queued locally</Badge>;
  if (status === 'syncing') return <Badge variant="purple">Pending sync</Badge>;
  if (status === 'synced') return <Badge variant="success">Synced</Badge>;
  if (status === 'failed') return <Badge variant="warning">Sync failed</Badge>;
  return <Badge variant="error">Needs review</Badge>;
}
