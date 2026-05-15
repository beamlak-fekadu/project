import Link from 'next/link';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  Monitor,
  ShieldAlert,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import {
  type DepartmentMetrics,
  type DepartmentAttentionRow,
  type DepartmentRequestRow,
  type DepartmentWorkOrderRow,
  type DepartmentPmRow,
  type DepartmentCalRow,
} from '@/utils/department/department-metrics';
import { MISSING_DEPARTMENT_MESSAGE, type DepartmentRoleType } from '@/utils/department/department-scope';
import {
  deptCreateMaintenanceRequest,
  deptEquipmentDetail,
  deptMaintenanceRequestDetail,
  deptReport,
  deptWorkOrderEvidence,
} from '@/utils/department/department-evidence-links';

interface Props {
  departmentId: string | null;
  departmentName: string | null;
  profileId: string | null;
  roleType: DepartmentRoleType;
  metrics: DepartmentMetrics;
  attention: DepartmentAttentionRow[];
  requests: DepartmentRequestRow[];
  workOrders: DepartmentWorkOrderRow[];
  overduePm: DepartmentPmRow[];
  overdueCalibration: DepartmentCalRow[];
  generatedAt: string;
}

interface MetricCard {
  label: string;
  value: number | string;
  subtitle: string;
  icon: React.ReactNode;
  tone: 'critical' | 'warning' | 'info' | 'success' | 'neutral';
  href?: string;
  hrefLabel?: string;
}

function toneClass(tone: MetricCard['tone']): string {
  switch (tone) {
    case 'critical': return 'border-rose-500/40 bg-rose-500/5';
    case 'warning': return 'border-amber-500/40 bg-amber-500/5';
    case 'info': return 'border-cyan-500/40 bg-cyan-500/5';
    case 'success': return 'border-emerald-500/40 bg-emerald-500/5';
    default: return 'border-[var(--border-subtle)] bg-[var(--surface-1)]';
  }
}

function iconBg(tone: MetricCard['tone']): string {
  switch (tone) {
    case 'critical': return 'bg-rose-500/15 text-rose-300';
    case 'warning': return 'bg-amber-500/15 text-amber-300';
    case 'info': return 'bg-cyan-500/15 text-cyan-300';
    case 'success': return 'bg-emerald-500/15 text-emerald-300';
    default: return 'bg-zinc-500/15 text-zinc-300';
  }
}

function fmtPercent(n: number | null): string {
  return typeof n === 'number' ? `${n}%` : 'Not available';
}

