'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useRole } from '@/hooks/useRole';
import {
  Boxes,
  CalendarCheck,
  ClipboardList,
  Download,
  Gauge,
  GraduationCap,
  Monitor,
  Package,
  PackageCheck,
  Replace,
  ShieldAlert,
  Trash2,
  Wrench,
  ArrowRight,
  BarChart3,
  FileText,
  Info,
  QrCode,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';

interface ReportDef {
  type: string;
  title: string;
  purpose: string;
  evidenceTag: string;
  charts: number;
  tables: number;
  icon: ReactNode;
  iconBg: string;
  priority?: boolean;
  devOnly?: boolean;
  adminOnly?: boolean;
}

interface ReportSection {
  id: string;
  title: string;
  description: string;
  sectionColor: string;
  reports: ReportDef[];
}

const sections: ReportSection[] = [
  {
    id: 'lifecycle',
    title: 'Asset Lifecycle',
    description:
      'Evidence for asset inventory, FMEA risk analysis, replacement planning, and end-of-life management.',
    sectionColor: 'border-amber-500/30 bg-amber-500/5',
    reports: [
      {
        type: 'equipment',
        title: 'Inventory and Asset Condition Report',
        purpose:
          'Complete asset inventory with department, category, condition, cost, warranty status, and age distribution.',
        evidenceTag: 'Inventory',
        charts: 4,
        tables: 1,
        icon: <Monitor className="h-5 w-5" />,
        iconBg: 'text-cyan-400 bg-cyan-500/15',
      },
      {
        type: 'qr-coverage',
        title: 'QR Coverage Evidence Report',
        purpose:
          'QR readiness by asset: missing tokens, generated, printed, attached, needs-replacement, and revoked label states.',
        evidenceTag: 'QR readiness',
        charts: 2,
        tables: 1,
        icon: <QrCode className="h-5 w-5" />,
        iconBg: 'text-teal-400 bg-teal-500/15',
        adminOnly: true,
      },
      {
        type: 'qr-scan-evidence',
        title: 'QR Scan Evidence Report',
        purpose:
          'Authenticated QR scan activity by asset, scanner role, department, online status, and action evidence.',
        evidenceTag: 'Scan activity',
        charts: 3,
        tables: 1,
        icon: <QrCode className="h-5 w-5" />,
        iconBg: 'text-blue-400 bg-blue-500/15',
        adminOnly: true,
      },
      {
        type: 'risk-fmea',
        title: 'Risk and FMEA Report',
        purpose:
          'RPN scores, severity, occurrence, detectability, risk bands, assignment methods, and risk driver explanations.',
        evidenceTag: 'Risk evidence',
        charts: 3,
        tables: 1,
        icon: <ShieldAlert className="h-5 w-5" />,
        iconBg: 'text-rose-400 bg-rose-500/15',
      },
      {
        type: 'replacement-planning',
        title: 'Replacement Planning Report',
        purpose:
          'RPI rankings, component scores, lifecycle drivers, and prototype decision thresholds (≥0.70 strong, 0.55–0.69 review).',
        evidenceTag: 'Lifecycle',
        charts: 3,
        tables: 1,
        icon: <Replace className="h-5 w-5" />,
        iconBg: 'text-amber-400 bg-amber-500/15',
      },
      {
        type: 'disposal-lifecycle',
        title: 'Disposal / Lifecycle Report',
        purpose:
          'Disposal requests, approvals, disposal methods, completed disposals, and end-of-life evidence.',
        evidenceTag: 'End of life',
        charts: 2,
        tables: 1,
        icon: <Trash2 className="h-5 w-5" />,
        iconBg: 'text-red-400 bg-red-500/15',
      },
    ],
  },
  {
    id: 'compliance',
    title: 'Maintenance & Compliance',
    description:
      'Corrective maintenance, work order execution, preventive maintenance compliance, and calibration accuracy evidence.',
    sectionColor: 'border-emerald-500/30 bg-emerald-500/5',
    reports: [
      {
        type: 'maintenance-performance',
        title: 'Maintenance Performance Report',
        purpose:
          'Maintenance events, MTTR, repair costs, recurring failures, and corrective maintenance reliability evidence.',
        evidenceTag: 'Reliability',
        charts: 3,
        tables: 2,
        icon: <Wrench className="h-5 w-5" />,
        iconBg: 'text-orange-400 bg-orange-500/15',
        priority: true,
      },
      {
        type: 'work-orders',
        title: 'Work Order Execution Report',
        purpose:
          'Open, assigned, in-progress, on-hold, and completed work orders with outcome, technician, and evidence trace.',
        evidenceTag: 'Execution trace',
        charts: 3,
        tables: 1,
        icon: <ClipboardList className="h-5 w-5" />,
        iconBg: 'text-violet-400 bg-violet-500/15',
      },
      {
        type: 'pm-compliance',
        title: 'PM Compliance Report',
        purpose:
          'PM schedules, completion status, overdue tasks, skipped/deferred evidence, and department-level compliance.',
        evidenceTag: 'Compliance',
        charts: 3,
        tables: 1,
        icon: <CalendarCheck className="h-5 w-5" />,
        iconBg: 'text-emerald-400 bg-emerald-500/15',
        priority: true,
      },
      {
        type: 'calibration-compliance',
        title: 'Calibration Compliance Report',
        purpose:
          'Calibration records, pass/fail/adjusted results, next due dates, overdue assets, and safety follow-up evidence.',
        evidenceTag: 'Accuracy control',
        charts: 3,
        tables: 1,
        icon: <Gauge className="h-5 w-5" />,
        iconBg: 'text-purple-400 bg-purple-500/15',
        priority: true,
      },
    ],
  },
  {
    id: 'resources',
    title: 'Resource, Procurement & People',
    description:
      'Stock control, procurement pipeline, training competency, technician workload, and governance audit evidence.',
    sectionColor: 'border-violet-500/30 bg-violet-500/5',
    reports: [
      {
        type: 'spare-parts-stock',
        title: 'Spare Parts and Stock Control Report',
        purpose:
          'Part inventory, stockout alerts, low-stock items, procurement recovery status, and work-order blockers.',
        evidenceTag: 'Stock control',
        charts: 2,
        tables: 2,
        icon: <Package className="h-5 w-5" />,
        iconBg: 'text-teal-400 bg-teal-500/15',
      },
      {
        type: 'procurement-pipeline',
        title: 'Procurement Pipeline Report',
        purpose:
          'Procurement requests across all pipeline stages, delays, priority, expected delivery, and delivery evidence.',
        evidenceTag: 'Pipeline',
        charts: 2,
        tables: 1,
        icon: <PackageCheck className="h-5 w-5" />,
        iconBg: 'text-green-400 bg-green-500/15',
      },
      {
        type: 'training-competency',
        title: 'Training and Equipment Safety Report',
        purpose:
          'Training sessions, pending requests, attendees, equipment category linkage, and competency evidence.',
        evidenceTag: 'Competency',
        charts: 2,
        tables: 1,
        icon: <GraduationCap className="h-5 w-5" />,
        iconBg: 'text-indigo-400 bg-indigo-500/15',
      },
      {
        type: 'technician-workload',
        title: 'Technician Workload Report',
        purpose:
          'Assignment load by technician, completion evidence, critical task distribution, and workload balance.',
        evidenceTag: 'Assignment',
        charts: 3,
        tables: 1,
        icon: <Boxes className="h-5 w-5" />,
        iconBg: 'text-slate-400 bg-slate-500/15',
      },
      {
        type: 'offline-sync-evidence',
        title: 'Offline Sync Evidence Report',
        purpose:
          'Server-side offline activity, conflicts, retries, resolutions, and role/user breakdown from offline_sync_events.',
        evidenceTag: 'Offline activity',
        charts: 0,
        tables: 3,
        icon: <FileText className="h-5 w-5" />,
        iconBg: 'text-amber-400 bg-amber-500/15',
        adminOnly: true,
      },
    ],
  },
];

function ReportCard({ report }: { report: ReportDef }) {
  return (
    <Link
      href={`/reports/${report.type}`}
      className="group flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 transition-all hover:border-[var(--brand)]/50 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className={`shrink-0 rounded-lg p-2.5 ${report.iconBg}`}>{report.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-1.5">
            <h3 className="text-sm font-semibold text-[var(--foreground)] group-hover:text-[var(--brand)] leading-tight">
              {report.title}
            </h3>
            {report.priority && (
              <Badge variant="purple" className="shrink-0">Priority</Badge>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{report.purpose}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-0.5">
          <BarChart3 className="h-3 w-3" />
          {report.charts} chart{report.charts !== 1 ? 's' : ''}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-0.5">
          <FileText className="h-3 w-3" />
          {report.tables} evidence table{report.tables !== 1 ? 's' : ''}
        </span>
        <Badge variant="info">{report.evidenceTag}</Badge>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
        <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <Download className="h-3 w-3" /> Export PDF
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] group-hover:underline">
          Open Snapshot Report <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

// Viewer-allowed report types. Audit/dev/demo reports are hidden from viewer.
const VIEWER_ALLOWED_REPORTS = new Set([
  'equipment',
  'risk-fmea',
  'replacement-planning',
  'maintenance-performance',
  'work-orders',
  'pm-compliance',
  'calibration-compliance',
  'spare-parts-stock',
  'procurement-pipeline',
  'training-competency',
  'department-readiness',
]);

// Store-allowed reports. Audit/dev/demo/methodology and BME-only deep reports
// are hidden. Work-orders is included to expose blocker evidence; risk/FMEA
// is hidden because store does not own risk decisions.
const STORE_ALLOWED_REPORTS = new Set([
  'spare-parts-stock',
  'procurement-pipeline',
  'maintenance-performance',
  'work-orders',
]);

// Department-allowed reports — surfaced as department-scoped snapshots.
// Hospital-wide deep reports, audit, methodology, and demo reports are not
// shown for department roles.
const DEPARTMENT_ALLOWED_REPORTS = new Set([
  'equipment',
  'maintenance-performance',
  'work-orders',
  'pm-compliance',
  'calibration-compliance',
  'department-readiness',
  'training-competency',
]);

export default function ReportsPage() {
  const { roles, isViewer, isDeveloper, isAdmin, isBmeHead, isTechnician, isStoreUser } = useRole();
  const canViewQrAdminReports = roles.some((role) => role === 'developer' || role === 'admin' || role === 'bme_head');
  const isViewerOnly = isViewer && !isDeveloper && !isAdmin && !isBmeHead && !isTechnician;
  const isStoreOnly = isStoreUser && !isDeveloper && !isAdmin && !isBmeHead && !isTechnician;
  const isDepartmentOnly =
    (roles.includes('department_head') || roles.includes('department_user')) &&
    !roles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');

  if (isDepartmentOnly) {
    const deptSections = sections
      .map((s) => ({ ...s, reports: s.reports.filter((r) => DEPARTMENT_ALLOWED_REPORTS.has(r.type)) }))
      .filter((s) => s.reports.length > 0);
    return (
      <div className="space-y-8">
        <PageHeader
          title="Department Reports"
          description="Department-scoped reports. Open a report to download a PDF snapshot."
        />
        <div className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-muted)]">
            Reports are filtered to your department. Hospital-wide, audit, decision-support methodology, and demo reports are not shown in this view.
          </p>
        </div>
        {deptSections.map((section) => (
          <section key={section.id}>
            <div className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 ${section.sectionColor}`}>
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">{section.title}</h2>
                <p className="mt-0.5 text-sm text-[var(--text-muted)]">{section.description}</p>
              </div>
              <span className="shrink-0 text-xs text-[var(--text-muted)]">{section.reports.length} reports</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {section.reports.map((report) => (<ReportCard key={report.type} report={report} />))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  if (isStoreOnly) {
    const storeSections = sections
      .map((s) => ({ ...s, reports: s.reports.filter((r) => STORE_ALLOWED_REPORTS.has(r.type)) }))
      .filter((s) => s.reports.length > 0);
    return (
      <div className="space-y-8">
        <PageHeader
          title="Reports"
          description="Stock, procurement, and store-relevant reports. Open a report to download a PDF snapshot of the current data."
        />
        <div className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-muted)]">
            Store reports are filtered to stock, procurement, and work-order blocker evidence. Decision-support, audit, and methodology reports are not shown in this view.
          </p>
        </div>
        {storeSections.map((section) => (
          <section key={section.id}>
            <div className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 ${section.sectionColor}`}>
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">{section.title}</h2>
                <p className="mt-0.5 text-sm text-[var(--text-muted)]">{section.description}</p>
              </div>
              <span className="shrink-0 text-xs text-[var(--text-muted)]">{section.reports.length} reports</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {section.reports.map((report) => (<ReportCard key={report.type} report={report} />))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  if (isViewerOnly) {
    // Filter sections to viewer-allowed reports only.
    const viewerSections = sections
      .map((s) => ({ ...s, reports: s.reports.filter((r) => VIEWER_ALLOWED_REPORTS.has(r.type)) }))
      .filter((s) => s.reports.length > 0);

    return (
      <div className="space-y-8">
        <PageHeader
          title="Reports"
          description="Read-only management report center. Open a report to download a PDF snapshot of the current operational data."
        />
        <div className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-muted)]">
            Reports are generated from the current operational database state. Each report includes a snapshot timestamp,
            methodology note, charts, evidence tables, and PDF export. Developer/audit/demo reports are not shown in
            the read-only management view.
          </p>
        </div>
        {viewerSections.map((section) => (
          <section key={section.id}>
            <div className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 ${section.sectionColor}`}>
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">{section.title}</h2>
                <p className="mt-0.5 text-sm text-[var(--text-muted)]">{section.description}</p>
              </div>
              <span className="shrink-0 text-xs text-[var(--text-muted)]">{section.reports.length} reports</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {section.reports.map((report) => (
                <ReportCard key={report.type} report={report} />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  const operationalSections = sections
    .map((section) => ({
      ...section,
      reports: section.reports.filter((report) => !report.adminOnly || canViewQrAdminReports),
    }))
    .filter((section) => section.reports.length > 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Reports"
        description="Evidence and export center for biomedical engineering operations, decision support, compliance, lifecycle, inventory, training, audit, and thesis demonstration reporting."
      />

      <div className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-muted)]">
          Reports are generated from the current operational database state. Each report includes a snapshot timestamp,
          methodology note, charts, evidence tables, and PDF export. Charts and summaries reflect available records
          at the time of generation.
        </p>
      </div>

      {operationalSections.map((section) => (
        <section key={section.id}>
          <div className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 ${section.sectionColor}`}>
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">{section.title}</h2>
              <p className="mt-0.5 text-sm text-[var(--text-muted)]">{section.description}</p>
            </div>
            <span className="shrink-0 text-xs text-[var(--text-muted)]">
              {section.reports.length} reports
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {section.reports.map((report) => (
              <ReportCard key={report.type} report={report} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
