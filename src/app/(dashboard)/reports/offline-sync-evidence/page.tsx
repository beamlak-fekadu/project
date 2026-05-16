import { requireRole } from '@/lib/auth/helpers';
import { Badge, PageHeader } from '@/components/ui';
import { getOfflineSyncServerSummary, listOfflineSyncEvents } from '@/services/offline-sync.service';
import OfflineSyncEvidenceClient from './OfflineSyncEvidenceClient';

export const dynamic = 'force-dynamic';

export default async function OfflineSyncEvidenceReportPage() {
  await requireRole(['admin', 'bme_head']);
  const [summary, events] = await Promise.all([
    getOfflineSyncServerSummary(),
    listOfflineSyncEvents({ limit: 500 }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offline Sync Evidence Report"
        description="Server-side snapshot of offline activity, conflicts, and resolutions. Generated from the offline_sync_events table; no synthetic data."
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Offline Sync Evidence' }]}
        actions={<Badge variant="purple">Phase 3 Evidence</Badge>}
      />
      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
        Evidence is limited to actions recorded after device sync. Discarded local actions are recorded only if the user
        reviewed them in Sync Review Center while online. Schema note: {summary.schemaNote}
      </p>
      <OfflineSyncEvidenceClient summary={summary} events={events} />
    </div>
  );
}
