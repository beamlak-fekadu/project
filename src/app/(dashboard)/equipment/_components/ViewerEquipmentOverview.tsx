'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Monitor, ShieldAlert, TrendingUp, Wrench,
} from 'lucide-react';
import { PageHeader, Badge } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { BarChart, DoughnutChart, ChartCard } from '@/components/charts';
import { getEquipmentList } from '@/services/equipment.service';
import { getAll } from '@/services/settings.service';
import { getRiskScores } from '@/services/analytics.service';
import {
  formatEquipmentCondition,
  getConditionBadgeClass,
  EQUIPMENT_CONDITION_OPTIONS,
} from '@/utils/equipment/condition-labels';
import { replacementBand } from '@/utils/decision-support/replacement-thresholds';
import { viewerEquipmentDetail, viewerReplacementEvidence } from '@/utils/viewer/evidence-links';
import { createClient } from '@/lib/supabase/client';

interface EquipmentRow {
  id: string;
  asset_code: string;
  name: string;
  condition: string;
  status: string;
  installation_date: string | null;
  departments: { id: string; name: string } | null;
  equipment_categories: { id: string; name: string; criticality_level?: string | null } | null;
  manufacturers: { id: string; name: string } | null;
  equipment_models: { id: string; name: string } | null;
  [key: string]: unknown;
}

interface EnrichedRow extends EquipmentRow {
  rpn?: number;
  riskLevel?: string;
  rpi?: number;
}

interface RefOption { value: string; label: string }

const CONDITION_CHART_COLORS: Record<string, string> = {
  functional: 'rgb(16, 185, 129)',
  needs_repair: 'rgb(245, 158, 11)',
  non_functional: 'rgb(239, 68, 68)',
  under_maintenance: 'rgb(99, 102, 241)',
  decommissioned: 'rgb(107, 114, 128)',
};

const COLOR_MAP: Record<string, string> = {
  blue: 'bg-blue-500/15 text-blue-400',
  green: 'bg-emerald-500/15 text-emerald-400',
  yellow: 'bg-amber-500/15 text-amber-400',
  red: 'bg-rose-500/15 text-rose-400',
  purple: 'bg-violet-500/15 text-violet-400',
  orange: 'bg-orange-500/15 text-orange-400',
  gray: 'bg-slate-500/15 text-slate-400',
};

function isEssentialAsset(row: EnrichedRow): boolean {
  const c = row.equipment_categories?.criticality_level;
  return c === 'high' || c === 'critical';
}

function isHighRiskAsset(row: EnrichedRow): boolean {
  if (!row.riskLevel) return false;
  return row.riskLevel === 'critical' || row.riskLevel === 'high';
}