export default function DepartmentDashboard({
  departmentId,
  departmentName,
  profileId,
  roleType,
  metrics,
  attention,
  requests,
  workOrders,
  overduePm,
  overdueCalibration,
  generatedAt,
}: Props) {
  if (!departmentId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Department Dashboard" description="" />
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-6">
          <p className="font-medium text-[var(--foreground)]">No department linked</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{MISSING_DEPARTMENT_MESSAGE}</p>
        </div>
      </div>
    );
  }

  const title = `${departmentName ?? 'Department'} Dashboard`;
  const isHead = roleType === 'department_head';

  const headCards: MetricCard[] = [
    { label: 'Department Readiness', value: fmtPercent(metrics.readinessPercent), subtitle: 'Functional essential equipment ÷ total essential equipment.', icon: <Activity className="h-5 w-5" />, tone: metrics.readinessPercent === null ? 'neutral' : metrics.readinessPercent >= 80 ? 'success' : metrics.readinessPercent >= 60 ? 'warning' : 'critical' },
    { label: 'Total Equipment', value: metrics.totalAssets, subtitle: 'Active assets in the department.', icon: <Monitor className="h-5 w-5" />, tone: 'info', href: '/equipment', hrefLabel: 'Open Equipment' },
    { label: 'Functional Equipment', value: metrics.functionalAssets, subtitle: 'Currently working.', icon: <CheckCircle2 className="h-5 w-5" />, tone: 'success' },
    { label: 'Unavailable Equipment', value: metrics.nonFunctionalAssets + metrics.underMaintenanceAssets, subtitle: 'Non-functional or under maintenance.', icon: <AlertTriangle className="h-5 w-5" />, tone: metrics.nonFunctionalAssets + metrics.underMaintenanceAssets > 0 ? 'warning' : 'success' },
    { label: 'Open Requests', value: metrics.openRequests, subtitle: 'Maintenance requests in pending/approved/assigned/in_progress.', icon: <ClipboardCheck className="h-5 w-5" />, tone: 'info', href: '/requests', hrefLabel: 'Open Requests' },
    { label: 'Open Work Orders', value: metrics.openWorkOrders, subtitle: 'Work orders affecting department equipment.', icon: <Wrench className="h-5 w-5" />, tone: metrics.openWorkOrders > 0 ? 'info' : 'success', href: '/maintenance', hrefLabel: 'View Work Status' },
    { label: 'Critical Equipment Down', value: metrics.criticalEquipmentDown, subtitle: 'Essential assets currently unavailable.', icon: <ShieldAlert className="h-5 w-5" />, tone: metrics.criticalEquipmentDown > 0 ? 'critical' : 'success' },
    { label: 'PM / Calibration Exceptions', value: metrics.overduePm + metrics.overdueCalibration, subtitle: 'Overdue PM + overdue calibration.', icon: <Gauge className="h-5 w-5" />, tone: metrics.overduePm + metrics.overdueCalibration > 0 ? 'warning' : 'success', href: '/compliance', hrefLabel: 'Open Compliance' },
    { label: 'Training Needs', value: metrics.trainingNeeds, subtitle: 'Open training requests linked to department.', icon: <Building2 className="h-5 w-5" />, tone: 'info' },
    { label: 'Completed This Month', value: metrics.monthlyCompletedWork, subtitle: 'Work orders completed this calendar month.', icon: <TrendingUp className="h-5 w-5" />, tone: 'info' },
  ];

  // Filter requests submitted by this profile for "My Requests" subset.
  const myRequests = requests.filter((r) => r.submittedById === profileId);
  const userCards: MetricCard[] = [
    { label: 'Department Equipment', value: metrics.totalAssets, subtitle: 'Active assets in your department.', icon: <Monitor className="h-5 w-5" />, tone: 'info', href: '/equipment', hrefLabel: 'Open Equipment' },
    { label: 'Open Requests', value: metrics.openRequests, subtitle: 'All open requests in your department.', icon: <ClipboardCheck className="h-5 w-5" />, tone: 'info', href: '/requests', hrefLabel: 'All Department Requests' },
    { label: 'My Requests', value: myRequests.length, subtitle: 'Requests you submitted.', icon: <ClipboardCheck className="h-5 w-5" />, tone: 'info', href: '/requests?tab=my-requests', hrefLabel: 'View My Requests' },
    { label: 'Open Work Orders', value: metrics.openWorkOrders, subtitle: 'Work affecting department equipment.', icon: <Wrench className="h-5 w-5" />, tone: 'info', href: '/maintenance', hrefLabel: 'View Work Status' },
    { label: 'Unavailable Equipment', value: metrics.nonFunctionalAssets + metrics.underMaintenanceAssets, subtitle: 'Non-functional or under maintenance.', icon: <AlertTriangle className="h-5 w-5" />, tone: metrics.nonFunctionalAssets + metrics.underMaintenanceAssets > 0 ? 'warning' : 'success' },
    { label: 'Critical Alerts', value: metrics.unacknowledgedAlerts, subtitle: 'Unacknowledged signals affecting your department.', icon: <ShieldAlert className="h-5 w-5" />, tone: metrics.unacknowledgedAlerts > 0 ? 'warning' : 'success', href: '/alerts', hrefLabel: 'Open Alerts' },
    { label: 'Completed This Month', value: metrics.monthlyCompletedWork, subtitle: 'Work orders completed this month.', icon: <TrendingUp className="h-5 w-5" />, tone: 'info' },
  ];

  const cards = isHead ? headCards : userCards;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <PageHeader
            title={title}
            description={isHead
              ? 'Department equipment, requests, work status, compliance, and alerts — scoped to your department.'
              : 'Track your equipment, submitted requests, and open work — scoped to your department.'}
          />
          <p className="text-xs text-[var(--text-muted)]">Updated {generatedAt} · Department view</p>
        </div>
        <Badge variant="info">{isHead ? 'Department Head view' : 'Department User view'}</Badge>
      </div>

      <section aria-label="Department metric cards">
        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ${isHead ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
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
              {c.href && (
                <Link href={c.href} className="mt-auto inline-flex w-fit items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">
                  {c.hrefLabel} →
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Department readiness summary */}
      <section aria-label="Department readiness">
        <Card>
          <CardHeader>
            <CardTitle><span className="inline-flex items-center gap-2"><Activity className="h-5 w-5 text-cyan-300" />Department readiness</span></CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-[var(--text-muted)]">All values computed from department-scoped rows. No hospital-wide fallback.</p>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Metric label="Functional equipment" value={`${metrics.functionalAssets} / ${metrics.totalAssets}`} />
              <Metric label="Readiness %" value={fmtPercent(metrics.readinessPercent)} />
              <Metric label="Critical equipment unavailable" value={String(metrics.criticalEquipmentDown)} />
              <Metric label="Open critical/high work" value={String(metrics.criticalOpenWork)} />
              <Metric label="Overdue PM" value={String(metrics.overduePm)} />
              <Metric label="Overdue calibration" value={String(metrics.overdueCalibration)} />
              <Metric label="Awaiting parts (on hold)" value={String(metrics.awaitingPartsWork)} />
              <Metric label="Failed / adjusted calibration" value={String(metrics.failedCalibration)} />
            </dl>
          </CardContent>
        </Card>
      </section>

      {/* Equipment requiring attention */}
      <section aria-label="Equipment requiring attention">
        <Card>
          <CardHeader>
            <CardTitle><span className="inline-flex items-center gap-2"><AlertCircle className="h-5 w-5 text-amber-300" />Equipment requiring attention</span></CardTitle>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">No equipment currently flagged.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[820px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Condition</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Criticality</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Issue</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Last update</th>
                      <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {attention.slice(0, 15).map((a) => (
                      <tr key={a.id}>
                        <td className="py-3 pr-4">
                          <Link href={deptEquipmentDetail(a.id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">{a.assetName}</Link>
                          <p className="text-xs text-[var(--text-muted)]">{a.assetCode}</p>
                        </td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{a.condition}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{a.criticality ?? '—'}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{a.issue}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{a.lastUpdate?.slice(0, 10) ?? '—'}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <Link href={deptEquipmentDetail(a.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Open Asset Profile</Link>
                            <Link href={deptCreateMaintenanceRequest(a.id)} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Create Request</Link>
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

      {/* Request and work status (preview) */}
      <section aria-label="Request and work status">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle><span className="inline-flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-violet-300" />Request and work status</span></CardTitle>
              <Link href="/requests" className="text-xs text-violet-300 hover:text-violet-200">Open requests →</Link>
            </div>
          </CardHeader>
          <CardContent>
            {(isHead ? requests : myRequests).length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">No {isHead ? 'department' : 'personal'} requests in flight.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[820px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Request</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Submitted by</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Status</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Urgency</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Last update</th>
                      <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {(isHead ? requests : myRequests).slice(0, 10).map((r) => (
                      <tr key={r.id}>
                        <td className="py-3 pr-4 font-medium text-[var(--foreground)]">{r.requestNumber}</td>
                        <td className="py-3 pr-4">
                          <p className="text-[var(--foreground)]">{r.assetName}</p>
                          <p className="text-xs text-[var(--text-muted)]">{r.assetCode}</p>
                        </td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{r.submittedBy}</td>
                        <td className="py-3 pr-4"><Badge variant="info">{r.status}</Badge></td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{r.urgency ?? '—'}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{r.updatedAt?.slice(0, 10) ?? r.createdAt?.slice(0, 10) ?? '—'}</td>
                        <td className="py-3">
                          <Link href={deptMaintenanceRequestDetail(r.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Request</Link>
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

      {/* Compliance exceptions */}
      <section aria-label="Compliance exceptions">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle><span className="inline-flex items-center gap-2"><Gauge className="h-5 w-5 text-amber-300" />Compliance exceptions</span></CardTitle>
              <Link href="/compliance" className="text-xs text-violet-300 hover:text-violet-200">Open compliance →</Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">Overdue PM</h3>
                {overduePm.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">No overdue PM in department.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {overduePm.slice(0, 5).map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2">
                        <Link href={p.assetId ? deptEquipmentDetail(p.assetId) : '#'} className="text-[var(--foreground)] hover:text-violet-300">{p.assetName}</Link>
                        <Badge variant={p.daysOverdue > 30 ? 'error' : 'warning'}>{p.daysOverdue}d</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">Overdue calibration</h3>
                {overdueCalibration.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">No overdue calibration in department.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {overdueCalibration.slice(0, 5).map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2">
                        <Link href={deptEquipmentDetail(c.assetId)} className="text-[var(--foreground)] hover:text-violet-300">{c.assetName}</Link>
                        <Badge variant={c.daysOverdue > 30 ? 'error' : 'warning'}>{c.daysOverdue}d</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Open work orders preview */}
      {workOrders.length > 0 && (
        <section aria-label="Open work orders">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle><span className="inline-flex items-center gap-2"><Wrench className="h-5 w-5 text-orange-300" />Open work orders</span></CardTitle>
                <Link href="/maintenance" className="text-xs text-violet-300 hover:text-violet-200">Open work status →</Link>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-[720px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Work Order</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Priority</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Status</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Technician</th>
                      <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {workOrders.slice(0, 8).map((w) => (
                      <tr key={w.id}>
                        <td className="py-3 pr-4 font-medium text-[var(--foreground)]">{w.workOrderNumber ?? `WO ${w.id.slice(0, 8)}`}</td>
                        <td className="py-3 pr-4">
                          <p className="text-[var(--foreground)]">{w.assetName}</p>
                          <p className="text-xs text-[var(--text-muted)]">{w.assetCode}</p>
                        </td>
                        <td className="py-3 pr-4"><Badge variant={w.priority === 'critical' ? 'error' : w.priority === 'high' ? 'warning' : 'default'}>{w.priority ?? '—'}</Badge></td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{w.status}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{w.assignedTechnician ?? '—'}</td>
                        <td className="py-3">
                          <Link href={deptWorkOrderEvidence(w.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Work Status</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Quick links */}
      <section aria-label="Quick links">
        <div className="flex flex-wrap gap-2">
          <Link href="/equipment" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]"><Monitor className="h-4 w-4" /> Department Equipment</Link>
          <Link href="/requests" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]"><ClipboardCheck className="h-4 w-4" /> Department Requests</Link>
          <Link href="/maintenance" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]"><Wrench className="h-4 w-4" /> Work Status</Link>
          <Link href="/compliance" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]"><CalendarDays className="h-4 w-4" /> Compliance</Link>
          <Link href="/alerts" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]"><ShieldAlert className="h-4 w-4" /> Department Alerts</Link>
          <Link href="/calendar" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]"><CalendarDays className="h-4 w-4" /> Calendar</Link>
          <Link href={deptReport('department-readiness', departmentId)} className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">Reports</Link>
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
