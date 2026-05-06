'use client';

import { useEffect, useState } from 'react';
import {
  Award,
  TrendingUp,
  TrendingDown,
  Sliders,
} from 'lucide-react';
import { getPerformanceScores } from '@/services/analytics.service';
import { PageHeader, StatCard, DataTable } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import Card, { CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { ChartCard, BarChart } from '@/components/charts';

interface AssetInfo {
  id: string;
  asset_code: string;
  name: string;
}

interface PerformanceRow {
  id: string;
  asset_id: string;
  normalized_availability: number | null;
  normalized_mttr: number | null;
  normalized_downtime: number | null;
  normalized_pmc: number | null;
  normalized_failure_rate: number | null;
  composite_score: number | null;
  weights_profile_id: string | null;
  equipment_assets: AssetInfo;
  [key: string]: unknown;
}

function scoreColor(score: number): string {
  if (score >= 0.8) return 'text-green-600 dark:text-green-400';
  if (score >= 0.5) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 0.8) return 'bg-green-50 dark:bg-green-900/20';
  if (score >= 0.5) return 'bg-yellow-50 dark:bg-yellow-900/20';
  return 'bg-red-50 dark:bg-red-900/20';
}

function scoreBarColor(score: number): string {
  if (score >= 0.8) return '#22c55e';
  if (score >= 0.5) return '#eab308';
  return '#ef4444';
}

const DEFAULT_WEIGHTS = [
  { criterion: 'Availability', weight: 0.25 },
  { criterion: 'MTTR (inverse)', weight: 0.20 },
  { criterion: 'PM Compliance', weight: 0.20 },
  { criterion: 'Failure Rate (inverse)', weight: 0.20 },
  { criterion: 'Downtime (inverse)', weight: 0.15 },
];

export default function PerformancePage() {
  const [data, setData] = useState<PerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data: rows } = await getPerformanceScores();
        if (rows) setData(rows as unknown as PerformanceRow[]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <PageLoader />;

  const ranked = [...data]
    .filter((d) => d.composite_score != null)
    .sort((a, b) => b.composite_score! - a.composite_score!);

  const top10 = ranked.slice(0, 10);
  const bottom10 = [...ranked].reverse().slice(0, 10).reverse();
  const avgScore =
    ranked.length > 0
      ? ranked.reduce((s, d) => s + d.composite_score!, 0) / ranked.length
      : 0;

  const rankMap = new Map(ranked.map((r, i) => [r.id, i + 1]));

  const columns = [
    {
      key: 'rank',
      header: '#',
      render: (row: PerformanceRow) => (
        <span className="font-semibold text-[var(--text-muted)]">{rankMap.get(row.id) ?? '—'}</span>
      ),
    },
    {
      key: 'asset_code',
      header: 'Asset Code',
      sortable: true,
      render: (row: PerformanceRow) => row.equipment_assets?.asset_code ?? '—',
    },
    {
      key: 'asset_name',
      header: 'Name',
      sortable: true,
      render: (row: PerformanceRow) => row.equipment_assets?.name ?? '—',
    },
    {
      key: 'normalized_availability',
      header: 'Avail.',
      sortable: true,
      render: (row: PerformanceRow) =>
        row.normalized_availability != null ? row.normalized_availability.toFixed(3) : '—',
    },
    {
      key: 'normalized_mttr',
      header: 'MTTR',
      sortable: true,
      render: (row: PerformanceRow) =>
        row.normalized_mttr != null ? row.normalized_mttr.toFixed(3) : '—',
    },
    {
      key: 'normalized_pmc',
      header: 'PMC',
      sortable: true,
      render: (row: PerformanceRow) =>
        row.normalized_pmc != null ? row.normalized_pmc.toFixed(3) : '—',
    },
    {
      key: 'composite_score',
      header: 'Composite Score',
      sortable: true,
      render: (row: PerformanceRow) => {
        if (row.composite_score == null) return '—';
        return (
          <span className={`inline-block rounded px-2 py-0.5 text-sm font-bold ${scoreColor(row.composite_score)} ${scoreBg(row.composite_score)}`}>
            {row.composite_score.toFixed(3)}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Equipment Performance Scores"
        description="Normalized weighted composite scoring — Equations 6-7: Score = Σ(wᵢ × normalized_valueᵢ)"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Analytics' },
          { label: 'Performance' },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Assets Scored"
          value={ranked.length}
          icon={<Award className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label="Average Score"
          value={avgScore.toFixed(3)}
          icon={<Sliders className="h-6 w-6" />}
          color="purple"
        />
        <StatCard
          label="Top Score"
          value={top10[0]?.composite_score?.toFixed(3) ?? '—'}
          icon={<TrendingUp className="h-6 w-6" />}
          color="green"
        />
        <StatCard
          label="Lowest Score"
          value={bottom10[0]?.composite_score?.toFixed(3) ?? '—'}
          icon={<TrendingDown className="h-6 w-6" />}
          color="red"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Top 10 Performers" description="Highest composite performance scores">
          {top10.length > 0 ? (
            <BarChart
              labels={top10.map((d) => d.equipment_assets?.asset_code ?? d.asset_id)}
              datasets={[
                {
                  label: 'Composite Score',
                  data: top10.map((d) => d.composite_score!),
                  backgroundColor: top10.map((d) => scoreBarColor(d.composite_score!)),
                },
              ]}
              height={350}
            />
          ) : (
            <p className="py-12 text-center text-sm text-[var(--text-muted)]">No performance score records available yet.</p>
          )}
        </ChartCard>

        <ChartCard title="Bottom 10 Performers" description="Lowest composite performance scores">
          {bottom10.length > 0 ? (
            <BarChart
              labels={bottom10.map((d) => d.equipment_assets?.asset_code ?? d.asset_id)}
              datasets={[
                {
                  label: 'Composite Score',
                  data: bottom10.map((d) => d.composite_score!),
                  backgroundColor: bottom10.map((d) => scoreBarColor(d.composite_score!)),
                },
              ]}
              height={350}
            />
          ) : (
            <p className="py-12 text-center text-sm text-[var(--text-muted)]">No performance score records available yet.</p>
          )}
        </ChartCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <Sliders className="h-5 w-5 text-purple-500" />
              Scoring Weight Profile
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {DEFAULT_WEIGHTS.map((w) => (
              <div key={w.criterion} className="rounded-lg border border-[var(--border-subtle)] p-3 text-center">
                <p className="text-xs text-[var(--text-muted)]">{w.criterion}</p>
                <p className="mt-1 text-lg font-bold text-[var(--foreground)]">
                  {(w.weight * 100).toFixed(0)}%
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <DataTable<PerformanceRow>
        columns={columns}
        data={ranked}
        keyField="id"
        searchPlaceholder="Search assets..."
        emptyMessage="No performance scores found"
        pageSize={15}
      />
    </div>
  );
}