function SummaryCard({ label, value, icon, color = 'blue', active, onClick, sub }: { label: string; value: number; icon: React.ReactNode; color?: string; active?: boolean; onClick?: () => void; sub?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`panel-surface flex flex-col gap-1 rounded-xl p-4 text-left transition-colors
        ${onClick ? 'cursor-pointer hover:ring-1 hover:ring-[var(--brand)]/40' : ''}
        ${active ? 'ring-2 ring-[var(--brand)]' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-bold leading-none text-[var(--foreground)]">{value}</span>
        <span className={`rounded-lg p-1.5 ${COLOR_MAP[color] ?? COLOR_MAP.blue}`}>{icon}</span>
      </div>
      <span className="text-xs font-medium leading-tight text-[var(--text-muted)]">{label}</span>
      {sub && <span className="text-[10px] leading-tight text-[var(--text-subtle)]">{sub}</span>}
    </button>
  );
}

type QuickFilter = '' | 'essential' | 'high_risk' | 'replacement_candidate' | 'non_functional' | 'under_maintenance' | 'needs_repair';

export default function ViewerEquipmentOverview() {
  const [allRows, setAllRows] = useState<EnrichedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<RefOption[]>([]);
  const [categories, setCategories] = useState<RefOption[]>([]);
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterCriticality, setFilterCriticality] = useState('');
  const [filterRisk, setFilterRisk] = useState('');
  const [filterBand, setFilterBand] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      const supabase = createClient();
      const [equipRes, riskRes, deptRes, catRes, replacementRes] = await Promise.all([
        getEquipmentList(),
        getRiskScores(),
        getAll('departments'),
        getAll('equipment_categories'),
        supabase
          .from('v_replacement_decision')
          .select('asset_id, replacement_priority_index')
          .limit(2000),
      ]);
      if (cancelled) return;

      const equipment = (equipRes.data ?? []) as unknown as EquipmentRow[];
      const riskMap = new Map<string, { rpn: number; risk_level: string }>();
      for (const r of (riskRes.data as Array<{ asset_id: string; rpn: number; risk_level: string }> | null) ?? []) {
        if (!riskMap.has(r.asset_id)) riskMap.set(r.asset_id, { rpn: r.rpn, risk_level: r.risk_level });
      }
      const rpiMap = new Map<string, number>();
      for (const r of (replacementRes.data as Array<{ asset_id: string; replacement_priority_index: number | null }> | null) ?? []) {
        const v = r.replacement_priority_index;
        if (typeof v === 'number') rpiMap.set(r.asset_id, v);
      }
      const enriched: EnrichedRow[] = equipment.map((eq) => ({
        ...eq,
        rpn: riskMap.get(eq.id)?.rpn,
        riskLevel: riskMap.get(eq.id)?.risk_level,
        rpi: rpiMap.get(eq.id),
      }));
      setAllRows(enriched);
      if (deptRes.data) setDepartments(deptRes.data.map((d: { id: string; name: string }) => ({ value: d.id, label: d.name })));
      if (catRes.data) setCategories(catRes.data.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name })));
      setLoading(false);
    }
    void fetchAll();
    return () => { cancelled = true; };
  }, []);

  const counts = useMemo(() => {
    let functional = 0, needsRepair = 0, nonFunctional = 0, underMaintenance = 0, essential = 0, highRisk = 0, replacementReview = 0;
    for (const row of allRows) {
      if (row.condition === 'functional') functional++;
      if (row.condition === 'needs_repair') needsRepair++;
      if (row.condition === 'non_functional') nonFunctional++;
      if (row.condition === 'under_maintenance') underMaintenance++;
      if (isEssentialAsset(row)) essential++;
      if (isHighRiskAsset(row)) highRisk++;
      const band = replacementBand(row.rpi);
      if (band === 'strong' || band === 'review') replacementReview++;
    }
    return { total: allRows.length, functional, needsRepair, nonFunctional, underMaintenance, essential, highRisk, replacementReview };
  }, [allRows]);

  const deptChartData = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of allRows) {
      const dept = row.departments?.name ?? 'Unknown';
      map.set(dept, (map.get(dept) ?? 0) + 1);
    }
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    return { labels: entries.map(([k]) => k), values: entries.map(([, v]) => v) };
  }, [allRows]);

  const conditionChartData = useMemo(() => {
    const ORDER = ['functional', 'needs_repair', 'non_functional', 'under_maintenance', 'decommissioned'];
    const map = new Map<string, number>();
    for (const row of allRows) map.set(row.condition, (map.get(row.condition) ?? 0) + 1);
    const entries = ORDER.map((k) => [k, map.get(k) ?? 0] as [string, number]).filter(([, v]) => v > 0);
    return {
      labels: entries.map(([k]) => formatEquipmentCondition(k)),
      values: entries.map(([, v]) => v),
      colors: entries.map(([k]) => CONDITION_CHART_COLORS[k] ?? 'rgb(107,114,128)'),
    };
  }, [allRows]);

  const filteredRows = useMemo(() => {
    let rows = allRows;
    if (filterDept) rows = rows.filter((r) => r.departments?.id === filterDept);
    if (filterCat) rows = rows.filter((r) => r.equipment_categories?.id === filterCat);
    if (filterCondition) rows = rows.filter((r) => r.condition === filterCondition);
    if (filterCriticality) rows = rows.filter((r) => r.equipment_categories?.criticality_level === filterCriticality);
    if (filterRisk) rows = rows.filter((r) => r.riskLevel === filterRisk);
    if (filterBand) rows = rows.filter((r) => replacementBand(r.rpi) === filterBand);
    if (quickFilter === 'essential') rows = rows.filter(isEssentialAsset);
    if (quickFilter === 'high_risk') rows = rows.filter(isHighRiskAsset);
    if (quickFilter === 'replacement_candidate') rows = rows.filter((r) => {
      const b = replacementBand(r.rpi); return b === 'strong' || b === 'review';
    });
    if (quickFilter === 'non_functional') rows = rows.filter((r) => r.condition === 'non_functional');
    if (quickFilter === 'under_maintenance') rows = rows.filter((r) => r.condition === 'under_maintenance');
    if (quickFilter === 'needs_repair') rows = rows.filter((r) => r.condition === 'needs_repair');
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.asset_code.toLowerCase().includes(q) ||
        (r.departments?.name ?? '').toLowerCase().includes(q),
      );
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows, filterDept, filterCat, filterCondition, filterCriticality, filterRisk, filterBand, search, quickFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Equipment Overview"
        description="Read-only inventory and risk view for management. All actions open read-only evidence — no editing or workflow initiation."
        breadcrumbs={[{ label: 'Command Center', href: '/command' }, { label: 'Equipment Overview' }]}
        actions={<Badge variant="default">Read-only view</Badge>}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <SummaryCard label="Total Assets" value={counts.total} icon={<Monitor className="h-4 w-4" />} color="blue" onClick={() => { setQuickFilter(''); setFilterCondition(''); }} active={quickFilter === '' && !filterCondition} />
        <SummaryCard label="Functional" value={counts.functional} icon={<CheckCircle2 className="h-4 w-4" />} color="green" onClick={() => { setFilterCondition('functional'); setQuickFilter(''); }} active={filterCondition === 'functional'} />
        <SummaryCard label="Needs Repair" value={counts.needsRepair} icon={<Wrench className="h-4 w-4" />} color="yellow" onClick={() => setQuickFilter('needs_repair')} active={quickFilter === 'needs_repair'} />
        <SummaryCard label="Non-functional" value={counts.nonFunctional} icon={<AlertTriangle className="h-4 w-4" />} color="red" onClick={() => setQuickFilter('non_functional')} active={quickFilter === 'non_functional'} />
        <SummaryCard label="Under Maintenance" value={counts.underMaintenance} icon={<Clock className="h-4 w-4" />} color="purple" onClick={() => setQuickFilter('under_maintenance')} active={quickFilter === 'under_maintenance'} />
        <SummaryCard label="Critical Assets" value={counts.essential} icon={<ShieldAlert className="h-4 w-4" />} color="orange" onClick={() => setQuickFilter('essential')} active={quickFilter === 'essential'} sub="High/Critical criticality" />
        <SummaryCard label="High-Risk Assets" value={counts.highRisk} icon={<Activity className="h-4 w-4" />} color="red" onClick={() => setQuickFilter('high_risk')} active={quickFilter === 'high_risk'} sub="risk_level High/Critical" />
        <SummaryCard label="Replacement Review" value={counts.replacementReview} icon={<TrendingUp className="h-4 w-4" />} color="orange" onClick={() => setQuickFilter('replacement_candidate')} active={quickFilter === 'replacement_candidate'} sub="RPI ≥ 0.55" />
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Equipment by Department">
          {deptChartData.labels.length > 0 ? <BarChart labels={deptChartData.labels} datasets={[{ label: 'Assets', data: deptChartData.values }]} /> : <p className="py-6 text-center text-sm text-[var(--text-muted)]">No data.</p>}
        </ChartCard>
        <ChartCard title="Equipment by Condition">
          {conditionChartData.labels.length > 0 ? <DoughnutChart labels={conditionChartData.labels} data={conditionChartData.values} colors={conditionChartData.colors} /> : <p className="py-6 text-center text-sm text-[var(--text-muted)]">No data.</p>}
        </ChartCard>
      </div>

      {/* Filters */}
      <div className="panel-surface flex flex-wrap items-end gap-3 rounded-xl p-4">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by asset name, code, or department"
          className="flex-1 min-w-[200px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm"
        />
        <select value={filterDept} onChange={(e) => { setFilterDept(e.target.value); setPage(1); }} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm">
          <option value="">All Departments</option>
          {departments.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        <select value={filterCat} onChange={(e) => { setFilterCat(e.target.value); setPage(1); }} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm">
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={filterCondition} onChange={(e) => { setFilterCondition(e.target.value); setPage(1); }} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm">
          <option value="">All Conditions</option>
          {EQUIPMENT_CONDITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterCriticality} onChange={(e) => { setFilterCriticality(e.target.value); setPage(1); }} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm">
          <option value="">All Criticality</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={filterRisk} onChange={(e) => { setFilterRisk(e.target.value); setPage(1); }} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm">
          <option value="">All Risk levels</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={filterBand} onChange={(e) => { setFilterBand(e.target.value); setPage(1); }} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm">
          <option value="">All Replacement bands</option>
          <option value="strong">Strong (RPI ≥ 0.70)</option>
          <option value="review">Review (0.55–0.69)</option>
          <option value="monitor">Monitor (&lt; 0.55)</option>
        </select>
      </div>

      {/* Table */}
      <div className="panel-surface overflow-x-auto rounded-xl">
        <table className="min-w-[920px] w-full text-sm">
          <thead className="border-b border-[var(--border-subtle)]/60">
            <tr className="text-left">
              <th className="px-4 py-3 text-xs uppercase tracking-wider text-[var(--text-muted)]">Asset</th>
              <th className="px-4 py-3 text-xs uppercase tracking-wider text-[var(--text-muted)]">Department</th>
              <th className="px-4 py-3 text-xs uppercase tracking-wider text-[var(--text-muted)]">Category</th>
              <th className="px-4 py-3 text-xs uppercase tracking-wider text-[var(--text-muted)]">Condition</th>
              <th className="px-4 py-3 text-xs uppercase tracking-wider text-[var(--text-muted)]">Criticality</th>
              <th className="px-4 py-3 text-xs uppercase tracking-wider text-[var(--text-muted)]">Risk</th>
              <th className="px-4 py-3 text-xs uppercase tracking-wider text-[var(--text-muted)]">Replacement Band</th>
              <th className="px-4 py-3 text-xs uppercase tracking-wider text-[var(--text-muted)]">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]/60">
            {pageRows.map((row) => {
              const band = replacementBand(row.rpi);
              return (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <Link href={viewerEquipmentDetail(row.id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">{row.name}</Link>
                    <p className="text-xs text-[var(--text-muted)]">{row.asset_code}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{row.departments?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{row.equipment_categories?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${getConditionBadgeClass(row.condition)}`}>
                      {formatEquipmentCondition(row.condition)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{row.equipment_categories?.criticality_level ?? '—'}</td>
                  <td className="px-4 py-3">
                    {row.riskLevel ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${row.riskLevel === 'critical' ? 'bg-rose-500/15 text-rose-300' : row.riskLevel === 'high' ? 'bg-orange-500/15 text-orange-300' : row.riskLevel === 'medium' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                        {row.riskLevel} {typeof row.rpn === 'number' ? `(RPN ${row.rpn})` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-subtle)]">No score</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {typeof row.rpi === 'number' ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${band === 'strong' ? 'bg-rose-500/15 text-rose-300' : band === 'review' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                        {band === 'strong' ? 'Strong' : band === 'review' ? 'Review' : 'Monitor'} ({Math.round(row.rpi * 100)})
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-subtle)]">No score</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Link href={viewerEquipmentDetail(row.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">
                        Asset Profile
                      </Link>
                      <Link href={viewerReplacementEvidence(row.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">
                        Risk Explanation
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">No equipment matches your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-[var(--text-muted)]">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-md border border-[var(--border-subtle)] px-3 py-1 text-xs disabled:opacity-40">Prev</button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-md border border-[var(--border-subtle)] px-3 py-1 text-xs disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
