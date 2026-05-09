import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, Info } from 'lucide-react';
import { requireRole } from '@/lib/auth/helpers';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import {
  buildCriticalActions,
  fetchCalibrationTriage,
  fetchCorrectiveMaintenanceTriage,
  fetchNeedsRequestTriage,
  fetchPMTriage,
  fetchProactiveRiskWatch,
  fetchStockBlockers,
  fetchInstallationTriage,
  fetchProcurementTriage,
  fetchWorkQueue,
  type ReplacementTriageRow,
} from '../../_lib/command-center-data';
import { ScoreExplanation } from '../../_components/ScoreExplanation';
import { buildReplacementReason } from '@/utils/decision-support/command-center-reasons';
import {
  createMaintenanceRequestFromAsset,
  equipmentDetail,
  replacementEvidence,
} from '../../_lib/command-center-routes';

type DrilldownType =
  | 'total-equipment'
  | 'functional'
  | 'non-functional'
  | 'open-work-orders'
  | 'critical-actions'
  | 'overdue-pm'
  | 'calibration'
  | 'stock-blockers'
  | 'installation'
  | 'procurement'
  | 'replacement';

type EquipmentRow = {
  id: string;
  name: string;
  asset_code: string;
  condition: string | null;
  status: string | null;
  departments?: { name?: string } | null;
  equipment_categories?: { name?: string; criticality_level?: string } | null;
};

const TITLES: Record<DrilldownType, { title: string; description: string }> = {
  'total-equipment': { title: 'Inventory Breakdown', description: 'All active equipment with health and risk context' },
  functional: { title: 'Operational Assets', description: 'Functional active assets with availability, MTBF, PM, and risk indicators' },
  'non-functional': { title: 'Affected Assets', description: 'Non-functional, needs-repair, and under-maintenance assets with corrective-work status' },
  'open-work-orders': { title: 'Work Queue', description: 'Open, assigned, in-progress, and on-hold work orders' },
  'critical-actions': { title: 'Urgent Queue', description: 'Critical actions rebuilt from corrected triage categories' },
  'overdue-pm': { title: 'Overdue PM', description: 'Preventive maintenance tasks past their scheduled date' },
  calibration: { title: 'Calibration Queue', description: 'Calibration due or overdue items' },
  'stock-blockers': { title: 'Stock Blockers', description: 'Parts at or below reorder level' },
  installation: { title: 'Installation Queue', description: 'Pending installation and commissioning items' },
  procurement: { title: 'Procurement Requests', description: 'Procurement requests requiring status updates or escalation' },
  replacement: { title: 'Lifecycle Decisions', description: 'Replacement candidates and RPI evidence' },
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function deptName(row: EquipmentRow): string {
  return Array.isArray(row.departments) ? row.departments[0]?.name ?? 'Unknown' : row.departments?.name ?? 'Unknown';
}

async function getOpenCorrectiveSets(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [woRes, mrRes] = await Promise.all([
    supabase.from('work_orders').select('id, asset_id').eq('work_type', 'corrective').in('status', ['open', 'assigned', 'in_progress', 'on_hold']).limit(500),
    supabase.from('maintenance_requests').select('id, asset_id').in('status', ['pending', 'approved', 'assigned', 'in_progress']).limit(500),
  ]);
  const woMap = new Map(((woRes.data ?? []) as Array<{ id: string; asset_id: string | null }>).filter((r) => r.asset_id).map((r) => [r.asset_id as string, r.id]));
  const mrMap = new Map(((mrRes.data ?? []) as Array<{ id: string; asset_id: string | null }>).filter((r) => r.asset_id).map((r) => [r.asset_id as string, r.id]));
  return {
    wo: new Set(woMap.keys()),
    mr: new Set(mrMap.keys()),
    woMap,
    mrMap,
  };
}

async function getRiskByAsset(supabase: Awaited<ReturnType<typeof createClient>>, assetIds: string[]) {
  if (assetIds.length === 0) return new Map<string, { rpn: number | null; risk_level: string | null; severity: number | null; occurrence: number | null; detectability: number | null }>();
  const { data } = await supabase
    .from('equipment_risk_scores')
    .select('asset_id, severity, occurrence, detectability, rpn, risk_level, assessed_at')
    .in('asset_id', assetIds)
    .order('assessed_at', { ascending: false })
    .limit(600);
  const map = new Map<string, { rpn: number | null; risk_level: string | null; severity: number | null; occurrence: number | null; detectability: number | null }>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const assetId = row.asset_id as string | null;
    if (!assetId || map.has(assetId)) continue;
    map.set(assetId, {
      rpn: row.rpn == null ? null : Number(row.rpn),
      risk_level: (row.risk_level as string | null) ?? null,
      severity: row.severity == null ? null : Number(row.severity),
      occurrence: row.occurrence == null ? null : Number(row.occurrence),
      detectability: row.detectability == null ? null : Number(row.detectability),
    });
  }
  return map;
}

