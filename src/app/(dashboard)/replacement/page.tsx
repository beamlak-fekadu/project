'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  ClipboardList,
  PackageCheck,
  Replace,
  SlidersHorizontal,
  Clock,
  Activity,
} from 'lucide-react';
import { getReplacementPriorities } from '@/services/analytics.service';
import { PageHeader, StatCard, DataTable, Badge, Button } from '@/components/ui';
import ClearFiltersButton from '@/components/ui/ClearFiltersButton';
import { PageLoader } from '@/components/ui/Spinner';
import Card, { CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartCard, HorizontalBarChart } from '@/components/charts';
import { ScoreExplanation } from '@/app/(dashboard)/command/_components/ScoreExplanation';
import type { ScoreExplanation as ScoreExplanationData } from '@/app/(dashboard)/command/_lib/command-center-data';
import { equipmentDetail, replacementEvidence } from '@/app/(dashboard)/command/_lib/command-center-routes';
import { generateReplacementDriver } from '@/utils/decision-support/explanations';
import {
  REPLACEMENT_REVIEW_THRESHOLD,
  REPLACEMENT_STRONG_THRESHOLD,
  replacementBand,
  isReplacementCandidate,
} from '@/utils/decision-support/replacement-thresholds';
import { useRole } from '@/hooks/useRole';
import ViewerReplacementRisk from './_components/ViewerReplacementRisk';
import { ROUTES } from '@/constants';

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
  computed_at?: string | null;
  equipment_assets: AssetInfo | null;
  [key: string]: unknown;
}

const SCORE_CRITERIA = [
  { key: 'age_score', label: 'Age', weight: '15%', color: '#2563eb' },
  { key: 'failure_score', label: 'Failure frequency', weight: '20%', color: '#ef4444' },
  { key: 'availability_score', label: 'Availability impact', weight: '15%', color: '#f97316' },
  { key: 'maintenance_burden_score', label: 'Maintenance burden', weight: '15%', color: '#eab308' },
  { key: 'spare_part_score', label: 'Spare support', weight: '10%', color: '#14b8a6' },
  { key: 'risk_score', label: 'FMEA risk', weight: '15%', color: '#dc2626' },
  { key: 'cost_score', label: 'Lifecycle cost', weight: '10%', color: '#8b5cf6' },
] as const;

function rpiValue(row: ReplacementRow) {
  return row.replacement_priority_index ?? 0;
}

function rpiColor(index: number): string {
  const band = replacementBand(index);
  if (band === 'strong') return '#ef4444';
  if (band === 'review') return '#f97316';
  return '#22c55e';
}

function rpiLabel(value: number | null | undefined) {
  if (value == null) return 'Not scored';
  return `${Math.round(value * 100)}/100`;
}

function scoreBand(value: number | null | undefined) {
  if (value == null) return 'Not available';
  if (value >= REPLACEMENT_STRONG_THRESHOLD) return 'High';
  if (value >= REPLACEMENT_REVIEW_THRESHOLD) return 'Review';
  return 'Low';
}

function replacementDecisionBand(value: number | null | undefined) {
  if (value == null) return 'Not scored';
  const band = replacementBand(value);
  if (band === 'strong') return 'Strong replacement candidate';
  if (band === 'review') return 'Review candidate';
  return 'Monitor';
}

function procurementPrefill(row: ReplacementRow) {
  const asset = row.equipment_assets;
  const params = new URLSearchParams({
    source: 'replacement',
    assetId: row.asset_id,
    itemName: asset ? `${asset.asset_code} ${asset.name}` : 'replacement equipment',
    reason: generateReplacementDriver(row),
  });
  return `/procurement/requests/new?${params.toString()}`;
}

function disposalPrefill(row: ReplacementRow) {
  const params = new URLSearchParams({
    source: 'replacement',
    action: 'new-request',
    assetId: row.asset_id,
    reason: generateReplacementDriver(row),
  });
  return `/disposal?${params.toString()}`;
}

