import Link from 'next/link';
import { AlertCircle, CalendarCheck, CheckCircle2, Gauge, ShieldAlert, XCircle } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import {
  type DepartmentMetrics,
  type DepartmentPmRow,
  type DepartmentCalRow,
} from '@/utils/department/department-metrics';
import { MISSING_DEPARTMENT_MESSAGE } from '@/utils/department/department-scope';
import { deptCreateCalibrationRequest, deptEquipmentDetail } from '@/utils/department/department-evidence-links';

interface Props {
  departmentId: string | null;
  departmentName: string | null;
  metrics: DepartmentMetrics;
  overduePm: DepartmentPmRow[];
  overdueCalibration: DepartmentCalRow[];
}

function ComplianceCard({ label, value, sub, icon, tone = 'info' }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; tone?: 'critical' | 'warning' | 'success' | 'info' }) {
  const tones = {
    critical: 'border-rose-500/40 bg-rose-500/5',
    warning: 'border-amber-500/40 bg-amber-500/5',
    success: 'border-emerald-500/40 bg-emerald-500/5',
    info: 'border-cyan-500/40 bg-cyan-500/5',
  };
  return (
    <div className={`flex flex-col gap-1 rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-bold leading-none text-[var(--foreground)]">{value}</span>
        <span className="rounded-md bg-[var(--surface-2)] p-2">{icon}</span>
      </div>
      <span className="text-sm font-medium text-[var(--foreground)]">{label}</span>
      {sub && <span className="text-xs leading-snug text-[var(--text-muted)]">{sub}</span>}
    </div>
  );
}

export default function DepartmentComplianceStatus({ departmentId, departmentName, metrics, overduePm, overdueCalibration }: Props) {
  if (!departmentId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Department Compliance Status" description="" />
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-6">
          <p className="font-medium text-[var(--foreground)]">No department linked</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{MISSING_DEPARTMENT_MESSAGE}</p>
        </div>
      </div>
    );
  }

  const failedAdjusted = overdueCalibration.filter((c) => (c.lastResult ?? '').toLowerCase() === 'failed' || (c.lastResult ?? '').toLowerCase() === 'adjusted');
  const criticalExceptions = overduePm.filter((p) => p.daysOverdue > 30).length + overdueCalibration.filter((c) => c.daysOverdue > 30).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Department Compliance Status"
        description={`PM and calibration compliance for ${departmentName ?? 'your department'}.`}
        breadcrumbs={[{ label: 'Department Dashboard', href: '/command' }, { label: 'Compliance Status' }]}
        actions={<Badge variant="info">Department view</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <ComplianceCard label="Overdue PM" value={overduePm.length} sub="PM schedules past their date." icon={<AlertCircle className="h-5 w-5 text-rose-300" />} tone={overduePm.length > 0 ? 'warning' : 'success'} />
        <ComplianceCard label="Overdue Calibration" value={overdueCalibration.length} sub="Calibration past next_due_date." icon={<Gauge className="h-5 w-5 text-rose-300" />} tone={overdueCalibration.length > 0 ? 'warning' : 'success'} />
        <ComplianceCard label="Critical Exceptions" value={criticalExceptions} sub="More than 30 days overdue." icon={<ShieldAlert className="h-5 w-5 text-rose-300" />} tone={criticalExceptions > 0 ? 'critical' : 'success'} />
        <ComplianceCard label="Completed PM This Month" value={metrics.monthlyCompletedPm} sub="PM tasks completed this month." icon={<CalendarCheck className="h-5 w-5 text-emerald-300" />} tone="success" />
        <ComplianceCard label="Calibration Completed This Month" value={metrics.monthlyCompletedCalibration} sub="Calibration records this month." icon={<CheckCircle2 className="h-5 w-5 text-emerald-300" />} tone="success" />
        <ComplianceCard label="Failed / Adjusted Calibration" value={metrics.failedCalibration} sub="From v_calibration_due last_result." icon={<XCircle className="h-5 w-5 text-amber-300" />} tone={metrics.failedCalibration > 0 ? 'warning' : 'success'} />
      </div>

      <Card>
        <CardHeader><CardTitle>Overdue PM in department</CardTitle></CardHeader>
        <CardContent>
          {overduePm.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">No overdue PM in this department.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[640px] w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Scheduled date</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Days overdue</th>
                    <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]/60">
                  {overduePm.slice(0, 25).map((p) => (
                    <tr key={p.id}>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-[var(--foreground)]">{p.assetName}</p>
                        <p className="text-xs text-[var(--text-muted)]">{p.assetCode}</p>
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{p.scheduledDate ?? '—'}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]"><Badge variant={p.daysOverdue > 30 ? 'error' : 'warning'}>{p.daysOverdue}</Badge></td>
                      <td className="py-3">
                        {p.assetId && <Link href={deptEquipmentDetail(p.assetId)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Asset Profile</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Overdue calibration in department</CardTitle></CardHeader>
        <CardContent>
          {overdueCalibration.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">No overdue calibration in this department.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[720px] w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Next due</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Days overdue</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Last result</th>
                    <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]/60">
                  {overdueCalibration.slice(0, 25).map((c) => (
                    <tr key={c.id}>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-[var(--foreground)]">{c.assetName}</p>
                        <p className="text-xs text-[var(--text-muted)]">{c.assetCode}</p>
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{c.nextDueDate ?? '—'}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]"><Badge variant={c.daysOverdue > 30 ? 'error' : 'warning'}>{c.daysOverdue}</Badge></td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{c.lastResult ?? '—'}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Link href={deptEquipmentDetail(c.assetId)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Asset Profile</Link>
                          <Link href={deptCreateCalibrationRequest(c.assetId)} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Create Calibration Request</Link>
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

      {failedAdjusted.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Failed / adjusted calibration results</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {failedAdjusted.slice(0, 20).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)]/60 px-3 py-2">
                  <div>
                    <Link href={deptEquipmentDetail(c.assetId)} className="font-medium text-[var(--foreground)] hover:text-violet-300">{c.assetName}</Link>
                    <span className="ml-2 text-xs text-[var(--text-muted)]">{c.assetCode}</span>
                  </div>
                  <Badge variant="warning">{c.lastResult}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        Schedule / Defer / Skip / Complete PM / Record Calibration Result are BME / technician actions and are not visible here.
      </p>
    </div>
  );
}
