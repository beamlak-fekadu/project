'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  Pencil, Clock, Activity, Gauge,
} from 'lucide-react';
import {
  PageHeader, Button, Card, CardHeader, CardTitle, CardContent,
  Tabs, Table, Spinner, StatCard,
} from '@/components/ui';
import { ConditionBadge, PMStatusBadge, RiskBadge } from '@/components/ui/StatusBadge';
import { getEquipmentById } from '@/services/equipment.service';
import { getMaintenanceEvents } from '@/services/maintenance.service';
import { getPMSchedules } from '@/services/pm.service';
import { getCalibrationRecords } from '@/services/calibration.service';
import { getReliabilityMetrics, getRiskScores } from '@/services/analytics.service';
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
      <dt className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="text-sm text-[var(--foreground)]">{value || '—'}</dd>
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

      const [eventsRes, pmRes, calRes, relRes, riskRes] = await Promise.all([
        getMaintenanceEvents(id),
        getPMSchedules({ asset_id: id }),
        getCalibrationRecords({ asset_id: id }),
        getReliabilityMetrics({ asset_id: id }),
        getRiskScores({ asset_id: id }),
      ]);

      setEvents((eventsRes.data as unknown as MaintenanceEventRow[]) ?? []);
      setSchedules((pmRes.data as unknown as PMScheduleRow[]) ?? []);
      setCalibrations((calRes.data as unknown as CalibrationRow[]) ?? []);

      const relData = relRes.data as unknown as ReliabilityRow[] | null;
      if (relData?.length) setReliability(relData[0]);

      const riskData = riskRes.data as unknown as RiskRow[] | null;
      if (riskData?.length) setRisk(riskData[0]);

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
        <Link href={ROUTES.INVENTORY} className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          Back to Inventory
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

  const analyticsContent = (
    <div className="space-y-6">
      {reliability ? (
        <>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Reliability Metrics
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="MTTR"
              value={reliability.mttr_hours != null ? `${reliability.mttr_hours.toFixed(1)}h` : 'N/A'}
              icon={<Clock className="h-5 w-5" />}
              color="blue"
            />
            <StatCard
              label="MTBF"
              value={reliability.mtbf_hours != null ? `${reliability.mtbf_hours.toFixed(1)}h` : 'N/A'}
              icon={<Activity className="h-5 w-5" />}
              color="green"
            />
            <StatCard
              label="Availability"
              value={reliability.availability_ratio != null ? `${(reliability.availability_ratio * 100).toFixed(1)}%` : 'N/A'}
              icon={<Gauge className="h-5 w-5" />}
              color="purple"
            />
          </div>
        </>
      ) : (
        <Card>
          <CardContent>
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">
              No reliability metrics available for this equipment.
            </p>
          </CardContent>
        </Card>
      )}

      {risk ? (
        <>
          <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Risk Assessment
          </h3>
          <Card>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-5">
                <div className="text-center">
                  <p className="text-xs font-medium text-[var(--text-muted)]">Severity (S)</p>
                  <p className="mt-1 text-2xl font-bold text-[var(--foreground)]">{risk.severity}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium text-[var(--text-muted)]">Occurrence (O)</p>
                  <p className="mt-1 text-2xl font-bold text-[var(--foreground)]">{risk.occurrence}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium text-[var(--text-muted)]">Detectability (D)</p>
                  <p className="mt-1 text-2xl font-bold text-[var(--foreground)]">{risk.detectability}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium text-[var(--text-muted)]">RPN</p>
                  <p className="mt-1 text-2xl font-bold text-[var(--foreground)]">{risk.rpn}</p>
                </div>
                <div className="flex flex-col items-center justify-center">
                  <p className="text-xs font-medium text-[var(--text-muted)]">Risk Level</p>
                  <div className="mt-1">
                    <RiskBadge level={risk.risk_level} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent>
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">
              No risk assessment data available for this equipment.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );

  const tabs = [
    { id: 'overview', label: 'Overview', content: overviewContent },
    { id: 'maintenance', label: 'Maintenance History', count: events.length, content: maintenanceContent },
    { id: 'pm', label: 'PM Records', count: schedules.length, content: pmContent },
    { id: 'calibration', label: 'Calibration', count: calibrations.length, content: calibrationContent },
    { id: 'analytics', label: 'Analytics', content: analyticsContent },
  ];

  return (
    <div>
      <PageHeader
        title={equipment.name}
        breadcrumbs={[
          { label: 'Equipment Inventory', href: ROUTES.INVENTORY },
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
            <Link href={`${ROUTES.INVENTORY}/${id}/edit`}>
              <Button variant="outline">
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </Link>
          </div>
        }
      />

      <Tabs tabs={tabs} defaultTab="overview" />
    </div>
  );
}