function reportPrefill(row: ReplacementRow) {
  const params = new URLSearchParams({
    source: 'replacement',
    assetId: row.asset_id,
    rank: String(row.rank ?? ''),
    rpi: String(row.replacement_priority_index ?? ''),
  });
  return `/reports/replacement-planning?${params.toString()}`;
}

function rpiExplanation(row: ReplacementRow): ScoreExplanationData {
  const values = SCORE_CRITERIA.map((criterion) => ({
    label: criterion.label,
    value: row[criterion.key] == null ? null : Number(row[criterion.key]).toFixed(2),
  }));
  const calculation = SCORE_CRITERIA
    .map((criterion) => `${criterion.weight} x ${row[criterion.key] == null ? '0' : Number(row[criterion.key]).toFixed(2)}`)
    .join(' + ');

  return {
    title: 'Replacement Priority Index',
    scoreLabel: rpiLabel(row.replacement_priority_index),
    formula: 'RPI = sum(weight_i x normalized criterion_i), scaled to 0-100 for display',
    criteria: SCORE_CRITERIA.map((criterion) => criterion.label),
    weights: SCORE_CRITERIA.map((criterion) => ({ label: criterion.label, value: criterion.weight })),
    rawValues: values,
    normalizedValues: values,
    calculation: `${calculation} = ${rpiLabel(row.replacement_priority_index)}`,
    generatedReason: generateReplacementDriver(row),
    timestamp: row.computed_at ?? null,
    source: 'replacement_priority_scores, equipment analytics, FMEA risk, reliability, maintenance, and spare-part evidence',
    assignmentMethod: 'Computed snapshot',
    actionSuggestion: 'Review evidence, then decide whether to start procurement, disposal, or management reporting.',
  };
}

