'use client';

import { useEffect, useState } from 'react';
import {
  Replace,
  AlertTriangle,
  ListOrdered,
  Trophy,
} from 'lucide-react';
import { getReplacementPriorities } from '@/services/analytics.service';
import { PageHeader, StatCard, DataTable, Badge } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import Card, { CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { ChartCard, HorizontalBarChart } from '@/components/charts';
import { generateReplacementDriver } from '@/utils/decision-support/explanations';

interface AssetInfo {
  id: string;
  asset_code: string;
  name: string;
  department_id: string | null;
}

interface ReplacementRow {
  id: string;
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
  justification: string | null;
  equipment_assets: AssetInfo;
  [key: string]: unknown;
}

const SCORE_CRITERIA = [
  { key: 'age_score', label: 'Age', color: '#6366f1' },
  { key: 'failure_score', label: 'Failure', color: '#ef4444' },
  { key: 'availability_score', label: 'Availability', color: '#f97316' },
  { key: 'maintenance_burden_score', label: 'Maint. Burden', color: '#eab308' },
  { key: 'risk_score', label: 'Risk', color: '#dc2626' },
  { key: 'cost_score', label: 'Cost', color: '#8b5cf6' },
] as const;

function rpiColor(index: number): string {
  if (index >= 0.7) return '#ef4444';
  if (index >= 0.4) return '#f97316';
  return '#22c55e';
}

export default function ReplacementPage() {
  const [data, setData] = useState<ReplacementRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data: rows } = await getReplacementPriorities();
        if (rows) setData(rows as unknown as ReplacementRow[]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <PageLoader />;

  const ranked = [...data]
    .filter((d) => d.replacement_priority_index != null)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

  const recommendedRows = ranked.filter((d) => (d.replacement_priority_index ?? 0) >= 0.7);
  const top3 = recommendedRows.slice(0, 3);

  const columns = [
    {
      key: 'rank',
      header: '#',
      sortable: true,
      render: (row: ReplacementRow) => (
        <span className="font-bold text-gray-700 dark:text-gray-300">{row.rank ?? '—'}</span>
      ),
    },
    {
      key: 'asset_code',
      header: 'Asset Code',
      sortable: true,
      render: (row: ReplacementRow) => row.equipment_assets?.asset_code ?? '—',
    },
    {
      key: 'asset_name',
      header: 'Name',
      sortable: true,
      render: (row: ReplacementRow) => row.equipment_assets?.name ?? '—',
    },
    {
      key: 'age_score',
      header: 'Age',
      sortable: true,
      render: (row: ReplacementRow) => row.age_score?.toFixed(2) ?? '—',
    },
    {
      key: 'failure_score',
      header: 'Failure',
      sortable: true,
      render: (row: ReplacementRow) => row.failure_score?.toFixed(2) ?? '—',
    },
    {
      key: 'availability_score',
      header: 'Avail.',
      sortable: true,
      render: (row: ReplacementRow) => row.availability_score?.toFixed(2) ?? '—',
    },
    {
      key: 'maintenance_burden_score',
      header: 'Maint.',
      sortable: true,
      render: (row: ReplacementRow) => row.maintenance_burden_score?.toFixed(2) ?? '—',
    },
    {
      key: 'risk_score',
      header: 'Risk',
      sortable: true,
      render: (row: ReplacementRow) => row.risk_score?.toFixed(2) ?? '—',
    },
    {
      key: 'replacement_priority_index',
      header: 'RPI',
      sortable: true,
      render: (row: ReplacementRow) => {
        if (row.replacement_priority_index == null) return '—';
        const rpi = row.replacement_priority_index;
        return (
          <Badge variant={rpi >= 0.7 ? 'error' : rpi >= 0.4 ? 'warning' : 'success'}>
            {rpi.toFixed(3)}
          </Badge>
        );
      },
    },
    {
      key: 'justification',
      header: 'Key Driver',
      render: (row: ReplacementRow) => (
        <span className="max-w-[250px] truncate text-sm text-gray-600 dark:text-gray-400">
          {generateReplacementDriver(row)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Replacement Priority Ranking"
        description="Multi-criteria replacement model: RPI = Σ(wᵢ × criterionᵢ) based on age, failures, availability, maintenance burden, risk, and cost"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Replacement' },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Assets Ranked"
          value={ranked.length}
          icon={<ListOrdered className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label="Top Priority RPI"
          value={ranked[0]?.replacement_priority_index?.toFixed(3) ?? '—'}
          icon={<AlertTriangle className="h-6 w-6" />}
          color="red"
        />
        <StatCard
          label="Recommended for Replacement"
          value={recommendedRows.length}
          icon={<Replace className="h-6 w-6" />}
          color="orange"
        />
        <StatCard
          label="Lowest RPI"
          value={ranked[ranked.length - 1]?.replacement_priority_index?.toFixed(3) ?? '—'}
          icon={<Trophy className="h-6 w-6" />}
          color="green"
        />
      </div>

      {top3.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-red-700 dark:text-red-400">
            <Replace className="h-5 w-5" />
            Recommended for Replacement
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {top3.map((item, idx) => (
              <Card key={item.id} className="border-red-200 dark:border-red-800">
                <CardHeader>
                  <CardTitle>
                    <span className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        {idx + 1}
                      </span>
                      {item.equipment_assets?.asset_code ?? item.asset_id}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-2 text-sm font-medium text-gray-900 dark:text-white">
                    {item.equipment_assets?.name ?? 'Unknown Asset'}
                  </p>
                  <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                    {generateReplacementDriver(item)}
                  </p>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-gray-500">RPI</span>
                    <Badge variant="error">
                      {item.replacement_priority_index?.toFixed(3) ?? '—'}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    {SCORE_CRITERIA.map((c) => {
                      const val = item[c.key as keyof ReplacementRow] as number | null;
                      return (
                        <div key={c.key} className="flex items-center gap-2">
                          <span className="w-20 text-xs text-gray-500">{c.label}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${((val ?? 0) * 100).toFixed(0)}%`,
                                backgroundColor: c.color,
                              }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs font-medium text-gray-700 dark:text-gray-300">
                            {val?.toFixed(2) ?? '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <ChartCard
        title="Replacement Priority Index"
        description="All ranked assets by replacement priority"
      >
        {ranked.length > 0 ? (
          <HorizontalBarChart
            labels={ranked.map((d) => d.equipment_assets?.asset_code ?? d.asset_id)}
            values={ranked.map((d) => d.replacement_priority_index ?? 0)}
            colors={ranked.map((d) => rpiColor(d.replacement_priority_index ?? 0))}
            height={Math.max(300, ranked.length * 28)}
          />
        ) : (
          <p className="py-12 text-center text-sm text-gray-500">No replacement data</p>
        )}
      </ChartCard>

      <DataTable<ReplacementRow>
        columns={columns}
        data={ranked}
        keyField="id"
        searchPlaceholder="Search assets..."
        emptyMessage="No replacement priorities found"
        pageSize={15}
      />
    </div>
  );
}
