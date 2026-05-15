'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, AlertCircle, CheckCircle2, Clock, ShieldAlert, XCircle } from 'lucide-react';
import { PageHeader, Badge, StatCard } from '@/components/ui';
import { MISSING_DEPARTMENT_MESSAGE, type DepartmentRoleType } from '@/utils/department/department-scope';
import { deptCreateMaintenanceRequest, deptCreateCalibrationRequest, deptCreateTrainingRequest, deptRequestDetail, deptMaintenanceRequestDetail } from '@/utils/department/department-evidence-links';
import type { RequestHubRow } from '../_lib/requests-hub-data';

interface Props {
  rows: RequestHubRow[];
  departmentId: string | null;
  departmentName: string | null;
  profileId: string | null;
  roleType: DepartmentRoleType;
}

type Tab = 'all' | 'mine' | 'maintenance' | 'calibration' | 'training' | 'installation' | 'specification' | 'disposal' | 'completed';

const STATUS_COMPLETED = new Set(['completed', 'closed', 'fulfilled']);
const STATUS_REJECTED = new Set(['rejected', 'returned', 'canceled', 'cancelled']);
const STATUS_OPEN = new Set(['pending', 'approved', 'assigned', 'in_progress', 'scheduled', 'ordered', 'in_transit', 'requested']);

export default function DepartmentRequestsPage({ rows, departmentId, departmentName, profileId, roleType }: Props) {
  const isHead = roleType === 'department_head';
  const [tab, setTab] = useState<Tab>(isHead ? 'all' : 'mine');

  const counts = useMemo(() => {
    let open = 0, myOpen = 0, pending = 0, inProgress = 0, completed = 0, rejected = 0, critical = 0;
    for (const r of rows) {
      const s = (r.status ?? '').toLowerCase();
      const isOpen = STATUS_OPEN.has(s);
      const isCompleted = STATUS_COMPLETED.has(s);
      const isRejected = STATUS_REJECTED.has(s);
      if (isOpen) open++;
      if (isOpen && r.submittedById === profileId) myOpen++;
      if (s === 'pending') pending++;
      if (s === 'in_progress') inProgress++;
      if (isCompleted) completed++;
      if (isRejected) rejected++;
      // RequestHubRow has no `urgency`; use status keyword as proxy for critical badge.
      if ((r.status ?? '').toLowerCase().includes('critical')) critical++;
    }
    return { open, myOpen, pending, inProgress, completed, rejected, critical };
  }, [rows, profileId]);

  const filtered = useMemo(() => {
    let out = rows;
    if (tab === 'mine') out = out.filter((r) => r.submittedById === profileId);
    else if (tab === 'completed') out = out.filter((r) => STATUS_COMPLETED.has((r.status ?? '').toLowerCase()));
    else if (tab !== 'all') out = out.filter((r) => r.type === tab);
    return out;
  }, [rows, tab, profileId]);

  if (!departmentId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Department Requests" description="" />
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-6">
          <p className="font-medium text-[var(--foreground)]">No department linked</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{MISSING_DEPARTMENT_MESSAGE}</p>
        </div>
      </div>
    );
  }

  const tabs: Array<{ key: Tab; label: string }> = isHead
    ? [
        { key: 'all', label: 'All Department Requests' },
        { key: 'mine', label: 'My Requests' },
        { key: 'maintenance', label: 'Maintenance' },
        { key: 'calibration', label: 'Calibration' },
        { key: 'training', label: 'Training' },
        { key: 'installation', label: 'Installation / Specification' },
        { key: 'disposal', label: 'Disposal / Other' },
        { key: 'completed', label: 'Completed' },
      ]
    : [
        { key: 'mine', label: 'My Requests' },
        { key: 'all', label: 'All Department Requests' },
        { key: 'maintenance', label: 'Maintenance' },
        { key: 'calibration', label: 'Calibration' },
        { key: 'training', label: 'Training' },
        { key: 'completed', label: 'Completed' },
      ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={isHead ? 'Department Requests' : 'Submit and Track Requests'}
        description={`Department-scoped request view for ${departmentName ?? 'your department'}. Approvals are not department-role actions.`}
        breadcrumbs={[{ label: 'Department Dashboard', href: '/command' }, { label: 'Requests' }]}
        actions={<Badge variant="info">{isHead ? 'Department Head view' : 'Department User view'}</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Open Requests" value={counts.open} icon={<ClipboardCheck className="h-5 w-5" />} color="blue" />
        <StatCard label="My Open Requests" value={counts.myOpen} icon={<ClipboardCheck className="h-5 w-5" />} color="purple" />
        <StatCard label="Pending BME Review" value={counts.pending} icon={<Clock className="h-5 w-5" />} color="yellow" />
        <StatCard label="In Progress" value={counts.inProgress} icon={<AlertCircle className="h-5 w-5" />} color="orange" />
        <StatCard label="Completed" value={counts.completed} icon={<CheckCircle2 className="h-5 w-5" />} color="green" />
        <StatCard label="Rejected / Returned" value={counts.rejected} icon={<XCircle className="h-5 w-5" />} color="red" />
        <StatCard label="Critical Requests" value={counts.critical} icon={<ShieldAlert className="h-5 w-5" />} color="red" />
      </div>

      <div className="panel-surface rounded-xl p-4">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${tab === t.key ? 'bg-[var(--brand)] text-white' : 'border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--foreground)]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-surface flex flex-wrap items-center gap-2 rounded-xl p-4">
        <Link href={deptCreateMaintenanceRequest(null)} className="rounded-md bg-[var(--brand)] px-3 py-1.5 text-sm text-white">Create Maintenance Request</Link>
        <Link href={deptCreateCalibrationRequest(null)} className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">Create Calibration Request</Link>
        <Link href={deptCreateTrainingRequest(null)} className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">Request Training</Link>
      </div>

      <div className="panel-surface overflow-x-auto rounded-xl">
        <table className="min-w-[1080px] w-full text-sm">
          <thead className="border-b border-[var(--border-subtle)]/60">
            <tr className="text-left">
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Request</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Type</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Asset</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Submitted by</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Status</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Submitted</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Last update</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]/60">
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">No requests match this view.</td></tr>
            ) : filtered.slice(0, 200).map((r) => (
              <tr key={`${r.type}-${r.id}`}>
                <td className="px-4 py-3 font-medium text-[var(--foreground)]">{r.requestNumber || `Request ${r.id.slice(0, 8)}`}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{r.type}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{r.assetName ?? '—'}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{r.submittedBy ?? '—'}</td>
                <td className="px-4 py-3"><Badge variant="info">{r.status}</Badge></td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{r.createdAt?.slice(0, 10) ?? '—'}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{r.createdAt?.slice(0, 10) ?? '—'}</td>
                <td className="px-4 py-3">
                  <Link href={r.type === 'maintenance' ? deptMaintenanceRequestDetail(r.id) : deptRequestDetail(r.type, r.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Request</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Approve / Reject / Assign / Start / Complete / Cancel / Resolve are BME / technician actions and are not visible in this view.
      </p>
    </div>
  );
}
