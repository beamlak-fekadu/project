'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Activity,
  Boxes,
  CalendarCheck,
  ClipboardList,
  Gauge,
  GraduationCap,
  LockKeyhole,
  Monitor,
  Package,
  PackageCheck,
  Replace,
  ShieldAlert,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

interface ReportCard {
  type: string;
  title: string;
  description: string;
  metric: string;
  status?: 'Ready' | 'Partial' | 'Needs data';
  icon: ReactNode;
  color: string;
  emphasis?: boolean;
}

const reports: ReportCard[] = [
  {
    type: 'biomedical-operations',
    title: 'Biomedical Engineering Operations Report',
    description: 'Unified equipment, condition, department, and operational inventory evidence.',
    metric: 'Defense priority',
    status: 'Ready',
    icon: <Activity className="h-7 w-7" />,
    color: 'text-blue-300 bg-blue-500/15',
    emphasis: true,
  },
  {
    type: 'equipment',
    title: 'Inventory Report',
    description: 'Complete equipment inventory with department, category, condition, status, and cost fields.',
    metric: 'CSV/PDF',
    icon: <Monitor className="h-7 w-7" />,
    color: 'text-cyan-300 bg-cyan-500/15',
  },
  {
    type: 'maintenance-performance',
    title: 'Maintenance Performance Report',
    description: 'Maintenance event history, repair duration, service cost, and completion evidence.',
    metric: 'Reliability evidence',
    status: 'Ready',
    icon: <Wrench className="h-7 w-7" />,
    color: 'text-orange-300 bg-orange-500/15',
    emphasis: true,
  },
  {
    type: 'work-orders',
    title: 'Work Order Report',
    description: 'Open, assigned, in-progress, on-hold, completed, vendor, and priority work orders.',
    metric: 'Execution trace',
    icon: <ClipboardList className="h-7 w-7" />,
    color: 'text-violet-300 bg-violet-500/15',
  },
  {
    type: 'pm-compliance',
    title: 'PM Compliance Report',
    description: 'Preventive maintenance schedules, completion status, assignment, and due evidence.',
    metric: 'Compliance',
    status: 'Ready',
    icon: <CalendarCheck className="h-7 w-7" />,
    color: 'text-emerald-300 bg-emerald-500/15',
    emphasis: true,
  },
  {
    type: 'calibration-compliance',
    title: 'Calibration Compliance Report',
    description: 'Calibration records, results, next due dates, failed/adjusted outcomes, and evidence.',
    metric: 'Accuracy control',
    status: 'Ready',
    icon: <Gauge className="h-7 w-7" />,
    color: 'text-purple-300 bg-purple-500/15',
    emphasis: true,
  },
  {
    type: 'risk-fmea',
    title: 'Risk and FMEA Report',
    description: 'RPN, severity, occurrence, detectability, risk bands, explanations, and methods.',
    metric: 'Explainable scores',
    icon: <ShieldAlert className="h-7 w-7" />,
    color: 'text-rose-300 bg-rose-500/15',
  },
  {
    type: 'replacement-planning',
    title: 'Replacement Planning Report',
    description: 'RPI rankings, component scores, replacement drivers, and planning evidence.',
    metric: 'Lifecycle',
    status: 'Ready',
    icon: <Replace className="h-7 w-7" />,
    color: 'text-amber-300 bg-amber-500/15',
    emphasis: true,
  },
  {
    type: 'department-readiness',
    title: 'Department Readiness Report',
    description: 'Department equipment ownership, conditions, readiness proxies, and operational exposure.',
    metric: 'Readiness',
    icon: <Users className="h-7 w-7" />,
    color: 'text-blue-300 bg-blue-500/15',
  },
  {
    type: 'spare-parts-stock',
    title: 'Spare Parts / Stock Report',
    description: 'Spare-part balances, reorder levels, stock value, and low-stock evidence.',
    metric: 'Stock control',
    icon: <Package className="h-7 w-7" />,
    color: 'text-teal-300 bg-teal-500/15',
  },
  {
    type: 'procurement-pipeline',
    title: 'Procurement Pipeline Report',
    description: 'Requested, approved, ordered, in-transit, delivered, delayed, and linked procurement rows.',
    metric: 'Pipeline',
    icon: <PackageCheck className="h-7 w-7" />,
    color: 'text-green-300 bg-green-500/15',
  },
  {
    type: 'training-competency',
    title: 'Training / Competency Report',
    description: 'Training sessions, trainer, equipment/category linkage, attendees, and certification evidence.',
    metric: 'Competency',
    icon: <GraduationCap className="h-7 w-7" />,
    color: 'text-indigo-300 bg-indigo-500/15',
  },
  {
    type: 'disposal-lifecycle',
    title: 'Disposal / Lifecycle Report',
    description: 'Disposal requests, approvals, methods, completed disposals, and lifecycle evidence.',
    metric: 'End of life',
    icon: <Trash2 className="h-7 w-7" />,
    color: 'text-red-300 bg-red-500/15',
  },
  {
    type: 'technician-workload',
    title: 'Technician Workload Report',
    description: 'Work-order assignment and execution evidence used for workload review.',
    metric: 'Assignment',
    icon: <Boxes className="h-7 w-7" />,
    color: 'text-slate-300 bg-slate-500/15',
  },
  {
    type: 'audit-security',
    title: 'Audit / Security Report',
    description: 'Recent audit events for roles, settings, security, equipment, and workflow changes.',
    metric: 'Governance',
    icon: <LockKeyhole className="h-7 w-7" />,
    color: 'text-violet-300 bg-violet-500/15',
  },
];

const defensePackTypes = [
  'biomedical-operations',
  'maintenance-performance',
  'pm-compliance',
  'calibration-compliance',
  'replacement-planning',
  'department-readiness',
];

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Evidence and export center for biomedical operations, decision support, compliance, lifecycle, inventory, training, audit, and thesis demonstration reporting."
      />

      <section className="panel-surface rounded-lg p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">Defense Evidence Pack</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">High-value reports for operations review, thesis defense, and BME Head evidence export.</p>
          </div>
          <Badge variant="purple">Curated evidence</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {reports.filter((report) => defensePackTypes.includes(report.type)).map((report) => (
            <Link key={report.type} href={`/reports/${report.type}`} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 transition hover:border-[var(--brand)]/50">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--foreground)]">{report.title}</p>
                <Badge variant={report.status === 'Partial' ? 'warning' : 'success'}>{report.status ?? 'Ready'}</Badge>
              </div>
              <p className="mt-2 text-xs text-[var(--text-muted)]">{report.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {reports.map((report) => (
          <Link key={report.type} href={`/reports/${report.type}`}>
            <Card className={`group h-full border border-[var(--border-subtle)] bg-[var(--surface-1)] transition-shadow hover:shadow-md ${report.emphasis ? 'ring-1 ring-[var(--brand)]/30' : ''}`}>
              <div className="flex h-full flex-col items-start gap-4">
                <div className={`rounded-lg p-3 ${report.color}`}>
                  {report.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-[var(--foreground)] group-hover:text-[var(--brand)]">
                      {report.title}
                    </h3>
                    <Badge variant={report.emphasis ? 'purple' : 'info'}>{report.metric}</Badge>
                  </div>
                  {report.status && <Badge variant={report.status === 'Partial' ? 'warning' : 'success'}>{report.status}</Badge>}
                  <p className="text-sm text-[var(--text-muted)]">
                    {report.description}
                  </p>
                </div>
                <span className="text-sm font-medium text-[var(--brand)] group-hover:underline">
                  Open report
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
