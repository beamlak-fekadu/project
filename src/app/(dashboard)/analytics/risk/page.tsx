'use client';

import { useEffect, useState } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  BarChart3,
  Target,
} from 'lucide-react';
import { getRiskScores } from '@/services/analytics.service';
import { PageHeader, StatCard, DataTable, Badge } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { RiskBadge } from '@/components/ui/StatusBadge';
import { ChartCard, HorizontalBarChart } from '@/components/charts';
import type { RiskLevel } from '@/types/database';
import { AskAiButton } from '@/components/assistant/AskAiButton';

interface AssetInfo {
  id: string;
  asset_code: string;
  name: string;
  department_id: string | null;
}

interface RiskRow {
  id: string;
  asset_id: string;
  severity: number;
  occurrence: number;
  detectability: number;
  rpn: number;
  risk_level: RiskLevel;
  assessed_at: string;
  notes: string | null;
  equipment_assets: AssetInfo;
  [key: string]: unknown;
}

function rpnColor(rpn: number): string {
  if (rpn >= 500) return '#dc2626';
  if (rpn >= 200) return '#f97316';
  if (rpn >= 80) return '#eab308';
  return '#22c55e';
}

function rpnBadgeVariant(rpn: number): 'success' | 'warning' | 'error' | 'info' {
  if (rpn >= 500) return 'error';
  if (rpn >= 200) return 'warning';
  if (rpn >= 80) return 'info';
  return 'success';
}

export default function RiskPage() {
  const [data, setData] = useState<RiskRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data: rows } = await getRiskScores();
        if (rows) setData(rows as unknown as RiskRow[]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <PageLoader />;

  const sorted = [...data].sort((a, b) => b.rpn - a.rpn);
  const highCritical = data.filter((d) => d.risk_level === 'high' || d.risk_level === 'critical');
  const avgRpn = data.length > 0 ? data.reduce((s, d) => s + d.rpn, 0) / data.length : 0;
  const top10 = sorted.slice(0, 10);

  const columns = [
    {
      key: 'asset_code',
      header: 'Asset Code',
      sortable: true,
      render: (row: RiskRow) => row.equipment_assets?.asset_code ?? '—',
    },
    {
      key: 'asset_name',
      header: 'Name',
      sortable: true,
      render: (row: RiskRow) => row.equipment_assets?.name ?? '—',
    },
    {
      key: 'severity',
      header: 'Severity (S)',
      sortable: true,
    },
    {
      key: 'occurrence',
      header: 'Occurrence (O)',
      sortable: true,
    },
    {
      key: 'detectability',
      header: 'Detectability (D)',
      sortable: true,
    },
    {
      key: 'rpn',
      header: 'RPN',
      sortable: true,
      render: (row: RiskRow) => (
        <Badge variant={rpnBadgeVariant(row.rpn)}>
          {row.rpn}
        </Badge>
      ),
    },
    {
      key: 'risk_level',
      header: 'Risk Level',
      sortable: true,
      render: (row: RiskRow) => <RiskBadge level={row.risk_level} />,
    },
    {
      key: 'assessed_at',
      header: 'Assessed',
      sortable: true,
      render: (row: RiskRow) => new Date(row.assessed_at).toLocaleDateString(),
    },
  ];

  const watchlistColumns = [
    ...columns.filter((c) => c.key !== 'assessed_at'),
    {
      key: 'notes',
      header: 'Notes',
      render: (row: RiskRow) => (
        <span className="max-w-[200px] truncate text-sm text-[var(--text-muted)]">{row.notes ?? '—'}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk Scoring (FMEA)"
        description="Risk Priority Number: RPN = Severity × Occurrence × Detectability (Equation 1)"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Analytics' },
          { label: 'Risk Scoring' },
        ]}
        actions={
          <AskAiButton
            moduleLabel="Decision Support"
            label="Explain this risk view"
            seedPrompt="Explain what drives high RPN in this page and which items should be escalated first."
          />
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Assets Assessed"
          value={data.length}
          icon={<Target className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label="High / Critical Risk"
          value={highCritical.length}
          icon={<ShieldAlert className="h-6 w-6" />}
          color="red"
        />
        <StatCard
          label="Average RPN"
          value={avgRpn.toFixed(0)}
          icon={<BarChart3 className="h-6 w-6" />}
          color="yellow"
        />
        <StatCard
          label="Max RPN"
          value={sorted[0]?.rpn ?? 0}
          icon={<AlertTriangle className="h-6 w-6" />}
          color="orange"
        />
      </div>

      <ChartCard title="Top 10 Highest RPN" description="Assets with the most critical risk priority numbers">
        {top10.length > 0 ? (
          <HorizontalBarChart
            labels={top10.map((d) => d.equipment_assets?.asset_code ?? d.asset_id)}
            values={top10.map((d) => d.rpn)}
            colors={top10.map((d) => rpnColor(d.rpn))}
            height={380}
          />
        ) : (
          <p className="py-12 text-center text-sm text-[var(--text-muted)]">No risk data available for the selected period.</p>
        )}
      </ChartCard>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-[var(--foreground)]">Full RPN Ranking</h2>
        <DataTable<RiskRow>
          columns={columns}
          data={sorted}
          keyField="id"
          searchPlaceholder="Search assets..."
          emptyMessage="No risk scores found"
          pageSize={15}
        />
      </div>

      {highCritical.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-[var(--foreground)]">
            <ShieldAlert className="h-5 w-5" />
            High-Risk Watchlist
          </h2>
          <DataTable<RiskRow>
            columns={watchlistColumns}
            data={[...highCritical].sort((a, b) => b.rpn - a.rpn)}
            keyField="id"
            emptyMessage="No high-risk items"
            pageSize={10}
          />
        </div>
      )}
    </div>
  );
}
