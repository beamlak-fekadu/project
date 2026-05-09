'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle2, Wrench } from 'lucide-react';
import { ScoreExplanation } from './ScoreExplanation';
import type { CriticalActionItem } from '../_lib/command-center-data';

const CATEGORY_META: Record<
  CriticalActionItem['category'],
  { label: string; colorClass: string; textClass: string; bg: string }
> = {
  corrective:   { label: 'Corrective',   colorClass: 'border-rose-500/40',   textClass: 'text-rose-300',   bg: 'bg-rose-500/10' },
  needs_request: { label: 'Needs Request', colorClass: 'border-amber-500/40', textClass: 'text-amber-300', bg: 'bg-amber-500/10' },
  risk_watch:   { label: 'Risk Watch',   colorClass: 'border-orange-500/40', textClass: 'text-orange-300', bg: 'bg-orange-500/10' },
  calibration:  { label: 'Calibration',  colorClass: 'border-amber-500/40',  textClass: 'text-amber-300',  bg: 'bg-amber-500/10' },
  pm:           { label: 'PM',           colorClass: 'border-amber-400/40',  textClass: 'text-amber-200',  bg: 'bg-amber-400/10' },
  stock:        { label: 'Stock',        colorClass: 'border-orange-500/40', textClass: 'text-orange-300', bg: 'bg-orange-500/10' },
  installation: { label: 'Installation', colorClass: 'border-blue-500/40',   textClass: 'text-blue-300',   bg: 'bg-blue-500/10' },
  replacement:  { label: 'Replacement',  colorClass: 'border-violet-500/40', textClass: 'text-violet-300', bg: 'bg-violet-500/10' },
  procurement:  { label: 'Procurement',  colorClass: 'border-sky-500/40',    textClass: 'text-sky-300',    bg: 'bg-sky-500/10' },
  training:     { label: 'Training',     colorClass: 'border-teal-500/40',   textClass: 'text-teal-300',   bg: 'bg-teal-500/10' },
};

const URGENCY_META: Record<CriticalActionItem['urgency'], { label: string; class: string }> = {
  critical: { label: 'Critical', class: 'bg-rose-500/20 text-rose-300' },
  high:     { label: 'High',     class: 'bg-amber-500/20 text-amber-300' },
  medium:   { label: 'Medium',   class: 'bg-orange-500/20 text-orange-300' },
  low:      { label: 'Low',      class: 'bg-slate-500/20 text-slate-300' },
};

interface Props {
  items: CriticalActionItem[];
  canMutate: boolean;
}

export function CriticalActionStrip({ items, canMutate }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-5 py-4">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
        <div>
          <p className="text-sm font-medium text-emerald-300">No critical actions right now</p>
          <p className="text-xs text-[var(--text-muted)]">All workflows within operational parameters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" id="critical-actions">
      {items.map((item) => {
        const meta = CATEGORY_META[item.category];
        const urgencyMeta = URGENCY_META[item.urgency];
        return (
          <div
            key={item.id}
            className={`flex flex-col gap-3 rounded-lg border bg-[var(--surface-1)] p-4 transition sm:flex-row sm:items-center ${meta.colorClass}`}
          >
            {/* Left: category + title + reason */}
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${meta.bg} ${meta.textClass}`}>
                  <Wrench className="h-3 w-3" />
                  {meta.label}
                </span>
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${urgencyMeta.class}`}>
                  {urgencyMeta.label}
                </span>
                {item.departmentName && (
                  <span className="text-xs text-[var(--text-muted)]">{item.departmentName}</span>
                )}
              </div>
              <p className="font-medium text-[var(--foreground)]">{item.title}</p>
              <p className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">{item.reason}</p>
            </div>

            {/* Right: actions */}
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <ScoreExplanation details={{
                title: `Critical action score — ${item.title}`,
                scoreLabel: `${Math.round(item.score)}`,
                formula: 'category base weight + item score contribution',
                criteria: ['Workflow category weight', 'Urgency/severity', 'Department criticality where available', 'Delay/age', 'Blocking impact where available'],
                rawValues: [
                  { label: 'Category', value: meta.label },
                  { label: 'Urgency', value: item.urgency },
                  { label: 'Department', value: item.departmentName ?? 'Not available' },
                  { label: 'Breakdown', value: item.scoreBreakdown?.join(' · ') ?? 'Not available' },
                ],
                calculation: item.scoreBreakdown?.join(' + ') ?? `Critical score = ${Math.round(item.score)}`,
                generatedReason: item.reason,
                source: 'Corrected Command Center triage category arrays',
                assignmentMethod: 'Computed',
                actionSuggestion: item.primaryAction,
              }}>
                <span className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs font-semibold text-[var(--foreground)]">
                  Score {Math.round(item.score)}
                </span>
              </ScoreExplanation>
              <Link
                href={canMutate ? item.primaryActionHref : (item.assetId ? `/equipment/${item.assetId}` : item.secondaryActionHref ?? '/command')}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
              >
                {canMutate ? item.primaryAction : 'Details'}
                <ArrowRight className="h-3 w-3" />
              </Link>
              {item.secondaryAction && item.secondaryActionHref && (
                <Link
                  href={item.secondaryActionHref}
                  className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition hover:border-[var(--brand)]/50 hover:text-[var(--foreground)]"
                >
                  {item.secondaryAction}
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
