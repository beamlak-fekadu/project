'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  Activity, ArrowUpDown, CalendarCheck, Pencil, ShieldAlert,
} from 'lucide-react';
import {
  PageHeader, Button, Card, CardHeader, CardTitle, CardContent,
  Tabs, Table, Spinner,
} from '@/components/ui';
import { ConditionBadge, PMStatusBadge, RiskBadge } from '@/components/ui/StatusBadge';
import { getEquipmentById } from '@/services/equipment.service';
import { getMaintenanceEvents } from '@/services/maintenance.service';
import { getPMSchedules } from '@/services/pm.service';
import { getCalibrationRecords } from '@/services/calibration.service';
import { getReliabilityMetrics, getRiskScores, getPMComplianceMetrics, getReplacementPriorities } from '@/services/analytics.service';
import { explainRiskScore, type RiskExplanation } from '@/services/risk-assessment.service';
import { ROUTES } from '@/constants';
import { AskAiButton } from '@/components/assistant/AskAiButton';
import type {
  EquipmentCondition, PMScheduleStatus, CalibrationResult, RiskLevel,
} from '@/types/database';

interface EquipmentDetail {
  id: string;
  asset_code: string;
  serial_number: string | null;
  name: string;
  condition: EquipmentCondition;
  status: string;
  installation_date: string | null;
  warranty_expiry: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  source: string | null;
  notes: string | null;
  departments: { id: string; name: string } | null;
  equipment_categories: { id: string; name: string; criticality_level: string | null } | null;
  manufacturers: { id: string; name: string; country: string | null } | null;
  equipment_models: { id: string; name: string } | null;
  [key: string]: unknown;
}

interface MaintenanceEventRow {
  id: string;
  event_type: string;
  action_taken: string | null;
  repair_duration_hours: number | null;
  service_cost: number | null;
  completion_date: string | null;
  failure_codes: { code: string; description: string } | null;
  [key: string]: unknown;
}

interface PMScheduleRow {
  id: string;
  scheduled_date: string;
  status: PMScheduleStatus;
  profiles: { full_name: string } | null;
  [key: string]: unknown;
}

interface CalibrationRow {
  id: string;
  calibration_date: string;
  result: CalibrationResult;
  next_due_date: string | null;
  calibrated_by: string | null;
  calibration_types: { name: string } | null;
  [key: string]: unknown;
}

interface ReliabilityRow {
  mttr_hours: number | null;
  mtbf_hours: number | null;
  availability_ratio: number | null;
  failure_count: number;
  [key: string]: unknown;
}

interface RiskRow {
  severity: number;
  occurrence: number;
  detectability: number;
  rpn: number;
  risk_level: RiskLevel;
  assessed_at: string;
  computed_at?: string | null;
  assignment_method?: 'computed' | 'manual_override' | 'seeded_demo';
  override_reason?: string | null;
  explanation?: RiskExplanation | null;
  [key: string]: unknown;
}

interface PMComplianceRow {
  pmc_percentage: number;
  scheduled_count: number;
  completed_count: number;
  [key: string]: unknown;
}

interface ReplacementRow {
  replacement_priority_index: number;
  rank: number;
  justification: string | null;
  [key: string]: unknown;
}

function formatDate(val: string | null): string {
  if (!val) return '—';
  return new Date(val).toLocaleDateString();
}

function formatCurrency(val: number | null): string {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'ETB' }).format(val);
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <dt className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd className="text-sm text-gray-900 dark:text-white">{value || '—'}</dd>
    </div>
  );
}

function HealthMetricCard({
  title,
  icon,
  children,
  hasData,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  hasData: boolean;
}) {
  return (
    <div className="panel-surface rounded-lg p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-md bg-[var(--surface-2)] p-2 text-[var(--brand)]">{icon}</span>
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
      </div>
      {hasData ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">No data yet — complete one work order to compute</p>
      )}
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-semibold text-[var(--foreground)]">{value}</span>
    </div>
  );
}

