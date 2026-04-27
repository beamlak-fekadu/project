'use client';

import { useEffect, useState } from 'react';
import {
  ClipboardCheck,
  CalendarCheck,
  Percent,
} from 'lucide-react';
import { getPMComplianceMetrics } from '@/services/analytics.service';
import { PageHeader, StatCard, DataTable } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { ChartCard, BarChart, LineChart, GaugeChart } from '@/components/charts';

interface PMCRow {
  id: string;
  department_id: string | null;
  asset_id: string | null;
  period_start: string;
  period_end: string;
  scheduled_count: number;
  completed_count: number;
  pmc_percentage: number;
  computed_at: string;
  departments?: { name?: string | null; code?: string | null } | Array<{ name?: string | null; code?: string | null }> | null;
  [key: string]: unknown;
}

function pmcColor(pct: number): string {
  if (pct >= 80) return 'text-green-600 dark:text-green-400';
  if (pct >= 60) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function pmcBg(pct: number): string {
  if (pct >= 80) return 'bg-green-50 dark:bg-green-900/20';
  if (pct >= 60) return 'bg-yellow-50 dark:bg-yellow-900/20';
  return 'bg-red-50 dark:bg-red-900/20';
}

function pmcBarColor(pct: number): string {
  if (pct >= 80) return '#22c55e';
  if (pct >= 60) return '#eab308';
  return '#ef4444';
}

function formatPeriod(start: string): string {
  const s = new Date(start);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[s.getMonth()]} ${s.getFullYear()}`;
}

function formatPct(value: number): string {
  return `${Number(value).toFixed(1)}%`;
}

function getDepartmentLabel(row: PMCRow): string {
  const department = Array.isArray(row.departments) ? row.departments[0] : row.departments;
  return department?.name ?? department?.code ?? 'Unknown department';
}

export default function PMCPage() {
  const [data, setData] = useState<PMCRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data: rows } = await getPMComplianceMetrics();
        if (rows) setData(rows as unknown as PMCRow[]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <PageLoader />;

  const totalScheduled = data.reduce((s, d) => s + d.scheduled_count, 0);
  const totalCompleted = data.reduce((s, d) => s + d.completed_count, 0);
  const overallPMC = totalScheduled > 0 ? (totalCompleted / totalScheduled) * 100 : 0;

  // Aggregate by department display label.
  const deptMap = new Map<string, { scheduled: number; completed: number }>();
  data.forEach((d) => {
    const key = getDepartmentLabel(d);
    const prev = deptMap.get(key) ?? { scheduled: 0, completed: 0 };
    deptMap.set(key, {
      scheduled: prev.scheduled + d.scheduled_count,
      completed: prev.completed + d.completed_count,
    });
  });
  const deptEntries = Array.from(deptMap.entries()).map(([dept, val]) => ({
    department: dept,
    pmc: val.scheduled > 0 ? (val.completed / val.scheduled) * 100 : 0,
    scheduled: val.scheduled,
    completed: val.completed,
  }));

  // Monthly trend — aggregate by machine-sortable period key.
  const monthMap = new Map<string, { label: string; scheduled: number; completed: number }>();
  data.forEach((d) => {
    const periodDate = new Date(d.period_start);
    const key = Number.isNaN(periodDate.getTime()) ? d.period_start : periodDate.toISOString().slice(0, 7);
    const prev = monthMap.get(key) ?? { label: formatPeriod(d.period_start), scheduled: 0, completed: 0 };
    monthMap.set(key, {
      label: prev.label,
      scheduled: prev.scheduled + d.scheduled_count,
      completed: prev.completed + d.completed_count,
    });
  });
  const monthEntries = Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, val]) => ({
      month: val.label,
      pmc: val.scheduled > 0 ? (val.completed / val.scheduled) * 100 : 0,
    }));

  const columns = [
    {
      key: 'department_id',
      header: 'Department',
      sortable: true,
      render: (row: PMCRow) => getDepartmentLabel(row),
    },
    {
      key: 'period',
      header: 'Period',
      sortable: true,
      render: (row: PMCRow) => formatPeriod(row.period_start),
    },
    {
      key: 'scheduled_count',
      header: 'Scheduled',
      sortable: true,
    },
    {
      key: 'completed_count',
      header: 'Completed',
      sortable: true,
    },
    {
      key: 'pmc_percentage',
      header: 'PMC %',
      sortable: true,
      render: (row: PMCRow) => (
        <span className={`inline-block rounded px-2 py-0.5 text-sm font-semibold ${pmcColor(row.pmc_percentage)} ${pmcBg(row.pmc_percentage)}`}>
          {formatPct(row.pmc_percentage)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="PM Compliance"
        description="Preventive Maintenance Compliance: PMC = (Completed / Scheduled) × 100 (Equation 5)"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Analytics' },
          { label: 'PM Compliance' },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <GaugeChart
            value={overallPMC}
            label="Overall PMC"
            color={overallPMC >= 80 ? '#22c55e' : overallPMC >= 60 ? '#eab308' : '#ef4444'}
            size={160}
          />
        </div>
        <StatCard
          label="Total Scheduled"
          value={totalScheduled}
          icon={<CalendarCheck className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label="Total Completed"
          value={totalCompleted}
          icon={<ClipboardCheck className="h-6 w-6" />}
          color="green"
        />
        <StatCard
          label="Overall PMC"
          value={formatPct(overallPMC)}
          icon={<Percent className="h-6 w-6" />}
          color={overallPMC >= 80 ? 'green' : overallPMC >= 60 ? 'yellow' : 'red'}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="PMC by Department" description="Compliance rate across departments">
          {deptEntries.length > 0 ? (
            <BarChart
              labels={deptEntries.map((d) => d.department)}
              datasets={[
                {
                  label: 'PMC %',
                  data: deptEntries.map((d) => Number(d.pmc.toFixed(1))),
                  backgroundColor: deptEntries.map((d) => pmcBarColor(d.pmc)),
                },
              ]}
              height={320}
            />
          ) : (
            <p className="py-12 text-center text-sm text-gray-500">No department data</p>
          )}
        </ChartCard>

        <ChartCard title="Monthly PMC Trend" description="Compliance over time">
          {monthEntries.length > 0 ? (
            <LineChart
              labels={monthEntries.map((d) => d.month)}
              datasets={[
                {
                  label: 'PMC %',
                  data: monthEntries.map((d) => Number(d.pmc.toFixed(1))),
                  borderColor: '#3b82f6',
                  tension: 0.3,
                },
              ]}
              height={320}
            />
          ) : (
            <p className="py-12 text-center text-sm text-gray-500">No trend data</p>
          )}
        </ChartCard>
      </div>

      <DataTable<PMCRow>
        columns={columns}
        data={data}
        keyField="id"
        searchPlaceholder="Search departments..."
        emptyMessage="No PM compliance data found"
        pageSize={15}
      />
    </div>
  );
}
