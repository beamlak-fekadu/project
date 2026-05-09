'use client';

import Link from 'next/link';
import { AlertCircle, CheckCircle2, Clock, Users } from 'lucide-react';
import type { TechnicianWorkloadItem } from '../_lib/command-center-data';

interface Props {
  technicians: TechnicianWorkloadItem[];
  canMutate: boolean;
}

const STATUS_META: Record<
  TechnicianWorkloadItem['status'],
  { label: string; dot: string; ring: string; text: string }
> = {
  available:  { label: 'Available',  dot: 'bg-emerald-400', ring: 'ring-emerald-500/30', text: 'text-emerald-300' },
  busy:       { label: 'Busy',       dot: 'bg-amber-400',   ring: 'ring-amber-500/30',   text: 'text-amber-300' },
  overloaded: { label: 'Overloaded', dot: 'bg-rose-400',    ring: 'ring-rose-500/30',    text: 'text-rose-300' },
};

function WorkloadBar({ current, max = 8 }: { current: number; max?: number }) {
  const pct = Math.min(100, (current / max) * 100);
  const color = current >= 6 ? 'bg-rose-400' : current >= 3 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function TechnicianWorkload({ technicians, canMutate }: Props) {
  if (technicians.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Users className="h-7 w-7 text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-muted)]">No technician assignments found</p>
        <p className="text-xs text-[var(--text-muted)]">Assign work orders to technicians to see workload data</p>
      </div>
    );
  }

  const overloaded = technicians.filter((t) => t.status === 'overloaded');
  const available = technicians.filter((t) => t.status === 'available');

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          {available.length} available
        </span>
        {overloaded.length > 0 && (
          <span className="flex items-center gap-1.5 text-rose-300">
            <AlertCircle className="h-4 w-4" />
            {overloaded.length} overloaded
          </span>
        )}
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
          <Clock className="h-4 w-4" />
          {technicians.reduce((s, t) => s + t.estimatedHours, 0).toFixed(0)} total hours
        </span>
      </div>

      {/* Technician cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {technicians.map((tech) => {
          const meta = STATUS_META[tech.status];
          return (
            <div
              key={tech.profileId}
              className={`panel-surface rounded-lg p-4 ring-1 ${meta.ring}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[var(--foreground)]">{tech.name}</p>
                  <span className={`mt-0.5 inline-flex items-center gap-1 text-xs font-medium ${meta.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xl font-bold text-[var(--foreground)] tabular-nums">{tech.openAssignments}</p>
                  <p className="text-xs text-[var(--text-muted)]">open tasks</p>
                </div>
              </div>

              <WorkloadBar current={tech.openAssignments} />

              <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
                {tech.inProgress > 0 && <span>{tech.inProgress} in progress</span>}
                {tech.criticalTasks > 0 && <span className="text-rose-400">{tech.criticalTasks} critical</span>}
                {tech.overdueTasks > 0 && <span className="text-amber-400">{tech.overdueTasks} high/critical priority</span>}
                {tech.estimatedHours > 0 && <span>~{tech.estimatedHours.toFixed(0)}h estimated</span>}
              </div>

              {canMutate && (
                <div className="mt-3 flex gap-2">
                  <Link
                    href={`/command/drilldown/open-work-orders?assignedTo=${tech.profileId}`}
                    className="text-xs text-violet-300 hover:text-violet-200"
                  >
                    View assignments →
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Suggested assignment note */}
      {available.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          Suggested for next assignment:{' '}
          <span className="font-medium text-emerald-300">
            {available[0].name}
          </span>{' '}
          ({available[0].openAssignments} open task{available[0].openAssignments !== 1 ? 's' : ''})
        </p>
      )}
    </div>
  );
}
