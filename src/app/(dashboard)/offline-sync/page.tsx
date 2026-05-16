import { requireRole } from '@/lib/auth/helpers';
import { PageHeader, Badge } from '@/components/ui';
import { getOfflineSyncServerSummary, listOfflineSyncEvents } from '@/services/offline-sync.service';
import SyncReviewCenterClient from './SyncReviewCenterClient';

export const dynamic = 'force-dynamic';

export default async function SyncReviewCenterPage() {
  const profile = await requireRole(['admin', 'bme_head']);
  const [summary, events] = await Promise.all([
    getOfflineSyncServerSummary(),
    listOfflineSyncEvents({ limit: 250 }),
  ]);

  const isDeveloper = profile.roleNames.includes('developer');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sync Review Center"
        description="Review, retry, and resolve offline actions that need attention across this hospital's BMERMS devices."
        actions={<Badge variant="purple">{isDeveloper ? 'Developer' : 'BME Head / Admin'}</Badge>}
      />
      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
        Sync Review Center is restricted to BME Head, Admin, and Developer roles. Local queue rows shown below are
        scoped to this device only. Server sync events are visible across users. No raw payload editing is
        permitted; resolve a draft by retrying after server-side issues are fixed, or by discarding the local
        action.
      </p>
      <SyncReviewCenterClient
        serverSummary={summary}
        serverEvents={events}
        isDeveloper={isDeveloper}
        currentProfileId={profile.id}
      />
    </div>
  );
}