async function getHealthByAsset(supabase: Awaited<ReturnType<typeof createClient>>, assetIds: string[]) {
  if (assetIds.length === 0) return new Map<string, number>();
  const { data } = await supabase.from('v_asset_health_summary').select('asset_id, health_score').in('asset_id', assetIds).limit(600);
  return new Map(((data ?? []) as Array<Record<string, unknown>>).map((row) => [row.asset_id as string, Number(row.health_score ?? 0)]));
}

async function renderEquipmentDrilldown(type: DrilldownType, supabase: Awaited<ReturnType<typeof createClient>>, canMutate: boolean) {
  let query = supabase
    .from('equipment_assets')
    .select('id, name, asset_code, condition, status, departments(name), equipment_categories(name, criticality_level)')
    .is('deleted_at', null)
    .eq('status', 'active')
    .order('name', { ascending: true })
    .limit(200);

  if (type === 'functional') query = query.eq('condition', 'functional');
  if (type === 'non-functional') query = query.in('condition', ['non_functional', 'needs_repair', 'under_maintenance']);

  const { data, error } = await query;
  if (error) return <p className="py-6 text-sm text-[var(--text-muted)]">Unable to load equipment drilldown.</p>;

  const rows = (data ?? []) as EquipmentRow[];
  const assetIds = rows.map((r) => r.id);
  const [riskByAsset, healthByAsset, correctiveSets] = await Promise.all([
    getRiskByAsset(supabase, assetIds),
    getHealthByAsset(supabase, assetIds),
    getOpenCorrectiveSets(supabase),
  ]);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[920px] w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)]/60 text-left">
            <th className="pb-2 pr-4 text-[var(--text-muted)]">Asset</th>
            <th className="pb-2 pr-4 text-[var(--text-muted)]">Department</th>
            <th className="pb-2 pr-4 text-[var(--text-muted)]">Category</th>
            <th className="pb-2 pr-4 text-[var(--text-muted)]">Condition</th>
            <th className="pb-2 pr-4 text-[var(--text-muted)]">Health</th>
            <th className="pb-2 pr-4 text-[var(--text-muted)]">RPN</th>
            {type === 'non-functional' && <th className="pb-2 pr-4 text-[var(--text-muted)]">Open corrective</th>}
            <th className="pb-2 text-[var(--text-muted)]">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-subtle)]/60">
          {rows.map((row) => {
            const risk = riskByAsset.get(row.id);
            const health = healthByAsset.get(row.id) ?? null;
            const hasRequest = correctiveSets.mr.has(row.id);
            const hasWork = correctiveSets.wo.has(row.id);
            return (
              <tr key={row.id}>
                <td className="py-3 pr-4">
                  <Link href={`/equipment/${row.id}`} className="font-medium text-[var(--foreground)] hover:text-violet-300">{row.name}</Link>
                  <p className="text-xs text-[var(--text-muted)]">{row.asset_code}</p>
                </td>
                <td className="py-3 pr-4 text-[var(--text-muted)]">{deptName(row)}</td>
                <td className="py-3 pr-4 text-[var(--text-muted)]">{row.equipment_categories?.name ?? 'Unknown'} · {row.equipment_categories?.criticality_level ?? 'no criticality'}</td>
                <td className="py-3 pr-4"><Badge variant={row.condition === 'functional' ? 'success' : 'warning'}>{row.condition?.replace(/_/g, ' ') ?? 'unknown'}</Badge></td>
                <td className="py-3 pr-4">
                  {health == null ? '—' : (
                    <ScoreExplanation details={{
                      title: `Health score — ${row.name}`,
                      scoreLabel: `${health}/100`,
                      formula: 'Health score from latest equipment health snapshot',
                      criteria: ['Operational condition', 'Risk signals', 'Maintenance status', 'Reliability indicators where available'],
                      rawValues: [{ label: 'Health score', value: health }],
                      calculation: `${health}/100 from v_asset_health_summary`,
                      generatedReason: 'Latest health snapshot for this asset.',
                      source: 'v_asset_health_summary',
                      assignmentMethod: 'Computed snapshot',
                      actionSuggestion: 'Review asset detail before deciding action.',
                    }}>{health}/100</ScoreExplanation>
                  )}
                </td>
                <td className="py-3 pr-4">
                  {risk?.rpn == null ? '—' : (
                    <ScoreExplanation details={{
                      title: `RPN — ${row.name}`,
                      scoreLabel: `${risk.rpn}`,
                      formula: 'RPN = Severity × Occurrence × Detectability',
                      criteria: ['Severity', 'Occurrence', 'Detectability'],
                      rawValues: [
                        { label: 'Severity', value: risk.severity },
                        { label: 'Occurrence', value: risk.occurrence },
                        { label: 'Detectability', value: risk.detectability },
                        { label: 'Risk level', value: risk.risk_level },
                      ],
                      calculation: `${risk.severity ?? '?'} × ${risk.occurrence ?? '?'} × ${risk.detectability ?? '?'} = ${risk.rpn}`,
                      generatedReason: `Risk band is ${risk.risk_level ?? 'not available'}.`,
                      source: 'equipment_risk_scores',
                      assignmentMethod: 'Computed FMEA score',
                      actionSuggestion: 'Review risk controls and maintenance history.',
                    }}>{risk.rpn}</ScoreExplanation>
                  )}
                </td>
                {type === 'non-functional' && <td className="py-3 pr-4 text-[var(--text-muted)]">{hasRequest ? 'Request exists' : hasWork ? 'Work order exists' : 'No open request'}</td>}
                <td className="py-3">
                  <div className="flex flex-wrap gap-2">
                    {type === 'non-functional' && canMutate && !hasRequest && !hasWork && <Link href={createMaintenanceRequestFromAsset(row.id, { urgency: 'high', description: `Command Center detected ${row.name} is ${row.condition?.replace(/_/g, ' ')} with no open corrective request.` })} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Create Request</Link>}
                    {type === 'non-functional' && hasRequest && <Link href={`/maintenance/requests/${correctiveSets.mrMap.get(row.id)}`} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)]">Open Request</Link>}
                    {type === 'non-functional' && hasWork && <Link href={`/maintenance/work-orders/${correctiveSets.woMap.get(row.id)}`} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)]">Open Work</Link>}
                    <Link href={equipmentDetail(row.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)]">View Equipment</Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function renderWorkOrders(supabase: Awaited<ReturnType<typeof createClient>>, canMutate: boolean) {
  const rows = await fetchWorkQueue(supabase);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[760px] w-full text-sm">
        <thead><tr className="border-b border-[var(--border-subtle)]/60 text-left"><th className="pb-2 pr-4 text-[var(--text-muted)]">Work order</th><th className="pb-2 pr-4 text-[var(--text-muted)]">Asset</th><th className="pb-2 pr-4 text-[var(--text-muted)]">Assigned</th><th className="pb-2 pr-4 text-[var(--text-muted)]">Age</th><th className="pb-2 pr-4 text-[var(--text-muted)]">Priority</th><th className="pb-2 text-[var(--text-muted)]">Action</th></tr></thead>
        <tbody className="divide-y divide-[var(--border-subtle)]/60">{rows.map((row) => (
          <tr key={row.id}><td className="py-3 pr-4 font-medium">{row.workOrderNumber}<p className="text-xs text-[var(--text-muted)]">{row.status}</p></td><td className="py-3 pr-4">{row.assetName}<p className="text-xs text-[var(--text-muted)]">{row.assetCode}</p></td><td className="py-3 pr-4 text-[var(--text-muted)]">{row.assignedToName ?? 'Unassigned'}</td><td className="py-3 pr-4">{row.daysOpen}d</td><td className="py-3 pr-4"><Badge variant={row.priority === 'critical' ? 'error' : row.priority === 'high' ? 'warning' : 'info'}>{row.priority ?? 'low'}</Badge></td><td className="py-3"><div className="flex gap-2">{canMutate && <Link href={row.primaryActionHref} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">{row.primaryAction}</Link>}<Link href={row.detailHref} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)]">Open Work Order</Link></div></td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

async function getReplacementRows(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ rows: ReplacementTriageRow[]; total: number }> {
  const { data, error } = await supabase
    .from('v_replacement_decision')
    .select('asset_id, asset_code, asset_name, department_name, age_score, failure_score, availability_score, maintenance_burden_score, spare_part_score, risk_score, cost_score, replacement_priority_index, replacement_rank, justification')
    .order('replacement_priority_index', { ascending: false })
    .limit(100);
  if (error) return { rows: [], total: 0 };
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const item = {
      asset_id: row.asset_id as string,
      asset_name: (row.asset_name as string | undefined) ?? 'Unknown',
      asset_code: (row.asset_code as string | undefined) ?? 'N/A',
      department_name: (row.department_name as string | undefined) ?? 'Unknown',
      age_score: row.age_score as number | null,
      failure_score: row.failure_score as number | null,
      availability_score: row.availability_score as number | null,
      maintenance_burden_score: row.maintenance_burden_score as number | null,
      spare_part_score: row.spare_part_score as number | null,
      risk_score: row.risk_score as number | null,
      cost_score: row.cost_score as number | null,
      priority_index: Number(row.replacement_priority_index ?? 0),
      rank: Number(row.replacement_rank ?? 0),
    };
    return {
      ...item,
      reason: buildReplacementReason({
        rank: item.rank,
        priorityIndex: item.priority_index,
        ageScore: item.age_score,
        failureScore: item.failure_score,
        availabilityScore: item.availability_score,
        maintenanceBurdenScore: item.maintenance_burden_score,
        sparePartScore: item.spare_part_score,
        riskScore: item.risk_score,
        costScore: item.cost_score,
        justification: (row.justification as string | null) ?? null,
      }),
    };
  });
  return { rows, total: rows.length };
}

export default async function CommandDrilldownPage({ params }: { params: Promise<{ type: string }> }) {
  const { type: rawType } = await params;
  const type = rawType as DrilldownType;
  const meta = TITLES[type] ?? TITLES['total-equipment'];
  const profile = await requireRole(['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer']);
  const canMutate = Boolean(profile.roleNames?.some((role: string) => ['developer', 'admin', 'bme_head', 'store_user'].includes(role)));
  const supabase = await createClient();

  let content: ReactNode;
  if (type === 'total-equipment' || type === 'functional' || type === 'non-functional') {
    content = await renderEquipmentDrilldown(type, supabase, canMutate);
  } else if (type === 'open-work-orders') {
    content = await renderWorkOrders(supabase, canMutate);
  } else if (type === 'critical-actions') {
    const [corrective, needsRequest, proactiveRisk, calibration, pm, stock, installation, replacement, procurement] = await Promise.all([
      fetchCorrectiveMaintenanceTriage(supabase),
      fetchNeedsRequestTriage(supabase),
      fetchProactiveRiskWatch(supabase),
      fetchCalibrationTriage(supabase),
      fetchPMTriage(supabase),
      fetchStockBlockers(supabase),
      fetchInstallationTriage(supabase),
      getReplacementRows(supabase),
      fetchProcurementTriage(supabase),
    ]);
    const actions = buildCriticalActions({
      corrective: corrective.rows,
      needsRequest: needsRequest.rows,
      proactiveRisk: proactiveRisk.rows,
      calibration: calibration.rows,
      pm: pm.rows,
      stockBlockers: stock.rows,
      installation: installation.rows,
      replacement: replacement.rows,
      procurement: procurement.rows,
      training: [],
    });
    content = (
      <div className="space-y-3">
        {actions.map((item) => (
          <div key={item.id} className="rounded-lg border border-[var(--border-subtle)]/60 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-medium">{item.title}</p><p className="text-xs text-[var(--text-muted)]">{item.category.replace(/_/g, ' ')} · {item.reason}</p></div>
              <div className="flex flex-wrap gap-2">
                <ScoreExplanation details={{ title: `Critical action score — ${item.title}`, scoreLabel: `${Math.round(item.score)}`, formula: 'category base weight + item score contribution', criteria: ['Category weight', 'Urgency/severity', 'Delay/age', 'Blocking impact'], rawValues: [{ label: 'Breakdown', value: item.scoreBreakdown?.join(' · ') ?? 'Not available' }], calculation: item.scoreBreakdown?.join(' + ') ?? `${Math.round(item.score)}`, generatedReason: item.reason, source: 'Command Center corrected triage arrays', assignmentMethod: 'Computed', actionSuggestion: item.primaryAction }}>{Math.round(item.score)}</ScoreExplanation>
                {canMutate && <Link href={item.primaryActionHref} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">{item.primaryAction}</Link>}
                {item.secondaryActionHref && <Link href={item.secondaryActionHref} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)]">{item.secondaryAction ?? 'Details'}</Link>}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  } else if (type === 'overdue-pm') {
    const pm = await fetchPMTriage(supabase, { limit: null });
    content = <SimpleRows rows={pm.rows.map((row) => ({ id: row.id, title: row.assetName, sub: `${row.assetCode} · ${row.departmentName} · ${row.daysOverdue}d overdue`, score: row.score, reason: row.reason, href: row.detailHref, action: canMutate ? 'Schedule PM' : 'Details' }))} scoreKind="PM priority" />;
  } else if (type === 'calibration') {
    const calibration = await fetchCalibrationTriage(supabase, { limit: null });
    content = <SimpleRows rows={calibration.rows.map((row) => ({ id: row.id, title: row.assetName, sub: `${row.assetCode} · due ${formatDate(row.nextDueDate)} · ${row.daysOverdue}d overdue`, score: row.score, reason: row.reason, href: canMutate ? row.scheduleHref : row.detailHref, action: canMutate ? 'Schedule Calibration' : 'Details' }))} scoreKind="Calibration priority" />;
  } else if (type === 'stock-blockers') {
    const stock = await fetchStockBlockers(supabase, { limit: null });
    content = <SimpleRows rows={stock.rows.map((row) => ({ id: row.id, title: row.partName, sub: `${row.partCode} · ${row.blockerType.replace(/_/g, ' ')} · current ${row.currentStock} · reorder ${row.reorderLevel}`, score: row.score, reason: row.reason, href: canMutate ? row.procurementHref : row.detailHref, action: canMutate ? 'Request Procurement' : 'Details' }))} scoreKind="Stock blocker" />;
  } else if (type === 'installation') {
    const installation = await fetchInstallationTriage(supabase);
    content = <SimpleRows rows={installation.rows.map((row) => ({ id: row.id, title: row.assetName, sub: `${row.assetCode} · ${row.departmentName} · ${row.daysPending}d pending`, score: row.score, reason: row.reason, href: canMutate ? row.scheduleHref : row.assetHref, action: canMutate ? 'Schedule Installation' : 'View Asset' }))} scoreKind="Installation priority" />;
  } else if (type === 'procurement') {
    const procurement = await fetchProcurementTriage(supabase);
    content = <SimpleRows rows={procurement.rows.map((row) => ({ id: row.id, title: row.requestNumber, sub: `${row.status} · ${row.priority ?? 'medium'} · ${row.daysDelayed}d`, score: row.score, reason: row.reason, href: row.detailHref, action: canMutate ? 'Update Status' : 'View Request' }))} scoreKind="Procurement priority" />;
  } else {
    const replacement = await getReplacementRows(supabase);
    content = <SimpleRows rows={replacement.rows.map((row) => ({ id: row.asset_id, title: row.asset_name, sub: `${row.asset_code} · ${row.department_name} · rank ${row.rank}`, score: Math.round(row.priority_index * 100), reason: row.reason, href: replacementEvidence(row.asset_id), action: 'View Evidence' }))} scoreKind="Replacement Priority Index" />;
  }

  return (
    <div className="space-y-6">
      <Link href="/command" className="inline-flex items-center gap-1 text-sm text-violet-300 hover:text-violet-200"><ArrowLeft className="h-4 w-4" /> Command Center</Link>
      <PageHeader title={meta.title} description={meta.description} />
      <div className="rounded-md border border-violet-500/30 bg-violet-500/10 p-3 text-xs text-violet-200">
        <Info className="mr-1 inline h-3.5 w-3.5" />
        Drilldowns show filtered operational evidence. Composite values are explainable; final decisions remain with the BME Head.
      </div>
      <Card><CardHeader><CardTitle>{meta.title}</CardTitle></CardHeader><CardContent>{content}</CardContent></Card>
    </div>
  );
}

function SimpleRows({ rows, scoreKind }: { rows: Array<{ id: string; title: string; sub: string; score: number; reason: string; href: string; action: string }>; scoreKind: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-[var(--text-muted)]">No items in this drilldown.</p>;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)]/60 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-medium">{row.title}</p><p className="text-xs text-[var(--text-muted)]">{row.sub}</p><p className="text-xs text-[var(--text-muted)]/80">{row.reason}</p></div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <ScoreExplanation details={{ title: `${scoreKind} — ${row.title}`, scoreLabel: `${row.score}`, formula: 'category-specific Command Center priority formula', criteria: ['Category base', 'Delay/urgency', 'Operational impact'], rawValues: [{ label: 'Displayed score', value: row.score }], calculation: `${row.score}`, generatedReason: row.reason, source: 'Command Center drilldown fetcher', assignmentMethod: 'Computed', actionSuggestion: row.action }}>{row.score}</ScoreExplanation>
            <Link href={row.href} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)]">{row.action}</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
