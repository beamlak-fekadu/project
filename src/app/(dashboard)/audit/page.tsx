import { requireRole } from '@/lib/auth/helpers';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Activity, CalendarClock, FileBarChart, KeyRound, Monitor, ShieldAlert } from 'lucide-react';
import { PageHeader, Badge, Card, StatCard } from '@/components/ui';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function paramValue(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function summarizeValues(value: unknown) {
  if (!value || typeof value !== 'object') return '—';
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return '—';
  return keys.slice(0, 4).join(', ') + (keys.length > 4 ? ` +${keys.length - 4} more` : '');
}

export default async function AuditLogPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireRole(['developer', 'admin', 'bme_head']);
  const params = await searchParams;
  const supabase = await createClient();

  const action = paramValue(params, 'action') ?? '';
  const entityType = paramValue(params, 'entity_type') ?? '';
  const userId = paramValue(params, 'user_id') ?? '';
  const dateFrom = paramValue(params, 'date_from') ?? '';
  const dateTo = paramValue(params, 'date_to') ?? '';
  const quick = paramValue(params, 'quick') ?? '';
  const page = Math.max(1, Number(paramValue(params, 'page') ?? 1) || 1);
  const pageSize = 25;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('audit_logs')
    .select('id, user_id, action, entity_type, entity_id, old_values, new_values, created_at, profiles(full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (action) query = query.ilike('action', `%${action}%`);
  if (entityType) query = query.eq('entity_type', entityType);
  if (userId) query = query.eq('user_id', userId);
  if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00`);
  if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59`);
  if (quick === 'security') query = query.or('entity_type.ilike.%role%,entity_type.ilike.%profile%,action.ilike.%security%,action.ilike.%role%');
  if (quick === 'data-changes') query = query.or('action.ilike.%create%,action.ilike.%update%,action.ilike.%delete%,action.ilike.%status%');
  if (quick === 'failed') query = query.or('action.ilike.%failed%,action.ilike.%blocked%,action.ilike.%reject%,action.ilike.%cancel%');
  if (quick === 'reports') query = query.or('entity_type.eq.reports,action.ilike.%report%');
  if (quick === 'high-risk') query = query.or('action.ilike.%role%,action.ilike.%delete%,action.ilike.%deactivate%,action.ilike.%condition%,action.ilike.%complete%,action.ilike.%status%,action.ilike.%report%');

  const [{ data: rows, count, error }, { data: profiles }, { data: entityTypes }] = await Promise.all([
    query,
    supabase.from('profiles').select('id, full_name, email').order('full_name', { ascending: true }),
    supabase.from('audit_logs').select('entity_type').limit(500),
  ]);

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
  const uniqueEntityTypes = [...new Set((entityTypes ?? []).map((row) => row.entity_type as string).filter(Boolean))].sort();
  const visibleRows = rows ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const weekAgoDate = new Date();
  weekAgoDate.setDate(weekAgoDate.getDate() - 7);
  const weekAgo = weekAgoDate.toISOString();
  const todayEvents = visibleRows.filter((row) => String(row.created_at).startsWith(today)).length;
  const weekEvents = visibleRows.filter((row) => String(row.created_at) >= weekAgo).length;
  const roleSecurityEvents = visibleRows.filter((row) => String(row.entity_type).match(/role|profile|security|settings|auth/i) || String(row.action).match(/role|profile|security|reference/i)).length;
  const dataChangeEvents = visibleRows.filter((row) => String(row.action).match(/create|update|delete|status|condition|complete/i)).length;
  const failedEvents = visibleRows.filter((row) => String(row.action).match(/failed|blocked|reject|cancel/i)).length;
  const reportEvents = visibleRows.filter((row) => String(row.entity_type).match(/reports/i) || String(row.action).match(/report/i)).length;
  const canSeeDiagnostics = profile.roleNames?.some((role: string) => ['developer', 'admin'].includes(role));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Governance view of who changed what, when, and which record was affected."
        actions={<Badge variant={canSeeDiagnostics ? 'purple' : 'info'}>{canSeeDiagnostics ? 'Admin diagnostics' : 'BME Head governance'}</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Link href="/audit"><StatCard label="Events Today" value={todayEvents} icon={<CalendarClock className="h-6 w-6" />} color="green" active={!quick} /></Link>
        <Link href="/audit"><StatCard label="Events This Week" value={weekEvents} icon={<Activity className="h-6 w-6" />} color="blue" /></Link>
        <Link href="/audit?quick=security"><StatCard label="Security Events" value={roleSecurityEvents} icon={<KeyRound className="h-6 w-6" />} color="purple" active={quick === 'security'} /></Link>
        <Link href="/audit?quick=data-changes"><StatCard label="Data Changes" value={dataChangeEvents} icon={<Monitor className="h-6 w-6" />} color="orange" active={quick === 'data-changes'} /></Link>
        <Link href="/audit?quick=failed"><StatCard label="Failed/Blocked Actions" value={failedEvents} icon={<ShieldAlert className="h-6 w-6" />} color="red" active={quick === 'failed'} /></Link>
        <Link href="/audit?quick=reports"><StatCard label="Report Generations" value={reportEvents} icon={<FileBarChart className="h-6 w-6" />} color="gray" active={quick === 'reports'} /></Link>
      </div>

      <Card>
        <form className="grid gap-3 md:grid-cols-5">
          <input name="action" defaultValue={action} placeholder="Action contains..." className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--foreground)]" />
          <select name="entity_type" defaultValue={entityType} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--foreground)]">
            <option value="">All entities</option>
            {uniqueEntityTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select name="user_id" defaultValue={userId} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--foreground)]">
            <option value="">All users</option>
            {(profiles ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.full_name ?? profile.email}</option>
            ))}
          </select>
          <input name="date_from" type="date" defaultValue={dateFrom} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--foreground)]" />
          <input name="date_to" type="date" defaultValue={dateTo} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--foreground)]" />
          <div className="md:col-span-5 flex gap-2">
            <button type="submit" className="rounded-md bg-[var(--brand)] px-3 py-2 text-sm font-medium text-white">Apply Filters</button>
            <a href="/audit" className="rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--foreground)]">Clear</a>
            <a href="/audit?quick=high-risk" className="rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--foreground)]">High-risk only</a>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-[var(--text-muted)]">High-risk events include role changes, user activation changes, equipment condition changes, work completion, PM/calibration completion, procurement status changes, report generation, deletion, cancellation, and blocked attempts when logged.</p>
          <Link href="/reports/audit-security" className="rounded-md border border-[var(--border-subtle)] px-3 py-2 font-medium text-[var(--brand)]">Export Audit Evidence</Link>
        </div>
      </Card>

      <Card padding={false}>
        {error ? (
          <div className="p-6 text-sm">
            <p className="font-medium text-red-300">Audit log could not be loaded.</p>
            <p className="mt-1 text-[var(--text-muted)]">Audit evidence is unavailable for this view right now. Workflow pages remain usable.</p>
            {canSeeDiagnostics && <p className="mt-2 rounded-md bg-red-500/10 p-2 text-red-200">Diagnostic: {error.message}</p>}
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="p-6 text-sm text-[var(--text-muted)]">
            <p>No audit entries match the current filters.</p>
            <p className="mt-1">This can be normal in a fresh demo dataset, or it can indicate audit logging has not been exercised yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-muted)]">
                  <th className="p-3 font-medium">Timestamp</th>
                  <th className="p-3 font-medium">User</th>
                  <th className="p-3 font-medium">Action</th>
                  <th className="p-3 font-medium">Entity</th>
                  <th className="p-3 font-medium">Entity ID</th>
                  <th className="p-3 font-medium">Changed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {rows.map((row) => {
                  const profile = row.profiles as { full_name?: string | null; email?: string | null } | null;
                  return (
                    <tr key={row.id}>
                      <td className="p-3 text-[var(--text-muted)]">{new Date(row.created_at as string).toLocaleString()}</td>
                      <td className="p-3">{profile?.full_name ?? profile?.email ?? 'System / unknown'}</td>
                      <td className="p-3"><Badge variant="info">{row.action as string}</Badge></td>
                      <td className="p-3">{row.entity_type as string}</td>
                      <td className="p-3 font-mono text-xs text-[var(--text-muted)]">{(row.entity_id as string | null) ?? '—'}</td>
                      <td className="p-3 text-xs text-[var(--text-muted)]">
                        old: {summarizeValues(row.old_values)} · new: {summarizeValues(row.new_values)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between text-sm text-[var(--text-muted)]">
        <span>Page {page} of {totalPages} · {count ?? 0} total entries</span>
        <div className="flex gap-2">
          {page > 1 && <a className="rounded border border-[var(--border-subtle)] px-2 py-1" href={`/audit?page=${page - 1}`}>Previous</a>}
          {page < totalPages && <a className="rounded border border-[var(--border-subtle)] px-2 py-1" href={`/audit?page=${page + 1}`}>Next</a>}
        </div>
      </div>
    </div>
  );
}
