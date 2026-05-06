'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  Clock,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { getReliabilityMetrics } from '@/services/analytics.service';
import { PageHeader, StatCard, DataTable } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { ChartCard, BarChart } from '@/components/charts';
import { formatCount, formatPercentage, formatScore } from '@/utils/format';

interface AssetInfo {
  id: string;
  asset_code: string;
  name: string;
  department_id: string | null;
}

interface ReliabilityRow {
  id: string;
  asset_id: string;
  mttr_hours: number | null;
  mtbf_hours: number | null;
  availability_ratio: number | null;
  total_downtime_hours: number | null;
  failure_count: number;
  repair_count: number;
  equipment_assets: AssetInfo;
  [key: string]: unknown;
}

function availabilityColor(pct: number): string {
  if (pct >= 95) return 'text-green-600 dark:text-green-400';
  if (pct >= 90) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function availabilityBg(pct: number): string {
  if (pct >= 95) return 'bg-green-50 dark:bg-green-900/20';
  if (pct >= 90) return 'bg-yellow-50 dark:bg-yellow-900/20';
  return 'bg-red-50 dark:bg-red-900/20';
}

export default function ReliabilityPage() {
  const [data, setData] = useState<ReliabilityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data: rows } = await getReliabilityMetrics();
        if (rows) setData(rows as unknown as ReliabilityRow[]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <PageLoader />;

  const hasMeaningfulReliability = (row: ReliabilityRow) =>
    row.mttr_hours != null
    || row.mtbf_hours != null
    || row.availability_ratio != null
    || row.failure_count > 0
    || (row.total_downtime_hours ?? 0) > 0;

  const meaningfulData = data.filter(hasMeaningfulReliability);

  const validMttr = meaningfulData.filter((d) => d.mttr_hours != null);
  const validMtbf = meaningfulData.filter((d) => d.mtbf_hours != null);
  const validAvail = meaningfulData.filter((d) => d.availability_ratio != null);

  const avgMttr =
    validMttr.length > 0
      ? validMttr.reduce((s, d) => s + d.mttr_hours!, 0) / validMttr.length
      : null;
  const avgMtbf =
    validMtbf.length > 0
      ? validMtbf.reduce((s, d) => s + d.mtbf_hours!, 0) / validMtbf.length
      : null;
  const avgAvail =
    validAvail.length > 0
      ? (validAvail.reduce((s, d) => s + d.availability_ratio!, 0) / validAvail.length) * 100
      : null;

  const topMttr = [...meaningfulData]
    .filter((d) => d.mttr_hours != null)
    .sort((a, b) => b.mttr_hours! - a.mttr_hours!)
    .slice(0, 15);

  const bottomAvail = [...meaningfulData]
    .filter((d) => d.availability_ratio != null)
    .sort((a, b) => a.availability_ratio! - b.availability_ratio!)
    .slice(0, 15);

  const columns = [
    {
      key: 'asset_code',
      header: 'Asset Code',
      sortable: true,
      render: (row: ReliabilityRow) => row.equipment_assets?.asset_code ?? '—',
    },
    {
      key: 'asset_name',
      header: 'Asset Name',
      sortable: true,
      render: (row: ReliabilityRow) => row.equipment_assets?.name ?? '—',
    },
    {
      key: 'mttr_hours',
      header: 'MTTR (hrs)',
      sortable: true,
      render: (row: ReliabilityRow) => row.mttr_hours?.toFixed(1) ?? '—',
    },
    {
      key: 'mtbf_hours',
      header: 'MTBF (hrs)',
      sortable: true,
      render: (row: ReliabilityRow) => row.mtbf_hours?.toFixed(1) ?? '—',
    },
    {
      key: 'availability_ratio',
      header: 'Availability',
      sortable: true,
      render: (row: ReliabilityRow) => {
        if (row.availability_ratio == null) return '—';
        const pct = row.availability_ratio * 100;
        return (
          <span className={`inline-block rounded px-2 py-0.5 text-sm font-semibold ${availabilityColor(pct)} ${availabilityBg(pct)}`}>
            {pct.toFixed(1)}%
          </span>
        );
      },
    },
    {
      key: 'failure_count',
      header: 'Failures',
      sortable: true,
      render: (row: ReliabilityRow) => row.failure_count,
    },
    {
      key: 'total_downtime_hours',
      header: 'Downtime (hrs)',
      sortable: true,
      render: (row: ReliabilityRow) => row.total_downtime_hours?.toFixed(1) ?? '—',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reliability Analytics"
        description="MTTR, MTBF & Availability metrics — Equations 2-4: MTTR = ΣRepairTime / Repairs, MTBF = OperationalHrs / Failures, Availability = MTBF / (MTBF + MTTR)"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Analytics' },
          { label: 'Reliability' },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Average MTTR"
          value={avgMttr == null ? 'No metrics yet' : `${formatScore(avgMttr)} hrs`}
          icon={<Clock className="h-6 w-6" />}
          color="red"
        />
        <StatCard
          label="Average MTBF"
          value={avgMtbf == null ? 'No metrics yet' : `${formatScore(avgMtbf)} hrs`}
          icon={<RefreshCw className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label="Average Availability"
          value={formatPercentage(avgAvail)}
          icon={<TrendingUp className="h-6 w-6" />}
          color={(avgAvail ?? 0) >= 95 ? 'green' : (avgAvail ?? 0) >= 90 ? 'yellow' : 'red'}
        />
        <StatCard
          label="Assets Assessed"
          value={formatCount(meaningfulData.length)}
          icon={<Activity className="h-6 w-6" />}
          color="purple"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Highest MTTR (Top 15)" description="Assets with longest mean time to repair">
          {topMttr.length > 0 ? (
            <BarChart
              labels={topMttr.map((d) => d.equipment_assets?.asset_code ?? d.asset_id)}
              datasets={[
                {
                  label: 'MTTR (hours)',
                  data: topMttr.map((d) => d.mttr_hours!),
                  backgroundColor: '#ef4444',
                },
              ]}
              height={350}
            />
          ) : (
            <p className="py-12 text-center text-sm text-[var(--text-muted)]">No MTTR records available yet.</p>
          )}
        </ChartCard>

        <ChartCard title="Lowest Availability (Bottom 15)" description="Assets requiring availability improvement">
          {bottomAvail.length > 0 ? (
            <BarChart
              labels={bottomAvail.map((d) => d.equipment_assets?.asset_code ?? d.asset_id)}
              datasets={[
                {
                  label: 'Availability %',
                  data: bottomAvail.map((d) => d.availability_ratio! * 100),
                  backgroundColor: bottomAvail.map((d) => {
                    const pct = d.availability_ratio! * 100;
                    if (pct >= 95) return '#22c55e';
                    if (pct >= 90) return '#eab308';
                    return '#ef4444';
                  }),
                },
              ]}
              height={350}
            />
          ) : (
            <p className="py-12 text-center text-sm text-[var(--text-muted)]">No availability records available yet.</p>
          )}
        </ChartCard>
      </div>

      <DataTable<ReliabilityRow>
        columns={columns}
        data={meaningfulData}
        keyField="id"
        searchPlaceholder="Search assets..."
        emptyMessage="No reliability metrics available. Run analytics seed or refresh reliability calculations."
        pageSize={15}
      />
    </div>
  );
}
