'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, ArrowUpDown, ShieldAlert, TrendingUp, Wrench } from 'lucide-react';
import { PageHeader, Badge } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { BarChart, ChartCard, DoughnutChart, HorizontalBarChart } from '@/components/charts';
import { getReplacementPriorities } from '@/services/analytics.service';
import {
  REPLACEMENT_REVIEW_THRESHOLD,
  REPLACEMENT_STRONG_THRESHOLD,
  replacementBand,
  isReplacementCandidate,
} from '@/utils/decision-support/replacement-thresholds';
import { viewerEquipmentDetail, viewerReplacementEvidence, viewerReport } from '@/utils/viewer/evidence-links';

interface AssetInfo {
  id?: string;
  asset_code?: string | null;
  name?: string | null;
  departments?: { name?: string | null } | null;
  equipment_categories?: { name?: string | null; criticality_level?: string | null } | null;
}

interface ReplacementRow {
  id?: string;
  asset_id: string;
  age_score: number | null;
  failure_score: number | null;
  availability_score: number | null;
  maintenance_burden_score: number | null;
  spare_part_score: number | null;
  risk_score: number | null;
  cost_score: number | null;
  replacement_priority_index: number | null;
  rank: number | null;
  justification?: string | null;
  equipment_assets: AssetInfo | null;
}

function topDriver(row: ReplacementRow): string {
  const drivers: Array<{ label: string; v: number | null }> = [
    { label: 'Maintenance burden', v: row.maintenance_burden_score },
    { label: 'Availability', v: row.availability_score },
    { label: 'Failure frequency', v: row.failure_score },
    { label: 'Age / obsolescence', v: row.age_score },
    { label: 'FMEA risk', v: row.risk_score },
    { label: 'Spare support', v: row.spare_part_score },
    { label: 'Lifecycle cost', v: row.cost_score },
  ];
  const sorted = drivers.filter((d) => typeof d.v === 'number').sort((a, b) => (b.v as number) - (a.v as number));
  return sorted[0]?.label ?? 'Composite';
}

function fmt(v: number | null | undefined): string {
  return typeof v === 'number' ? `${Math.round(v * 100)}` : '—';
}