function mainDriver(row: ReplacementRow) {
  const top = SCORE_CRITERIA
    .map((criterion) => ({ ...criterion, value: row[criterion.key] as number | null }))
    .filter((item) => item.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  return top ? `${top.label} (${scoreBand(top.value)})` : 'Insufficient score evidence';
}

function hasMissingScore(row: ReplacementRow) {
  return SCORE_CRITERIA.some((criterion) => row[criterion.key] == null);
}

export default function ReplacementPage() {
  const { roles } = useRole();
  const isViewerOnly =
    roles.includes('viewer') &&
    !roles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  if (isViewerOnly) return <ViewerReplacementRisk />;
  return <OperationalReplacementPage />;
}

function OperationalReplacementPage() {
  const searchParams = useSearchParams();
  const { isDeveloper } = useRole();
  const [data, setData] = useState<ReplacementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState(() => searchParams.get('filter') ?? 'candidates');
  const [chartLimit, setChartLimit] = useState<'10' | '20' | 'all'>('10');

  useEffect(() => {
    async function load() {
      try {
        const { data: rows } = await getReplacementPriorities();
        if (rows) setData(rows as unknown as ReplacementRow[]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const ranked = useMemo(() => [...data]
    .filter((d) => d.replacement_priority_index != null)
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999)), [data]);

  const topCandidates = ranked.filter((row) => isReplacementCandidate(rpiValue(row))).slice(0, 3);
  const replacementCandidates = ranked.filter((row) => isReplacementCandidate(rpiValue(row)));
  const highPriority = ranked.filter((row) => rpiValue(row) >= REPLACEMENT_STRONG_THRESHOLD);
  const reviewCandidates = ranked.filter((row) => rpiValue(row) >= REPLACEMENT_REVIEW_THRESHOLD && rpiValue(row) < REPLACEMENT_STRONG_THRESHOLD);
  const monitorCandidates = ranked.filter((row) => rpiValue(row) < REPLACEMENT_REVIEW_THRESHOLD).slice(0, 10);
  const criticalClinicalImpact = ranked.filter((row) => (row.risk_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD);
  const poorSpareSupport = ranked.filter((row) => (row.spare_part_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD);
  const highMaintenanceBurden = ranked.filter((row) => (row.maintenance_burden_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD);
  const lowAvailability = ranked.filter((row) => (row.availability_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD);
  const frequentFailure = ranked.filter((row) => (row.failure_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD);
  const ageObsolescenceRisk = ranked.filter((row) => (row.age_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD);
  const chartRows = chartLimit === 'all' ? ranked : ranked.slice(0, Number(chartLimit));
  const filteredRows = ranked.filter((row) => {
    if (activeFilter === 'strong') return rpiValue(row) >= REPLACEMENT_STRONG_THRESHOLD;
    if (activeFilter === 'review') return rpiValue(row) >= REPLACEMENT_REVIEW_THRESHOLD && rpiValue(row) < REPLACEMENT_STRONG_THRESHOLD;
    if (activeFilter === 'maintenance') return (row.maintenance_burden_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD;
    if (activeFilter === 'availability') return (row.availability_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD;
    if (activeFilter === 'failure') return (row.failure_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD;
    if (activeFilter === 'age') return (row.age_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD;
    if (activeFilter === 'spare') return (row.spare_part_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD;
    if (activeFilter === 'critical') return (row.risk_score ?? 0) >= REPLACEMENT_STRONG_THRESHOLD;
    if (activeFilter === 'monitor') return rpiValue(row) < REPLACEMENT_REVIEW_THRESHOLD;
    if (activeFilter === 'all') return true;
    return replacementCandidates.length > 0 ? isReplacementCandidate(rpiValue(row)) : monitorCandidates.some((item) => item.id === row.id);
  });

  if (loading) return <PageLoader />;

  const columns = [
    {
      key: 'rank',
      header: 'Rank',
      sortable: true,
      render: (row: ReplacementRow) => <span className="font-semibold">#{row.rank ?? '—'}</span>,
    },
    {
      key: 'asset',
      header: 'Asset',
      sortable: true,
      render: (row: ReplacementRow) => (
        <div>
          <Link href={equipmentDetail(row.asset_id)} className="font-medium text-[var(--foreground)] hover:text-[var(--brand)]">
            {row.equipment_assets?.asset_code ?? row.asset_id}
          </Link>
          <p className="text-xs text-[var(--text-muted)]">{row.equipment_assets?.name ?? 'Unknown asset'}</p>
          {hasMissingScore(row) && <p className="text-xs text-amber-500">Missing evidence in one or more criteria</p>}
        </div>
      ),
    },
    {
      key: 'replacement_priority_index',
      header: 'RPI',
      sortable: true,
      render: (row: ReplacementRow) => (
        <ScoreExplanation details={rpiExplanation(row)}>
          <Badge variant={rpiValue(row) >= REPLACEMENT_STRONG_THRESHOLD ? 'error' : rpiValue(row) >= REPLACEMENT_REVIEW_THRESHOLD ? 'warning' : 'success'}>
            {rpiLabel(row.replacement_priority_index)}
          </Badge>
        </ScoreExplanation>
      ),
    },
    {
      key: 'main_driver',
      header: 'Top Driver',
      render: (row: ReplacementRow) => <span className="text-sm">{mainDriver(row)}</span>,
    },
    {
      key: 'risk_score',
      header: 'Availability / Downtime',
      sortable: true,
      render: (row: ReplacementRow) => scoreBand(row.availability_score),
    },
    {
      key: 'maintenance_burden_score',
      header: 'Maintenance Burden',
      sortable: true,
      render: (row: ReplacementRow) => scoreBand(row.maintenance_burden_score),
    },
    {
      key: 'age_score',
      header: 'Failure Count',
      sortable: true,
      render: (row: ReplacementRow) => scoreBand(row.failure_score),
    },
    {
      key: 'risk_band',
      header: 'Risk Band',
      sortable: true,
      render: (row: ReplacementRow) => <Badge variant={rpiValue(row) >= REPLACEMENT_STRONG_THRESHOLD ? 'error' : rpiValue(row) >= REPLACEMENT_REVIEW_THRESHOLD ? 'warning' : 'success'}>{replacementDecisionBand(row.replacement_priority_index)}</Badge>,
    },
    {
      key: 'actions',
      header: 'Recommended Action',
      render: (row: ReplacementRow) => (
        <div className="flex flex-wrap gap-2">
          <Link href={replacementEvidence(row.asset_id)} className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs hover:bg-[var(--surface-2)]">Open Evidence</Link>
          <Link href={`/replacement?assetId=${row.asset_id}&action=create-review`} className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs hover:bg-[var(--surface-2)]">Create Replacement Review</Link>
          <Link href={procurementPrefill(row)} className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs hover:bg-[var(--surface-2)]">Create Procurement Request</Link>
          <Link href={disposalPrefill(row)} className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs hover:bg-[var(--surface-2)]">Create Disposal Request</Link>
          <Link href={`/replacement?filter=monitor&assetId=${row.asset_id}`} className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs hover:bg-[var(--surface-2)]">Mark Monitor Only</Link>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Replacement Priority"
        description="Replacement planning evidence for BME Head decisions. Scoring sliders and sensitivity testing live in Developer Lab."
        breadcrumbs={[
          { label: 'Command Center', href: ROUTES.COMMAND },
          { label: 'Replacement Priority' },
        ]}
        actions={isDeveloper ? (
          <Link href="/developer-lab">
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="h-4 w-4" />
              Open in Developer Lab
            </Button>
          </Link>
        ) : undefined}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Replacement Candidates" value={replacementCandidates.length} icon={<Replace className="h-6 w-6" />} color="blue" active={activeFilter === 'candidates'} onClick={() => setActiveFilter('candidates')} />
        <StatCard label="Strong Candidates" value={highPriority.length} icon={<AlertTriangle className="h-6 w-6" />} color="red" active={activeFilter === 'strong'} onClick={() => setActiveFilter('strong')} />
        <StatCard label="Review Candidates" value={reviewCandidates.length} icon={<ClipboardList className="h-6 w-6" />} color="orange" active={activeFilter === 'review'} onClick={() => setActiveFilter('review')} />
        <StatCard label="Monitor Candidates" value={monitorCandidates.length} icon={<Clock className="h-6 w-6" />} color="green" active={activeFilter === 'monitor'} onClick={() => setActiveFilter('monitor')} />
        <StatCard label="High Maintenance Burden" value={highMaintenanceBurden.length} icon={<Activity className="h-6 w-6" />} color="purple" active={activeFilter === 'maintenance'} onClick={() => setActiveFilter('maintenance')} />
        <StatCard label="Low Availability / High Downtime" value={lowAvailability.length} icon={<Clock className="h-6 w-6" />} color="orange" active={activeFilter === 'availability'} onClick={() => setActiveFilter('availability')} />
        <StatCard label="Frequent Failure" value={frequentFailure.length} icon={<AlertTriangle className="h-6 w-6" />} color="red" active={activeFilter === 'failure'} onClick={() => setActiveFilter('failure')} />
        <StatCard label="Age / Obsolescence Risk" value={ageObsolescenceRisk.length} icon={<Clock className="h-6 w-6" />} color="yellow" active={activeFilter === 'age'} onClick={() => setActiveFilter('age')} />
        <StatCard label="Spare Parts Unsupported" value={poorSpareSupport.length} icon={<PackageCheck className="h-6 w-6" />} color="yellow" active={activeFilter === 'spare'} onClick={() => setActiveFilter('spare')} />
        <StatCard label="High FMEA Risk" value={criticalClinicalImpact.length} icon={<ClipboardList className="h-6 w-6" />} color="orange" active={activeFilter === 'critical'} onClick={() => setActiveFilter('critical')} />
      </div>

      {activeFilter !== 'candidates' && (
        <div className="flex justify-end">
          <ClearFiltersButton onClick={() => setActiveFilter('candidates')} />
        </div>
      )}

      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
        <h2 className="text-base font-semibold text-[var(--foreground)]">Prototype Decision Thresholds</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">RPI &gt;= {REPLACEMENT_STRONG_THRESHOLD.toFixed(2)} means Strong replacement candidate. RPI {REPLACEMENT_REVIEW_THRESHOLD.toFixed(2)}–{(REPLACEMENT_STRONG_THRESHOLD - 0.01).toFixed(2)} means Review candidate. RPI &lt; {REPLACEMENT_REVIEW_THRESHOLD.toFixed(2)} means Monitor. These are prototype decision thresholds used for demonstration and sensitivity testing; they do not automatically approve replacement.</p>
      </section>

      {topCandidates.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {topCandidates.map((item) => (
            <Card key={item.id} className="border-rose-500/30">
              <CardHeader>
                <CardTitle>#{item.rank ?? '—'} {item.equipment_assets?.asset_code ?? item.asset_id}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="font-medium text-[var(--foreground)]">{item.equipment_assets?.name ?? 'Unknown asset'}</p>
                <p className="text-[var(--text-muted)]">{generateReplacementDriver(item)}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">RPI</span>
                  <ScoreExplanation details={rpiExplanation(item)}>
                    <Badge variant="error">{rpiLabel(item.replacement_priority_index)}</Badge>
                  </ScoreExplanation>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={replacementEvidence(item.asset_id)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-white">View Evidence</Link>
                  <Link href={reportPrefill(item)} className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium">Report</Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {replacementCandidates.length === 0 && monitorCandidates.length > 0 && (
        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
          <h2 className="text-base font-semibold text-[var(--foreground)]">No Assets Exceed Replacement Threshold</h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Showing top monitored lifecycle candidates for review so Replacement and Disposal use the same RPI evidence without overstating approval readiness.</p>
        </section>
      )}

      <ChartCard title="Replacement Priority Index" description="Current live ranking snapshot. Sandbox comparisons and threshold sensitivity are developer-only.">
        <div className="mb-3 flex flex-wrap gap-2">
          {(['10', '20', 'all'] as const).map((limit) => (
            <button
              key={limit}
              type="button"
              onClick={() => setChartLimit(limit)}
              className={`rounded-lg border px-3 py-1 text-xs font-medium ${chartLimit === limit ? 'border-[var(--brand)] bg-[var(--surface-2)] text-[var(--foreground)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--brand)]/50'}`}
            >
              {limit === 'all' ? 'All' : `Top ${limit}`}
            </button>
          ))}
        </div>
        {ranked.length > 0 ? (
          <HorizontalBarChart
            labels={chartRows.map((d) => d.equipment_assets?.asset_code ?? d.asset_id)}
            values={chartRows.map((d) => rpiValue(d))}
            colors={chartRows.map((d) => rpiColor(rpiValue(d)))}
            height={chartLimit === 'all' ? 520 : Math.max(300, chartRows.length * 32)}
          />
        ) : (
          <p className="py-12 text-center text-sm text-[var(--text-muted)]">No replacement priority scores found. Run analytics recompute from Developer Lab if this is unexpected.</p>
        )}
      </ChartCard>

      <DataTable<ReplacementRow>
        columns={columns}
        data={filteredRows}
        keyField="id"
        searchPlaceholder="Search replacement candidates..."
        emptyMessage={replacementCandidates.length === 0 ? 'No assets exceed the replacement threshold. Top monitored lifecycle candidates appear when score evidence exists.' : 'No replacement candidates found for this filter'}
        pageSize={15}
      />
    </div>
  );
}
