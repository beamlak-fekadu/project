import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireRole } from '@/lib/auth/helpers';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';

export default async function ProcurementRequestDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const profile = await requireRole(['developer', 'admin', 'bme_head', 'store_user', 'viewer']);
  const canMutate = Boolean(profile.roleNames?.some((role: string) => ['developer', 'admin', 'bme_head', 'store_user'].includes(role)));
  const supabase = await createClient();

  const { data } = await supabase
    .from('procurement_requests')
    .select('id, request_number, title, justification, status, priority, expected_delivery_date, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();

  if (!data) {
    return (
      <div className="space-y-4">
        <Link href="/command" className="inline-flex items-center gap-1 text-sm text-violet-300"><ArrowLeft className="h-4 w-4" /> Command Center</Link>
        <p className="text-sm text-[var(--text-muted)]">Procurement request not found.</p>
      </div>
    );
  }

  const action = query.action;

  return (
    <div className="space-y-6">
      <Link href="/command/drilldown/procurement" className="inline-flex items-center gap-1 text-sm text-violet-300"><ArrowLeft className="h-4 w-4" /> Procurement queue</Link>
      <PageHeader title={`Procurement ${data.request_number ?? ''}`} description={data.title ?? 'Procurement request detail'} />
      {action && canMutate && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Requested action: {action === 'escalate' ? 'Escalate this procurement request' : 'Update procurement status'}.
        </div>
      )}
      <Card>
        <CardHeader><CardTitle>Request Evidence</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-xs text-[var(--text-muted)]">Request number</dt><dd className="font-medium">{data.request_number}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)]">Status</dt><dd><Badge variant="purple">{String(data.status ?? 'requested').replace(/_/g, ' ')}</Badge></dd></div>
            <div><dt className="text-xs text-[var(--text-muted)]">Priority</dt><dd>{data.priority ?? 'medium'}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)]">Expected delivery</dt><dd>{data.expected_delivery_date ? new Date(data.expected_delivery_date).toLocaleDateString() : 'TBD'}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)]">Created</dt><dd>{data.created_at ? new Date(data.created_at).toLocaleString() : '—'}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)]">Updated</dt><dd>{data.updated_at ? new Date(data.updated_at).toLocaleString() : '—'}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-[var(--text-muted)]">Justification</dt><dd className="whitespace-pre-wrap">{data.justification ?? 'No justification recorded.'}</dd></div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
