'use client';

import { useEffect, useState } from 'react';
import {
  Monitor,
  CheckCircle,
  XCircle,
  Wrench,
  CalendarX,
  Gauge,
  Package,
  AlertTriangle,
  Clock,
  MoreHorizontal,
} from 'lucide-react';
import {
  getDashboardStats,
  getEquipmentByDepartment,
  getEquipmentByCondition,
  getRecentAlerts,
  getOpenWorkOrders,
  getOverduePM,
} from '@/services/dashboard.service';
import { CONDITION_COLORS } from '@/constants';
import { StatCard, Badge, PageHeader } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import Table from '@/components/ui/Table';
import Card, { CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartCard, BarChart, DoughnutChart } from '@/components/charts';
import { UrgencyBadge, WorkOrderStatusBadge } from '@/components/ui/StatusBadge';
import type { DashboardStats } from '@/types/database';
import { AskAiButton } from '@/components/assistant/AskAiButton';

interface DeptData {
  department_name: string;
  count: number;
}

interface ConditionData {
  condition: string;
  count: number;
}

interface WorkOrderRow {
  id: string;
  work_order_number: string;
  asset_name: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'assigned' | 'in_progress' | 'on_hold' | 'completed' | 'canceled';
  department_name: string;
  created_at: string;
  [key: string]: unknown;
}

interface OverduePMRow {
  id: string;
  asset_name: string;
  plan_name: string;
  scheduled_date: string;
  days_overdue: number;
  department_name: string;
  [key: string]: unknown;
}