function RiskReasonLine({ label, score, reason }: { label: string; score: number; reason: string }) {
  return (
    <div className="space-y-1 rounded-md bg-[var(--surface-2)]/60 p-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-[var(--text-muted)]">{label}</span>
        <span className="font-semibold text-[var(--foreground)]">{score}</span>
      </div>
      <p className="text-xs leading-5 text-[var(--text-muted)]">{reason}</p>
    </div>
  );
}

export default function EquipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [equipment, setEquipment] = useState<EquipmentDetail | null>(null);
  const [events, setEvents] = useState<MaintenanceEventRow[]>([]);
  const [schedules, setSchedules] = useState<PMScheduleRow[]>([]);
  const [calibrations, setCalibrations] = useState<CalibrationRow[]>([]);
  const [reliability, setReliability] = useState<ReliabilityRow | null>(null);
  const [risk, setRisk] = useState<RiskRow | null>(null);
  const [pmCompliance, setPmCompliance] = useState<PMComplianceRow | null>(null);
  const [replacement, setReplacement] = useState<ReplacementRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data, error: fetchError } = await getEquipmentById(id);
      if (fetchError || !data) {
        setError(fetchError?.message ?? 'Equipment not found');
        setLoading(false);
        return;
      }
      setEquipment(data as unknown as EquipmentDetail);

      const [eventsRes, pmRes, calRes, relRes, riskRes, pmcRes, repRes] = await Promise.all([
        getMaintenanceEvents(id),
        getPMSchedules({ asset_id: id }),
        getCalibrationRecords({ asset_id: id }),
        getReliabilityMetrics({ asset_id: id }),
        getRiskScores({ asset_id: id }),
        getPMComplianceMetrics({ asset_id: id }),
        getReplacementPriorities({ asset_id: id }),
      ]);

      setEvents((eventsRes.data as unknown as MaintenanceEventRow[]) ?? []);
      setSchedules((pmRes.data as unknown as PMScheduleRow[]) ?? []);
      setCalibrations((calRes.data as unknown as CalibrationRow[]) ?? []);

      const relData = relRes.data as unknown as ReliabilityRow[] | null;
      if (relData?.length) {
        // Prefer the row with real MTBF/MTTR data over the most-recent recomputed row
        // that may have NULLs (rolling window misses historical seed data).
        const best = relData.find(r => r.mtbf_hours != null && r.availability_ratio != null)
          ?? relData.find(r => r.availability_ratio != null)
          ?? relData[0];
        setReliability(best);
      }

      const riskData = riskRes.data as unknown as RiskRow[] | null;
      if (riskData?.length) setRisk(riskData[0]);

      const pmcData = pmcRes.data as unknown as PMComplianceRow[] | null;
      if (pmcData?.length) {
        setPmCompliance(pmcData[0]);
      } else {
        // Seeded pm_compliance_metrics rows are department-level (no asset_id).
        // Fall back to the most recent department-level row for this asset's department.
        const equip = data as unknown as EquipmentDetail;
        const deptId = equip.departments?.id;
        if (deptId) {
          const { data: deptRows } = await getPMComplianceMetrics({ department_id: deptId });
          const deptPmc = (deptRows ?? []) as unknown as PMComplianceRow[];
          if (deptPmc.length) setPmCompliance(deptPmc[0]);
        }
      }

      const repData = repRes.data as unknown as ReplacementRow[] | null;
      if (repData?.length) setReplacement(repData[0]);

      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !equipment) {
    return (
      <div className="py-12 text-center">
        <p className="text-lg text-red-600">{error ?? 'Equipment not found'}</p>
        <Link href={ROUTES.EQUIPMENT} className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          Back to Equipment
        </Link>
      </div>
    );
  }

  const overviewContent = (
    <Card>
      <CardHeader>
        <CardTitle>Equipment Information</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <DetailRow label="Asset Code" value={equipment.asset_code} />
          <DetailRow label="Serial Number" value={equipment.serial_number} />
          <DetailRow label="Name" value={equipment.name} />
          <DetailRow label="Department" value={equipment.departments?.name} />
          <DetailRow label="Category" value={equipment.equipment_categories?.name} />
          <DetailRow label="Manufacturer" value={equipment.manufacturers?.name} />
          <DetailRow label="Model" value={equipment.equipment_models?.name} />
          <DetailRow
            label="Condition"
            value={<ConditionBadge condition={equipment.condition} />}
          />
          <DetailRow
            label="Status"
            value={equipment.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          />
          <DetailRow label="Installation Date" value={formatDate(equipment.installation_date)} />
          <DetailRow label="Warranty Expiry" value={formatDate(equipment.warranty_expiry)} />
          <DetailRow label="Purchase Date" value={formatDate(equipment.purchase_date)} />
          <DetailRow label="Purchase Cost" value={formatCurrency(equipment.purchase_cost)} />
          <DetailRow label="Source" value={equipment.source} />
          <div className="sm:col-span-2">
            <DetailRow label="Notes" value={equipment.notes} />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const maintenanceColumns = [
    {
      key: 'completion_date',
      header: 'Date',
      sortable: true,
      render: (row: MaintenanceEventRow) => formatDate(row.completion_date),
    },
    {
      key: 'event_type',
      header: 'Type',
      render: (row: MaintenanceEventRow) =>
        row.event_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    },
    { key: 'action_taken', header: 'Action Taken' },
    {
      key: 'repair_duration_hours',
      header: 'Duration (hrs)',
      render: (row: MaintenanceEventRow) =>
        row.repair_duration_hours != null ? `${row.repair_duration_hours}h` : '—',
    },
    {
      key: 'failure_code',
      header: 'Failure Code',
      render: (row: MaintenanceEventRow) => row.failure_codes?.code ?? '—',
    },
    {
      key: 'service_cost',
      header: 'Cost',
      render: (row: MaintenanceEventRow) => formatCurrency(row.service_cost),
    },
  ];

  const maintenanceContent = (
    <Table
      columns={maintenanceColumns}
      data={events}
      emptyMessage="No maintenance events recorded for this equipment."
    />
  );

  const pmColumns = [
    {
      key: 'scheduled_date',
      header: 'Scheduled Date',
      sortable: true,
      render: (row: PMScheduleRow) => formatDate(row.scheduled_date),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: PMScheduleRow) => <PMStatusBadge status={row.status} />,
    },
    {
      key: 'completed_by',
      header: 'Assigned To',
      render: (row: PMScheduleRow) => row.profiles?.full_name ?? '—',
    },
  ];

  const pmContent = (
    <Table
      columns={pmColumns}
      data={schedules}
      emptyMessage="No PM schedules found for this equipment."
    />
  );

  const calibrationColumns = [
    {
      key: 'calibration_date',
      header: 'Date',
      sortable: true,
      render: (row: CalibrationRow) => formatDate(row.calibration_date),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row: CalibrationRow) => row.calibration_types?.name ?? '—',
    },
    {
      key: 'result',
      header: 'Result',
      render: (row: CalibrationRow) =>
        row.result.replace(/\b\w/g, (c) => c.toUpperCase()),
    },
    {
      key: 'next_due_date',
      header: 'Next Due',
      render: (row: CalibrationRow) => formatDate(row.next_due_date),
    },
    { key: 'calibrated_by', header: 'Calibrated By' },
  ];

  const calibrationContent = (
    <Table
      columns={calibrationColumns}
      data={calibrations}
      emptyMessage="No calibration records found for this equipment."
    />
  );

  const tabs = [
    { id: 'overview', label: 'Overview', content: overviewContent },
    { id: 'maintenance', label: 'Maintenance History', count: events.length, content: maintenanceContent },
    { id: 'pm', label: 'PM Records', count: schedules.length, content: pmContent },
    { id: 'calibration', label: 'Calibration', count: calibrations.length, content: calibrationContent },
  ];

  const hasReliability = Boolean(
    reliability && (
      reliability.mtbf_hours != null
      || reliability.availability_ratio != null
      || reliability.failure_count != null
    )
  );
  const hasRisk = Boolean(risk && risk.rpn != null && risk.risk_level && risk.severity != null && risk.occurrence != null && risk.detectability != null);
  const hasPmCompliance = Boolean(pmCompliance && pmCompliance.scheduled_count > 0 && pmCompliance.pmc_percentage != null);
  const hasReplacement = Boolean(replacement && replacement.rank != null && replacement.replacement_priority_index != null);
  const riskReasons = explainRiskScore(risk);

  return (
    <div>
      <PageHeader
        title={equipment.name}
        breadcrumbs={[
          { label: 'Equipment', href: ROUTES.EQUIPMENT },
          { label: equipment.asset_code },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <AskAiButton
              moduleLabel="Equipment"
              label="Ask AI about this equipment"
              seedPrompt="Summarize this equipment status, maintenance history, and safe first-line actions."
              contextRefs={{ equipmentId: id }}
            />
            <Link href={`${ROUTES.EQUIPMENT}/${id}/edit`}>
              <Button variant="outline">
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HealthMetricCard title="Reliability" icon={<Activity className="h-4 w-4" />} hasData={hasReliability}>
          <MetricLine label="MTBF" value={reliability?.mtbf_hours != null ? `${reliability.mtbf_hours.toFixed(1)}h` : 'N/A (0 failures)'} />
          <MetricLine label="MTTR" value={reliability?.mttr_hours != null ? `${reliability.mttr_hours.toFixed(1)}h` : 'N/A'} />
          <MetricLine label="Availability" value={reliability?.availability_ratio != null ? `${(reliability.availability_ratio * 100).toFixed(1)}%` : `${reliability?.failure_count ?? 0} failures`} />
        </HealthMetricCard>

        <HealthMetricCard title="Risk" icon={<ShieldAlert className="h-4 w-4" />} hasData={hasRisk}>
          <MetricLine label="RPN" value={risk?.rpn} />
          <MetricLine label="Band" value={risk ? <RiskBadge level={risk.risk_level} /> : null} />
          {risk && (
            <>
              <MetricLine label="Formula" value={`${risk.severity} × ${risk.occurrence} × ${risk.detectability}`} />
              <RiskReasonLine label="Severity" score={risk.severity} reason={riskReasons.severity} />
              <RiskReasonLine label="Occurrence" score={risk.occurrence} reason={riskReasons.occurrence} />
              <RiskReasonLine label="Detectability" score={risk.detectability} reason={riskReasons.detectability} />
              <MetricLine label="Last computed" value={formatDate(risk.computed_at ?? risk.assessed_at)} />
              <MetricLine
                label="Method"
                value={
                  <span className={risk.assignment_method === 'manual_override' ? 'text-amber-400' : undefined}>
                    {(risk.assignment_method ?? 'computed').replace(/_/g, ' ')}
                  </span>
                }
              />
              {risk.assignment_method === 'manual_override' && (
                <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-xs leading-5 text-amber-200">
                  Override reason: {risk.override_reason ?? 'No reason recorded'}
                </p>
              )}
              {/* TODO: wire a Developer/BME Head edit modal to fn_set_fmea_risk_manual_override. */}
              <p className="text-xs leading-5 text-[var(--text-muted)]">
                Methodology: FMEA Risk Priority Number uses Severity × Occurrence × Detectability.
                Severity reflects clinical/service impact, occurrence reflects failure history, and higher detectability means weaker PM, calibration, or inspection controls.
              </p>
            </>
          )}
        </HealthMetricCard>

        <HealthMetricCard title="PM Compliance" icon={<CalendarCheck className="h-4 w-4" />} hasData={hasPmCompliance}>
          <MetricLine label="Compliance" value={`${pmCompliance?.pmc_percentage.toFixed(1)}%`} />
          <MetricLine label="Completed / Scheduled" value={`${pmCompliance?.completed_count} / ${pmCompliance?.scheduled_count}`} />
        </HealthMetricCard>

        <HealthMetricCard title="Replacement Priority" icon={<ArrowUpDown className="h-4 w-4" />} hasData={hasReplacement}>
          <MetricLine label="Rank" value={`#${replacement?.rank}`} />
          <MetricLine label="Priority Index" value={replacement?.replacement_priority_index.toFixed(2)} />
        </HealthMetricCard>
      </div>

      <Tabs tabs={tabs} defaultTab="overview" />
    </div>
  );
}
