'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader, Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from '@/components/ui';
import { AcknowledgeButton } from '../_components/AcknowledgeButton';
import { ROUTES } from '@/constants';
import { useRole } from '@/hooks/useRole';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { createMaintenanceRequestFromAsset, equipmentDetail, replacementEvidence } from '../_lib/command-center-routes';

const PAGE_SIZE = 25;

interface TriageRow {
  id: string;
  flag_id: string | null;
  flag_type: string | null;
  flag_severity: string | null;
  asset_id: string;
  asset_name: string;
  asset_code: string;
  department_name: string;
  recommendation: string;
  rationale: string[];
  score: number;
}

function normalizeRationale(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`).filter(Boolean);
  }
  if (typeof value === 'string') return [value];
  return [];
}

function actionForFlagType(flagType: string, assetId: string): { label: string; href: string } {
  switch (flagType) {
    case 'urgent_maintenance':
      return { label: 'Create Request', href: createMaintenanceRequestFromAsset(assetId, { urgency: 'high' }) };
    case 'recurring_failure':
      return { label: 'Review Risk', href: `/command/drilldown/risk-watch?assetId=${assetId}` };
    case 'replacement_candidate':
      return { label: 'View Evidence', href: replacementEvidence(assetId) };
    case 'part_shortage':
    case 'low_stock':
      return { label: 'Request Procurement', href: `/procurement/requests/new?assetId=${assetId}&source=command-center&reason=Command%20Center%20stock%20risk` };
    case 'overdue_pm':
    case 'prioritize_pm':
      return { label: 'Open PM Queue', href: `/command/drilldown/pm?assetId=${assetId}` };
    case 'calibrate_soon':
      return { label: 'Open Calibration Queue', href: `/command/drilldown/calibration?assetId=${assetId}` };
    default: return { label: 'View asset', href: equipmentDetail(assetId) };
  }
}

export default function FullTriagePage() {
  const { primaryRole } = useRole();
  const { user } = useAuth();
  const { profile } = useProfile(user?.id);
  const profileId = (profile as unknown as Record<string, unknown> | null)?.id as string | null ?? null;
  const canMutate = primaryRole !== 'viewer';
  const [rows, setRows] = useState<TriageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [deptFilter, setDeptFilter] = useState('');
  const [minScore, setMinScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();

      let q = supabase
        .from('v_command_center_triage')
        .select('triage_id, asset_id, asset_code, asset_name, department_name, priority_score, recommendation, rationale, assigned_to, top_flag_id, top_flag_type, top_flag_severity')
        .eq('status', 'open')
        .order('priority_score', { ascending: false })
        .limit(1000);

      if (primaryRole === 'technician' && profileId) {
        q = q.eq('assigned_to', profileId);
      }

      const { data: queueData, error: queueError } = await q;
      if (queueError) { setLoading(false); return; }

      const allRows = (queueData ?? []) as Array<Record<string, unknown>>;

      // Deduplicate by asset_id — keep highest priority_score per asset
      const deduped = new Map<string, Record<string, unknown>>();
      for (const row of allRows) {
        const aid = row.asset_id as string;
        const ex = deduped.get(aid);
        if (!ex || Number(row.priority_score) > Number(ex.priority_score)) deduped.set(aid, row);
      }
      const sorted = Array.from(deduped.values()).sort((a, b) => Number(b.priority_score) - Number(a.priority_score));

      const mapped: TriageRow[] = sorted.map((row) => {
        return {
          id: row.triage_id as string,
          flag_id: (row.top_flag_id as string) ?? null,
          flag_type: (row.top_flag_type as string) ?? null,
          flag_severity: (row.top_flag_severity as string) ?? null,
          asset_id: row.asset_id as string,
          asset_name: (row.asset_name as string | undefined) ?? 'Unknown asset',
          asset_code: (row.asset_code as string | undefined) ?? 'N/A',
          department_name: (row.department_name as string | undefined) ?? 'Unknown',
          recommendation: (row.recommendation as string) ?? '',
          rationale: normalizeRationale(row.rationale),
          score: Number(row.priority_score ?? 0),
        };
      });

      setRows(mapped);
      const depts = [...new Set(mapped.map(r => r.department_name).filter(Boolean))].sort();
      setDepartments(depts);
      setLoading(false);
    }
    load();
  }, [primaryRole, profileId]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (deptFilter && r.department_name !== deptFilter) return false;
      if (minScore && r.score < Number(minScore)) return false;
      if (maxScore && r.score > Number(maxScore)) return false;
      return true;
    });
  }, [rows, deptFilter, minScore, maxScore]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Full Triage Queue"
        description="All open triage items, deduplicated by asset and ranked by priority score"
        breadcrumbs={[{ label: 'Command Center', href: ROUTES.COMMAND }, { label: 'Full Triage Queue' }]}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={deptFilter}
          onChange={e => { setDeptFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--foreground)]"
        >
          <option value="">All departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <input
          type="number"
          placeholder="Min score"
          value={minScore}
          onChange={e => { setMinScore(e.target.value); setPage(1); }}
          className="w-28 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--foreground)]"
        />
        <input
          type="number"
          placeholder="Max score"
          value={maxScore}
          onChange={e => { setMaxScore(e.target.value); setPage(1); }}
          className="w-28 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--foreground)]"
        />
        {(deptFilter || minScore || maxScore) && (
          <button
            onClick={() => { setDeptFilter(''); setMinScore(''); setMaxScore(''); setPage(1); }}
            className="text-xs text-violet-300 hover:text-violet-200"
          >
            Clear filters
          </button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-400" />
              {filtered.length} asset{filtered.length !== 1 ? 's' : ''} in queue
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
              <p className="text-sm text-[var(--text-muted)]">No triage items match the current filters</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[860px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                      <th className="pb-2 pr-3 font-medium text-[var(--text-muted)]">#</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Asset</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Department</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Reason</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Score</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Action</th>
                      {canMutate && <th className="pb-2 font-medium text-[var(--text-muted)]">Ack</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {pageRows.map((row, idx) => {
                      const rank = (page - 1) * PAGE_SIZE + idx + 1;
                      const action = actionForFlagType(row.flag_type ?? '', row.asset_id);
                      return (
                        <tr key={row.id} className="group">
                          <td className="py-3 pr-3 text-xs text-[var(--text-muted)]">{rank}</td>
                          <td className="py-3 pr-4">
                            <Link href={`/equipment/${row.asset_id}`} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                              {row.asset_name}
                            </Link>
                            <p className="text-xs text-[var(--text-muted)]">{row.asset_code}</p>
                          </td>
                          <td className="py-3 pr-4 text-[var(--text-muted)]">{row.department_name}</td>
                          <td className="max-w-xs py-3 pr-4">
                            <p className="truncate text-[var(--foreground)]">{row.recommendation}</p>
                            {row.flag_type && (
                              <p className="mt-0.5 text-[10px] uppercase text-[var(--text-muted)]">{row.flag_type.replace(/_/g, ' ')}</p>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            <Badge variant={row.score >= 75 ? 'error' : row.score >= 45 ? 'warning' : 'info'}>
                              {row.score.toFixed(1)}
                            </Badge>
                            {row.flag_severity && (
                              <p className="mt-1 text-[10px] uppercase text-[var(--text-muted)]">{row.flag_severity}</p>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            <Link
                              href={action.href}
                              className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] transition hover:border-violet-400 hover:text-violet-300"
                            >
                              {action.label}
                            </Link>
                          </td>
                          {canMutate && (
                            <td className="py-3">
                              <AcknowledgeButton
                                queueId={row.id}
                                assetId={row.asset_id}
                                hasActiveFlag={Boolean(row.flag_id)}
                                label={`Acknowledge triage item for ${row.asset_name}`}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="mt-4 flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span>
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(p => p - 1)}
                    className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] px-2 py-1 hover:border-violet-400 hover:text-violet-300 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3 w-3" /> Prev
                  </button>
                  <span>Page {page} of {totalPages}</span>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage(p => p + 1)}
                    className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] px-2 py-1 hover:border-violet-400 hover:text-violet-300 disabled:opacity-40"
                  >
                    Next <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