interface AlertRow {
  id: string;
  asset_id: string;
  flag_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  generated_at: string;
  equipment_assets: { asset_code: string; name: string };
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [deptData, setDeptData] = useState<DeptData[]>([]);
  const [conditionData, setConditionData] = useState<ConditionData[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [overduePM, setOverduePM] = useState<OverduePMRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [statsRes, deptRes, condRes, woRes, pmRes, alertRes] = await Promise.all([
          getDashboardStats(),
          getEquipmentByDepartment(),
          getEquipmentByCondition(),
          getOpenWorkOrders(),
          getOverduePM(),
          getRecentAlerts(),
        ]);

        if (statsRes.data) setStats(statsRes.data);
        if (deptRes.data) setDeptData(deptRes.data);
        if (condRes.data) setConditionData(condRes.data);
        if (woRes.data) setWorkOrders(woRes.data as unknown as WorkOrderRow[]);
        if (pmRes.data) setOverduePM(pmRes.data as unknown as OverduePMRow[]);
        if (alertRes.data) setAlerts(alertRes.data as unknown as AlertRow[]);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  if (loading) return <PageLoader />;

  const statCards = [
    { label: 'Total Equipment', value: stats?.total_equipment ?? 0, icon: <Monitor className="h-6 w-6" />, color: 'blue' },
    { label: 'Functional', value: stats?.functional_count ?? 0, icon: <CheckCircle className="h-6 w-6" />, color: 'green' },
    { label: 'Non-Functional', value: stats?.non_functional_count ?? 0, icon: <XCircle className="h-6 w-6" />, color: 'red' },
    { label: 'Open Work Orders', value: stats?.open_work_orders ?? 0, icon: <Wrench className="h-6 w-6" />, color: 'yellow' },
    { label: 'Overdue PM', value: stats?.overdue_pm ?? 0, icon: <CalendarX className="h-6 w-6" />, color: 'orange' },
    { label: 'Calibration Due', value: stats?.calibration_due_soon ?? 0, icon: <Gauge className="h-6 w-6" />, color: 'purple' },
    { label: 'Low Stock Parts', value: stats?.low_stock_parts ?? 0, icon: <Package className="h-6 w-6" />, color: 'orange' },
    { label: 'Active Alerts', value: stats?.active_critical_alerts ?? 0, icon: <AlertTriangle className="h-6 w-6" />, color: 'red' },
  ];

  const conditionLabels = conditionData.map((d) =>
    d.condition.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
  const conditionValues = conditionData.map((d) => d.count);
  const conditionColors = conditionData.map(
    (d) => CONDITION_COLORS[d.condition] ?? '#6B7280'
  );

  const deptLabels = deptData.map((d) => d.department_name);
  const deptValues = deptData.map((d) => d.count);

  const woColumns = [
    { key: 'work_order_number', header: 'WO #', sortable: true },
    { key: 'asset_name', header: 'Asset' },
    {
      key: 'priority',
      header: 'Priority',
      render: (row: WorkOrderRow) => <UrgencyBadge urgency={row.priority} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: WorkOrderRow) => <WorkOrderStatusBadge status={row.status} />,
    },
    { key: 'department_name', header: 'Department' },
    {
      key: 'created_at',
      header: 'Created',
      render: (row: WorkOrderRow) => new Date(row.created_at).toLocaleDateString(),
    },
  ];

  const pmColumns = [
    { key: 'asset_name', header: 'Asset' },
    { key: 'plan_name', header: 'Plan' },
    {
      key: 'scheduled_date',
      header: 'Scheduled',
      render: (row: OverduePMRow) => new Date(row.scheduled_date).toLocaleDateString(),
    },
    {
      key: 'days_overdue',
      header: 'Days Overdue',
      render: (row: OverduePMRow) => (
        <span className="font-semibold text-red-600">{row.days_overdue}</span>
      ),
    },
    { key: 'department_name', header: 'Department' },
  ];

  const severityVariant: Record<string, 'success' | 'warning' | 'error' | 'info'> = {
    low: 'success',
    medium: 'warning',
    high: 'error',
    critical: 'error',
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytical Dashboard"
        description="Summarizes reliability and maintenance performance indicators such as MTTR, MTBF, availability, PM compliance, backlog, and active alerts."
        actions={
          <AskAiButton
            moduleLabel="Dashboard"
            label="Ask AI priorities"
            seedPrompt="What should I prioritize first today based on current dashboard signals?"
          />
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            color={card.color}
          />
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Equipment by Department" description="Distribution across departments">
          {deptData.length > 0 ? (
            <BarChart
              labels={deptLabels}
              datasets={[{ label: 'Equipment Count', data: deptValues }]}
              height={320}
            />
          ) : (
            <p className="py-12 text-center text-sm text-[var(--text-muted)]">No department equipment records available yet.</p>
          )}
        </ChartCard>

        <ChartCard title="Equipment by Condition" description="Current condition breakdown">
          {conditionData.length > 0 ? (
            <DoughnutChart
              labels={conditionLabels}
              data={conditionValues}
              colors={conditionColors}
              height={320}
            />
          ) : (
            <p className="py-12 text-center text-sm text-[var(--text-muted)]">No equipment condition records available yet.</p>
          )}
        </ChartCard>
      </div>

      {/* Open Work Orders */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <Wrench className="h-5 w-5 text-yellow-500" />
              Open Work Orders
            </span>
          </CardTitle>
        </CardHeader>
        <Table<WorkOrderRow>
          columns={woColumns}
          data={workOrders}
          emptyMessage="No open work orders"
        />
      </Card>

      {/* Overdue Preventive Maintenance */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <CalendarX className="h-5 w-5 text-red-500" />
              Overdue Preventive Maintenance
            </span>
          </CardTitle>
        </CardHeader>
        <Table<OverduePMRow>
          columns={pmColumns}
          data={overduePM}
          emptyMessage="No overdue preventive maintenance"
        />
      </Card>

      {/* Recent Alerts */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Recent Alerts &amp; Recommendations
            </span>
          </CardTitle>
        </CardHeader>
        {alerts.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">No active alerts or recommendations at this time.</p>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-4 px-2 py-3"
              >
                <div className="mt-0.5">
                  {alert.severity === 'critical' || alert.severity === 'high' ? (
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                  ) : alert.severity === 'medium' ? (
                    <Clock className="h-5 w-5 text-yellow-500" />
                  ) : (
                    <MoreHorizontal className="h-5 w-5 text-[var(--text-muted)]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={severityVariant[alert.severity] ?? 'default'}>
                      {alert.severity}
                    </Badge>
                    <span className="text-xs text-[var(--text-muted)]">
                      {alert.equipment_assets?.asset_code} — {alert.equipment_assets?.name}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--foreground)]">{alert.message}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {new Date(alert.generated_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
