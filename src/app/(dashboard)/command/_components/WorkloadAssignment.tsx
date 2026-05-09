'use client';

import Link from 'next/link';
import { AlertCircle, CheckCircle2, Clock, ClipboardList, Users } from 'lucide-react';
import { ScoreExplanation } from './ScoreExplanation';
import type { TechnicianWorkloadItem, WorkOrderSummary, WorkQueueItem } from '../_lib/command-center-data';

interface Props {
  summary: WorkOrderSummary;
  queue: WorkQueueItem[];
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
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function WOStatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`flex flex-col items-center rounded-lg border px-3 py-2 ${color}`}>
      <p className="text-lg font-bold tabular-nums text-[var(--foreground)]">{value}</p>
      <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
    </div>
  );
}

export function WorkloadAssignment({ summary, queue, technicians, canMutate }: Props) {
  const available = technicians.filter((t) => t.status === 'available');
  const overloaded = technicians.filter((t) => t.status === 'overloaded');
  const suggestedTech = [...technicians].sort((a, b) =>
    a.openAssignments - b.openAssignments
    || a.criticalTasks - b.criticalTasks
    || a.estimatedHours - b.estimatedHours
  )[0] ?? null;

  return (
    <div className="space-y-5">
      {/* Work queue summary */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <ClipboardList className="h-4 w-4 text-blue-400" />
            Work queue
          </h3>
          {canMutate && (
            <Link href="/command/drilldown/open-work-orders" className="text-xs text-violet-300 hover:text-violet-200">
              View all →
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <WOStatChip label="Total open" value={summary.total} color="border-[var(--border-subtle)]/60" />
          <WOStatChip
            label="Unassigned"
            value={summary.unassigned}
            color={summary.unassigned > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-[var(--border-subtle)]/60'}
          />
          <WOStatChip label="Assigned" value={summary.assigned} color="border-[var(--border-subtle)]/60" />
          <WOStatChip label="In progress" value={summary.inProgress} color="border-emerald-500/30 bg-emerald-500/10" />
          <WOStatChip label="On hold" value={summary.onHold} color={summary.onHold > 0 ? 'border-rose-500/30 bg-rose-500/10' : 'border-[var(--border-subtle)]/60'} />
          <WOStatChip
            label="High/critical"
            value={summary.criticalOrHigh}
            color={summary.criticalOrHigh > 0 ? 'border-rose-500/40 bg-rose-500/10' : 'border-[var(--border-subtle)]/60'}
          />
          <WOStatChip
            label="Overdue PM"
            value={summary.overduePM}
            color={summary.overduePM > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-[var(--border-subtle)]/60'}
          />
          <WOStatChip
            label="Calibration"
            value={summary.calibrationDue}
            color={summary.calibrationDue > 0 ? 'border-violet-500/40 bg-violet-500/10' : 'border-[var(--border-subtle)]/60'}
          />
        </div>
        {summary.unassigned > 0 && canMutate && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>
              {summary.unassigned} work order{summary.unassigned > 1 ? 's are' : ' is'} unassigned.
              {suggestedTech ? ` Suggested: ${suggestedTech.name} (${suggestedTech.openAssignments} open tasks).` : ''}
            </span>
            {suggestedTech && (
              <ScoreExplanation details={{
                title: `Assignment suggestion — ${suggestedTech.name}`,
                scoreLabel: 'Workload-only suggestion',
                formula: 'lowest open assignment count, then fewer critical tasks, then fewer estimated hours',
                criteria: ['Open tasks', 'In-progress tasks', 'Critical/overdue tasks', 'Estimated hours'],
                rawValues: [
                  { label: 'Open tasks', value: suggestedTech.openAssignments },
                  { label: 'In progress', value: suggestedTech.inProgress },
                  { label: 'Critical tasks', value: suggestedTech.criticalTasks },
                  { label: 'Estimated hours', value: suggestedTech.estimatedHours },
                ],
                calculation: `${suggestedTech.openAssignments} open, ${suggestedTech.criticalTasks} critical, ~${suggestedTech.estimatedHours.toFixed(0)}h estimated`,
                generatedReason: 'Suggested because this technician has the lightest current workload among visible assigned technicians.',
                source: 'work_orders',
                assignmentMethod: 'Computed from workload only',
                actionSuggestion: 'Suggestion based on workload; skill matching can be added later.',
              }}>
                <span className="shrink-0 rounded-md border border-amber-500/40 px-2 py-1 font-medium underline underline-offset-2">Why?</span>
              </ScoreExplanation>
            )}
            {canMutate && queue.find((item) => !item.assignedToId) && (
              <Link href={`${queue.find((item) => !item.assignedToId)!.detailHref}?action=assign`} className="ml-auto shrink-0 font-medium underline underline-offset-2">
                Assign now
              </Link>
            )}
          </div>
        )}
      </div>

      {queue.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Immediate work order actions</h3>
          <div className="space-y-2">
            {queue.slice(0, 6).map((item) => (
              <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)]/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--foreground)]">{item.assetName}</p>
                  <p className="text-xs text-[var(--text-muted)]">{item.workOrderNumber} · {item.status.replace(/_/g, ' ')} · {item.assignedToName ?? 'Unassigned'} · open {item.daysOpen}d</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {canMutate && (
                    <Link href={item.primaryActionHref} className="rounded-md bg-[var(--brand)] px-2.5 py-1 text-xs font-medium text-white">
                      {item.primaryAction}
                    </Link>
                  )}
                  <Link href={item.detailHref} className="rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)]">
                    Open Work Order
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Technician cards */}
      {technicians.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
              <Users className="h-4 w-4 text-blue-400" />
              Technician availability
            </h3>
            <div className="flex gap-3 text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                {available.length} available
              </span>
              {overloaded.length > 0 && (
                <span className="flex items-center gap-1 text-rose-300">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {overloaded.length} overloaded
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {technicians.reduce((s, t) => s + t.estimatedHours, 0).toFixed(0)}h total
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {technicians.map((tech) => {
              const meta = STATUS_META[tech.status];
              return (
                <div key={tech.profileId} className={`panel-surface rounded-lg p-4 ring-1 ${meta.ring}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-[var(--foreground)]">{tech.name}</p>
                      {tech.departmentName && <p className="truncate text-[11px] text-[var(--text-muted)]">{tech.departmentName}</p>}
                      <span className={`mt-0.5 inline-flex items-center gap-1 text-xs font-medium ${meta.text}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    </div>
                    <ScoreExplanation details={{
                      title: `Workload score — ${tech.name}`,
                      scoreLabel: `${tech.openAssignments} open tasks`,
                      formula: 'open assignments + in-progress load + critical/overdue pressure + estimated hours',
                      criteria: ['Open tasks', 'In-progress tasks', 'Critical/overdue tasks', 'Estimated hours'],
                      rawValues: [
                        { label: 'Open tasks', value: tech.openAssignments },
                        { label: 'In progress', value: tech.inProgress },
                        { label: 'Critical tasks', value: tech.criticalTasks },
                        { label: 'Estimated hours', value: tech.estimatedHours },
                      ],
                      calculation: `${tech.openAssignments} open, ${tech.inProgress} in progress, ${tech.criticalTasks} critical, ~${tech.estimatedHours.toFixed(0)}h`,
                      generatedReason: `Status is ${meta.label.toLowerCase()} based on current work order load.`,
                      source: 'work_orders',
                      assignmentMethod: 'Computed from workload only',
                      actionSuggestion: 'Suggestion based on workload; skill matching can be added later.',
                    }}>
                      <span className="shrink-0 text-right">
                        <span className="block text-xl font-bold tabular-nums text-[var(--foreground)]">{tech.openAssignments}</span>
                        <span className="block text-xs text-[var(--text-muted)]">tasks</span>
                      </span>
                    </ScoreExplanation>
                  </div>
                  <WorkloadBar current={tech.openAssignments} />
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
                    {tech.inProgress > 0 && <span>{tech.inProgress} in progress</span>}
                    {tech.criticalTasks > 0 && <span className="text-rose-400">{tech.criticalTasks} critical</span>}
                    {tech.estimatedHours > 0 && <span>~{tech.estimatedHours.toFixed(0)}h estimated</span>}
                  </div>
                  {canMutate && (
                    <div className="mt-2">
                      <Link href={`/command/drilldown/open-work-orders?assignedTo=${tech.profileId}`} className="text-xs text-violet-300 hover:text-violet-200">
                        View assignments →
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {technicians.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Users className="h-7 w-7 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-muted)]">No active technician profiles found</p>
          {canMutate && (
            <Link href="/command/drilldown/open-work-orders" className="text-xs text-violet-300 hover:text-violet-200">
              Assign open work orders →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
