'use client';

import Link from 'next/link';
import {
  Monitor,
  Wrench,
  CalendarCheck,
  Gauge,
  GraduationCap,
  Package,
  Trash2,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';

interface ReportCard {
  type: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

const reports: ReportCard[] = [
  {
    type: 'equipment',
    title: 'Equipment Inventory',
    description: 'Complete inventory of all equipment assets with status, department, and specifications.',
    icon: <Monitor className="h-8 w-8" />,
    color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400',
  },
  {
    type: 'maintenance',
    title: 'Maintenance History',
    description: 'Historical maintenance events including corrective, preventive, and emergency work.',
    icon: <Wrench className="h-8 w-8" />,
    color: 'text-orange-600 bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400',
  },
  {
    type: 'pm',
    title: 'PM Completion',
    description: 'Preventive maintenance schedule compliance and completion rates by asset and department.',
    icon: <CalendarCheck className="h-8 w-8" />,
    color: 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400',
  },
  {
    type: 'calibration',
    title: 'Calibration',
    description: 'Calibration records, results, and upcoming due dates across all equipment.',
    icon: <Gauge className="h-8 w-8" />,
    color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400',
  },
  {
    type: 'training',
    title: 'Training',
    description: 'Training sessions, attendance records, and staff certification status.',
    icon: <GraduationCap className="h-8 w-8" />,
    color: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400',
  },
  {
    type: 'spare-parts',
    title: 'Spare Parts Usage',
    description: 'Spare parts inventory levels, consumption patterns, and cost analysis.',
    icon: <Package className="h-8 w-8" />,
    color: 'text-teal-600 bg-teal-100 dark:bg-teal-900/30 dark:text-teal-400',
  },
  {
    type: 'disposal',
    title: 'Disposal',
    description: 'Equipment disposal requests, methods, and completed disposals with values.',
    icon: <Trash2 className="h-8 w-8" />,
    color: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
  },
];

export default function ReportsPage() {
  return (
    <div>
      <PageHeader
        title="Reports"
        description="Generate and export detailed reports for equipment management operations"
      />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((report) => (
          <Link key={report.type} href={`/reports/${report.type}`}>
            <Card className="group h-full border border-[var(--border-subtle)] bg-[var(--surface-1)] transition-shadow hover:shadow-md">
              <div className="flex flex-col items-start gap-4">
                <div className={`rounded-xl p-3 ${report.color}`}>
                  {report.icon}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-[var(--foreground)] group-hover:text-[var(--brand)]">
                    {report.title}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    {report.description}
                  </p>
                </div>
                <span className="mt-auto text-sm font-medium text-[var(--brand)] group-hover:underline">
                  Generate Report →
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