function SummaryCard({ label, value, icon, tone = 'info', sub }: { label: string; value: number; icon: React.ReactNode; tone?: 'critical' | 'warning' | 'info' | 'success'; sub?: string }) {
  const tones = {
    critical: 'border-rose-500/40 bg-rose-500/5',
    warning: 'border-amber-500/40 bg-amber-500/5',
    success: 'border-emerald-500/40 bg-emerald-500/5',
    info: 'border-cyan-500/40 bg-cyan-500/5',
  };
  return (
    <div className={`flex flex-col gap-1 rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-bold leading-none text-[var(--foreground)]">{value}</span>
        <span className="rounded-md bg-[var(--surface-2)] p-2">{icon}</span>
      </div>
      <span className="text-sm font-medium text-[var(--foreground)]">{label}</span>
      {sub && <span className="text-xs leading-snug text-[var(--text-muted)]">{sub}</span>}
    </div>
  );
}

export default function ViewerReplacementRisk() {
  const [rows, setRows] = useState<ReplacementRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await getReplacementPriorities();
        if (data) setRows(data as unknown as ReplacementRow[]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const ranked = useMemo(() => [...rows].filter((r) => r.replacement_priority_index != null).sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999)), [rows]);

  const stats = useMemo(() => {
    let strong = 0, review = 0, monitor = 0;
    let highMaint = 0, lowAvail = 0, frequentFail = 0, criticalRisk = 0, poorSpare = 0;
    for (const r of ranked) {
      const b = replacementBand(r.replacement_priority_index);
      if (b === 'strong') strong++;
      else if (b === 'review') review++;
      else monitor++;
      if ((r.maintenance_burden_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD) highMaint++;
      if ((r.availability_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD) lowAvail++;
      if ((r.failure_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD) frequentFail++;
      if ((r.risk_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD) criticalRisk++;
      if ((r.spare_part_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD) poorSpare++;
    }
    return { strong, review, monitor, highMaint, lowAvail, frequentFail, criticalRisk, poorSpare };
  }, [ranked]);

  const top10 = ranked.slice(0, 10);

  const candidatesByDept = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of ranked) {
      if (!isReplacementCandidate(r.replacement_priority_index)) continue;
      const dept = r.equipment_assets?.departments?.name ?? 'Unknown';
      map.set(dept, (map.get(dept) ?? 0) + 1);
    }
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    return { labels: entries.map(([k]) => k), values: entries.map(([, v]) => v) };
  }, [ranked]);

  const bandDistribution = useMemo(() => ({
    labels: ['Strong (≥ 0.70)', 'Review (0.55–0.69)', 'Monitor (< 0.55)'],
    values: [stats.strong, stats.review, stats.monitor],
    colors: ['rgb(239,68,68)', 'rgb(245,158,11)', 'rgb(34,197,94)'],
  }), [stats]);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Replacement & Risk"
        description="Read-only capital planning and risk justification view computed from the BMERMS Replacement Priority Index."
        breadcrumbs={[{ label: 'Command Center', href: '/command' }, { label: 'Replacement & Risk' }]}
        actions={<Badge variant="default">Read-only view</Badge>}
      />

      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
        Prototype decision thresholds: RPI ≥ {Math.round(REPLACEMENT_STRONG_THRESHOLD * 100)} = Strong replacement candidate · RPI {Math.round(REPLACEMENT_REVIEW_THRESHOLD * 100)}–{Math.round((REPLACEMENT_STRONG_THRESHOLD - 0.01) * 100)} = Review candidate · RPI &lt; {Math.round(REPLACEMENT_REVIEW_THRESHOLD * 100)} = Monitor. These thresholds are used for demonstration and sensitivity testing; they do not automatically approve replacement.
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <SummaryCard label="Strong Candidates" value={stats.strong} icon={<ShieldAlert className="h-5 w-5 text-rose-300" />} tone={stats.strong > 0 ? 'critical' : 'success'} sub="RPI ≥ 0.70" />
        <SummaryCard label="Review Candidates" value={stats.review} icon={<AlertTriangle className="h-5 w-5 text-amber-300" />} tone={stats.review > 0 ? 'warning' : 'success'} sub="RPI 0.55–0.69" />
        <SummaryCard label="High Maintenance Burden" value={stats.highMaint} icon={<Wrench className="h-5 w-5 text-orange-300" />} tone="warning" sub="maintenance_burden_score ≥ 0.70" />
        <SummaryCard label="Low Availability" value={stats.lowAvail} icon={<Activity className="h-5 w-5 text-rose-300" />} tone="warning" sub="availability_score ≥ 0.70" />
        <SummaryCard label="Frequent Failure" value={stats.frequentFail} icon={<TrendingUp className="h-5 w-5 text-rose-300" />} tone="warning" sub="failure_score ≥ 0.70" />
        <SummaryCard label="Critical Service Risk" value={stats.criticalRisk} icon={<ShieldAlert className="h-5 w-5 text-rose-300" />} tone={stats.criticalRisk > 0 ? 'critical' : 'success'} sub="risk_score ≥ 0.70" />
        <SummaryCard label="Unsupported Spare Parts" value={stats.poorSpare} icon={<Activity className="h-5 w-5 text-amber-300" />} tone="warning" sub="spare_part_score ≥ 0.70" />
        <SummaryCard label="Monitor Assets" value={stats.monitor} icon={<ArrowUpDown className="h-5 w-5 text-emerald-300" />} tone="info" sub="RPI &lt; 0.55" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Top 10 RPI Assets">
          {top10.length > 0 ? (
            <HorizontalBarChart
              labels={top10.map((r) => r.equipment_assets?.name ?? `Asset ${r.asset_id.slice(0, 6)}`)}
              values={top10.map((r) => Math.round((r.replacement_priority_index ?? 0) * 100))}
            />
          ) : <p className="py-6 text-center text-sm text-[var(--text-muted)]">No replacement scores available.</p>}
        </ChartCard>
        <ChartCard title="Replacement Candidates by Department">
          {candidatesByDept.labels.length > 0 ? <BarChart labels={candidatesByDept.labels} datasets={[{ label: 'Candidates', data: candidatesByDept.values }]} /> : <p className="py-6 text-center text-sm text-[var(--text-muted)]">No candidates above review threshold.</p>}
        </ChartCard>
        <ChartCard title="Replacement Band Distribution">
          <DoughnutChart labels={bandDistribution.labels} data={bandDistribution.values} colors={bandDistribution.colors} />
        </ChartCard>
        <ChartCard title="Maintenance Burden vs Age">
          {ranked.length > 0 ? (
            <BarChart
              labels={ranked.slice(0, 10).map((r) => r.equipment_assets?.name ?? '—')}
              datasets={[{ label: '(maintenance + age)/2 ×100', data: ranked.slice(0, 10).map((r) => Math.round((((r.maintenance_burden_score ?? 0) + (r.age_score ?? 0)) / 2) * 100)) }]}
            />
          ) : <p className="py-6 text-center text-sm text-[var(--text-muted)]">No data.</p>}
        </ChartCard>
      </div>

      <div className="panel-surface rounded-xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Replacement Ranking</h2>
          <Link href={viewerReport('replacement-planning')} className="text-xs text-violet-300 hover:text-violet-200">Open Replacement Planning Report →</Link>
        </div>
        {ranked.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--text-muted)]">No replacement candidates above review threshold.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Rank</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Department</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">RPI</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Band</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Top driver</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Maintenance</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Availability</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Failure</th>
                  <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Recommended attention</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]/60">
                {ranked.slice(0, 25).map((r) => {
                  const band = replacementBand(r.replacement_priority_index);
                  return (
                    <tr key={r.asset_id}>
                      <td className="py-3 pr-4 font-semibold text-[var(--foreground)]">#{r.rank ?? '—'}</td>
                      <td className="py-3 pr-4">
                        <Link href={viewerEquipmentDetail(r.asset_id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">{r.equipment_assets?.name ?? 'Unknown'}</Link>
                        <p className="text-xs text-[var(--text-muted)]">{r.equipment_assets?.asset_code ?? '—'}</p>
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{r.equipment_assets?.departments?.name ?? '—'}</td>
                      <td className="py-3 pr-4 font-semibold text-[var(--foreground)]">{fmt(r.replacement_priority_index)}</td>
                      <td className="py-3 pr-4">
                        <Badge variant={band === 'strong' ? 'error' : band === 'review' ? 'warning' : 'success'}>{band}</Badge>
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{topDriver(r)}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{fmt(r.maintenance_burden_score)}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{fmt(r.availability_score)}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{fmt(r.failure_score)}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Link href={viewerReplacementEvidence(r.asset_id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Open Replacement Evidence</Link>
                          <Link href={viewerEquipmentDetail(r.asset_id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Asset Profile</Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-[var(--text-muted)]">Source: <code>v_replacement_decision</code>. RPI is a weighted sum of normalized criteria — see Asset profile for the per-asset explanation.</p>
          </div>
        )}
      </div>
    </div>
  );
}
