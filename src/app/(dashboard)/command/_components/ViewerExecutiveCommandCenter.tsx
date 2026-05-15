import Link from 'next/link';
import {
  Activity,
  AlertCircle,
  ArrowUpDown,
  BarChart3,
  Building2,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  Package,
  ShieldAlert,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import {
  type ViewerExecutiveMetrics,
  type ViewerDeptReadiness,
  type ViewerCriticalRisk,
} from '@/utils/viewer/executive-metrics';
import {
  classifyDeptRisk,
  deptRiskBadgeClass,
  deptRiskLabel,
} from '@/utils/viewer/readiness';
import {
  viewerEquipmentDetail,
  viewerReport,
} from '@/utils/viewer/evidence-links';

interface Props {
  metrics: ViewerExecutiveMetrics;
  departments: ViewerDeptReadiness[];
  criticalRisks: ViewerCriticalRisk[];
  generatedAt: string;
}

interface ExecCard {
  label: string;
  value: number | string;
  subtitle: string;
  icon: React.ReactNode;
  tone: 'critical' | 'warning' | 'info' | 'success' | 'neutral';
  evidenceLabel: string;
  evidenceHref: string;
}

function toneClass(tone: ExecCard['tone']): string {
  switch (tone) {
    case 'critical':
      return 'border-rose-500/40 bg-rose-500/5';
    case 'warning':
      return 'border-amber-500/40 bg-amber-500/5';
    case 'info':
      return 'border-cyan-500/40 bg-cyan-500/5';
    case 'success':
      return 'border-emerald-500/40 bg-emerald-500/5';
    default:
      return 'border-[var(--border-subtle)] bg-[var(--surface-1)]';
  }
}

function iconBg(tone: ExecCard['tone']): string {
  switch (tone) {
    case 'critical':
      return 'bg-rose-500/15 text-rose-300';
    case 'warning':
      return 'bg-amber-500/15 text-amber-300';
    case 'info':
      return 'bg-cyan-500/15 text-cyan-300';
    case 'success':
      return 'bg-emerald-500/15 text-emerald-300';
    default:
      return 'bg-zinc-500/15 text-zinc-300';
  }
}

function fmtPercent(n: number | null): string {
  return typeof n === 'number' ? `${n}%` : 'Not available';
}

export default function ViewerExecutiveCommandCenter({ metrics, departments, criticalRisks, generatedAt }: Props) {
  // Departments at risk (computed via canonical readiness rules, not invented).
  const deptsClassified = departments.map((d) => ({
    ...d,
    riskLevel: classifyDeptRisk({
      readinessScore: d.readinessScore,
      essentialUnavailable: d.essentialUnavailable,
      criticalOpenWork: d.criticalOpenWork,
      overduePm: d.overduePm,
      overdueCalibration: d.overdueCalibration,
    }),
  }));
  const departmentsAtRisk = deptsClassified.filter((d) => d.riskLevel === 'high' || d.riskLevel === 'medium').length;
  const highestRiskDept = deptsClassified
    .filter((d) => d.riskLevel === 'high')
    .sort((a, b) => (b.essentialUnavailable + b.criticalOpenWork) - (a.essentialUnavailable + a.criticalOpenWork))[0] ?? null;

  const cards: ExecCard[] = [
    {
      label: 'Clinical Readiness',
      value: fmtPercent(metrics.clinicalReadinessPercent),
      subtitle: 'Functional essential equipment / total essential × 100 (weighted by department).',
      icon: <Activity className="h-5 w-5" />,
      tone: metrics.clinicalReadinessPercent === null
        ? 'neutral'
        : metrics.clinicalReadinessPercent >= 80
          ? 'success'
          : metrics.clinicalReadinessPercent >= 60
            ? 'warning'
            : 'critical',
      evidenceLabel: 'View Department Breakdown',
      evidenceHref: viewerReport('department-readiness'),
    },
    {
      label: 'Critical Equipment Down',
      value: metrics.criticalEquipmentDown,
      subtitle: 'Essential (high/critical) equipment currently non-functional or under maintenance.',
      icon: <ShieldAlert className="h-5 w-5" />,
      tone: metrics.criticalEquipmentDown > 0 ? 'critical' : 'success',
      evidenceLabel: 'View Evidence',
      evidenceHref: '/equipment',
    },
    {
      label: 'Open Critical Work',
      value: metrics.criticalOpenWork,
      subtitle: 'Open work orders with priority critical or high.',
      icon: <Wrench className="h-5 w-5" />,
      tone: metrics.criticalOpenWork > 0 ? 'warning' : 'success',
      evidenceLabel: 'Open Report',
      evidenceHref: viewerReport('work-orders'),
    },
    {
      label: 'PM Compliance',
      value: fmtPercent(metrics.pmCompliancePercent),
      subtitle: 'Completed PM schedules / scheduled PM (rolling 90 days). Skipped/deferred not counted as completed.',
      icon: <CalendarDays className="h-5 w-5" />,
      tone: metrics.pmCompliancePercent === null
        ? 'neutral'
        : metrics.pmCompliancePercent >= 80
          ? 'success'
          : metrics.pmCompliancePercent >= 60
            ? 'warning'
            : 'critical',
      evidenceLabel: 'Open Report',
      evidenceHref: viewerReport('pm-compliance'),
    },
    {
      label: 'Calibration Compliance',
      value: metrics.calibrationOverdue === 0 ? 'On track' : `${metrics.calibrationOverdue} overdue`,
      subtitle: `${metrics.calibrationOverdue} overdue · ${metrics.calibrationDueSoon} due in next 30 days.`,
      icon: <Gauge className="h-5 w-5" />,
      tone: metrics.calibrationOverdue > 0 ? 'warning' : 'success',
      evidenceLabel: 'Open Report',
      evidenceHref: viewerReport('calibration-compliance'),
    },
    {
      label: 'Stock Blockers',
      value: metrics.stockBlockers,
      subtitle: 'Unacknowledged low-stock and part-shortage signals delaying repair.',
      icon: <Package className="h-5 w-5" />,
      tone: metrics.stockBlockers > 0 ? 'warning' : 'success',
      evidenceLabel: 'Open Report',
      evidenceHref: viewerReport('spare-parts-stock'),
    },
    {
      label: 'Replacement Review',
      value: metrics.replacementReviewCandidates,
      subtitle: `Assets above review threshold (RPI ≥ 0.55). Strong candidates: ${metrics.strongReplacementCandidates}.`,
      icon: <ArrowUpDown className="h-5 w-5" />,
      tone: metrics.strongReplacementCandidates > 0 ? 'warning' : metrics.replacementReviewCandidates > 0 ? 'info' : 'success',
      evidenceLabel: 'Open Report',
      evidenceHref: viewerReport('replacement-planning'),
    },
    {
      label: 'Monthly Completion',
      value: metrics.monthlyCompletion,
      subtitle: 'Work orders completed within the current calendar month.',
      icon: <TrendingUp className="h-5 w-5" />,
      tone: 'info',
      evidenceLabel: 'Open Report',
      evidenceHref: viewerReport('maintenance-performance'),
    },
    {
      label: 'Departments at Risk',
      value: departmentsAtRisk,
      subtitle: 'Departments classified High or Medium risk based on documented readiness rules.',
      icon: <Building2 className="h-5 w-5" />,
      tone: departmentsAtRisk > 0 ? 'warning' : 'success',
      evidenceLabel: 'View Department Breakdown',
      evidenceHref: viewerReport('department-readiness'),
    },
    {
      label: 'Procurement Delays',
      value: metrics.procurementDelays,
      subtitle: 'Procurement requests not yet delivered (approved, ordered, in transit, or delayed).',
      icon: <ClipboardCheck className="h-5 w-5" />,
      tone: metrics.procurementDelays > 0 ? 'warning' : 'success',
      evidenceLabel: 'Open Report',
      evidenceHref: viewerReport('procurement-pipeline'),
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <PageHeader
            title="Executive Oversight"
            description="Hospital-level read-only command view for management — computed from current operational records."
          />
          <p className="text-xs text-[var(--text-muted)]">Updated {generatedAt} · Read-only view</p>
        </div>
        <Badge variant="default">Read-only view</Badge>
      </div>

      {/* ── Top exec cards ─────────────────────────────────────────────── */}
      <section aria-label="Executive snapshot cards">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {cards.map((c) => (
            <div key={c.label} className={`flex flex-col gap-2 rounded-xl border p-4 ${toneClass(c.tone)}`}>
              <div className="flex items-start justify-between gap-2">
                <div className={`rounded-md p-2 ${iconBg(c.tone)}`}>{c.icon}</div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{c.label}</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{c.value}</p>
                <p className="mt-1 text-xs leading-snug text-[var(--text-muted)]">{c.subtitle}</p>
              </div>
              <Link
                href={c.evidenceHref}
                className="mt-auto inline-flex w-fit items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]"
              >
                {c.evidenceLabel} →
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ── Executive Snapshot Metrics (computed only) ────────────────── */}
      <section aria-label="Executive snapshot metrics">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-violet-300" />
                Executive snapshot metrics
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-[var(--text-muted)]">
              Values below are computed directly from the current operational database. No generated interpretation is shown.
            </p>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Metric label="Clinical readiness" value={fmtPercent(metrics.clinicalReadinessPercent)} />
              <Metric label="Critical equipment unavailable" value={String(metrics.criticalEquipmentDown)} />
              <Metric label="Open critical/high work" value={String(metrics.criticalOpenWork)} />
              <Metric label="PM compliance (90d)" value={fmtPercent(metrics.pmCompliancePercent)} />
              <Metric label="Calibration overdue" value={String(metrics.calibrationOverdue)} />
              <Metric label="Critical calibration overdue" value={String(metrics.criticalCalibrationOverdue)} />
              <Metric label="Stock blockers" value={String(metrics.stockBlockers)} />
              <Metric label="Replacement review candidates" value={String(metrics.replacementReviewCandidates)} />
              <Metric label="Strong replacement candidates" value={String(metrics.strongReplacementCandidates)} />
              <Metric label="High-risk assets" value={String(metrics.highRiskAssets)} />
              <Metric label="Procurement pipeline pressure" value={String(metrics.procurementDelays)} />
              <Metric label="Recurring failure flags" value={String(metrics.recurringFailureFlags)} />
            </dl>
            {highestRiskDept && (
              <p className="mt-4 text-xs text-[var(--text-muted)]">
                Highest-risk department:{' '}
                <span className="font-medium text-[var(--foreground)]">{highestRiskDept.departmentName}</span>{' '}
                — {highestRiskDept.essentialUnavailable} essential unavailable · {highestRiskDept.criticalOpenWork} critical open work · {highestRiskDept.overduePm} overdue PM · {highestRiskDept.overdueCalibration} overdue calibration (computed).
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Service Readiness ──────────────────────────────────────────── */}
      <section aria-label="Service readiness by department">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <Building2 className="h-5 w-5 text-cyan-300" />
                Service readiness
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {deptsClassified.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">No readiness data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Department</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Readiness %</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Essential unavailable</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Critical open work</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Overdue PM</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Overdue calibration</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Risk level</th>
                      <th className="pb-2 font-medium text-[var(--text-muted)]">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {deptsClassified.map((d) => (
                      <tr key={d.departmentId}>
                        <td className="py-3 pr-4 font-medium text-[var(--foreground)]">{d.departmentName}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{d.readinessScore !== null ? `${d.readinessScore}%` : 'Not available'}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{d.essentialUnavailable}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{d.criticalOpenWork}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{d.overduePm}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{d.overdueCalibration}</td>
                        <td className="py-3 pr-4">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${deptRiskBadgeClass(d.riskLevel)}`}>
                            {deptRiskLabel(d.riskLevel)}
                          </span>
                        </td>
                        <td className="py-3">
                          <Link
                            href={`/reports/department-readiness?department=${encodeURIComponent(d.departmentId)}`}
                            className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]"
                          >
                            View Department Evidence →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                  Risk-level rules: <b>High</b> when essential equipment is unavailable or critical/high work orders are open.{' '}
                  <b>Medium</b> when readiness &lt; 80% or combined overdue PM + calibration ≥ 3.{' '}
                  <b>Low</b> otherwise. These thresholds are documented in <code>utils/viewer/readiness.ts</code>.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Critical Risks requiring management awareness ─────────────── */}
      <section aria-label="Critical risks requiring management awareness">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-rose-300" />
                Critical risks requiring management awareness
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {criticalRisks.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">No management-level critical risks require attention right now.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[820px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Asset</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Department</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Issue</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Impact</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Status</th>
                      <th className="pb-2 font-medium text-[var(--text-muted)]">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {criticalRisks.map((r) => (
                      <tr key={r.id}>
                        <td className="py-3 pr-4">
                          <p className="font-medium text-[var(--foreground)]">{r.assetName}</p>
                          {r.assetCode && <p className="text-xs text-[var(--text-muted)]">{r.assetCode}</p>}
                        </td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{r.departmentName}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{r.issue}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{r.impact}</td>
                        <td className="py-3 pr-4"><Badge variant="warning">{r.workflowStatus}</Badge></td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <Link
                              href={r.evidenceHref}
                              className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]"
                            >
                              Open Evidence
                            </Link>
                            {r.assetId && (
                              <Link
                                href={viewerEquipmentDetail(r.assetId)}
                                className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]"
                              >
                                Asset Profile
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Budget / Replacement / Procurement pressure ──────────────── */}
      <section aria-label="Budget and replacement pressure">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PressureCard
            icon={<ArrowUpDown className="h-5 w-5 text-amber-300" />}
            label="Replacement candidates"
            value={metrics.replacementReviewCandidates}
            sub={`Strong: ${metrics.strongReplacementCandidates} · Review: ${metrics.replacementReviewCandidates - metrics.strongReplacementCandidates}`}
            evidence={{ label: 'Open Replacement Evidence', href: '/replacement' }}
          />
          <PressureCard
            icon={<Wrench className="h-5 w-5 text-orange-300" />}
            label="High-risk assets"
            value={metrics.highRiskAssets}
            sub="Assets with risk_level High or Critical (FMEA)."
            evidence={{ label: 'Open Report', href: viewerReport('risk-fmea') }}
          />
          <PressureCard
            icon={<Package className="h-5 w-5 text-emerald-300" />}
            label="Stock blockers"
            value={metrics.stockBlockers}
            sub="Low stock and part-shortage signals affecting repair."
            evidence={{ label: 'Open Stock Blocker Evidence', href: viewerReport('spare-parts-stock') }}
          />
          <PressureCard
            icon={<ClipboardCheck className="h-5 w-5 text-violet-300" />}
            label="Procurement pipeline"
            value={metrics.procurementDelays}
            sub="Requests approved/ordered/in transit/delayed."
            evidence={{ label: 'Open Procurement Summary', href: viewerReport('procurement-pipeline') }}
          />
        </div>
      </section>

      {/* ── Quick links to detailed Viewer pages ─────────────────────── */}
      <section aria-label="Open detailed views">
        <div className="flex flex-wrap gap-2">
          <Link href="/equipment" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">
            <CheckCircle2 className="h-4 w-4" /> Equipment Overview
          </Link>
          <Link href="/maintenance" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">
            <Wrench className="h-4 w-4" /> Maintenance Overview
          </Link>
          <Link href="/compliance" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">
            <CalendarDays className="h-4 w-4" /> Compliance Overview
          </Link>
          <Link href="/replacement" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">
            <ArrowUpDown className="h-4 w-4" /> Replacement &amp; Risk
          </Link>
          <Link href="/alerts" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">
            <ShieldAlert className="h-4 w-4" /> Management Alerts
          </Link>
          <Link href="/calendar" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">
            <Calendar className="h-4 w-4" /> Hospital Calendar
          </Link>
          <Link href="/reports" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">
            <BarChart3 className="h-4 w-4" /> Reports
          </Link>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-[var(--border-subtle)]/60 px-3 py-2">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-medium text-[var(--foreground)]">{value}</span>
    </div>
  );
}

function PressureCard({
  icon,
  label,
  value,
  sub,
  evidence,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
  evidence: { label: string; href: string };
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-md bg-[var(--surface-2)] p-2">{icon}</span>
        <span className="text-2xl font-semibold text-[var(--foreground)]">{value}</span>
      </div>
      <p className="text-sm font-medium text-[var(--foreground)]">{label}</p>
      <p className="mt-1 text-xs leading-snug text-[var(--text-muted)]">{sub}</p>
      <Link href={evidence.href} className="mt-3 inline-block text-xs text-violet-300 hover:text-violet-200">
        {evidence.label} →
      </Link>
    </div>
  );
}
