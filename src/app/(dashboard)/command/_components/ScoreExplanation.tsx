'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Info, X } from 'lucide-react';
import type { ScoreExplanation as ScoreExplanationData } from '../_lib/command-center-data';

interface Props {
  details: ScoreExplanationData;
  children?: ReactNode;
  showIcon?: boolean;
}

function DetailList({ items }: { items?: Array<{ label: string; value: string | number | null }> }) {
  if (!items || items.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-[var(--border-subtle)]/60 p-2">
          <dt className="text-[10px] uppercase text-[var(--text-muted)]">{item.label}</dt>
          <dd className="text-sm font-medium text-[var(--foreground)]">{item.value ?? 'Not available'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ScoreExplanation({ details, children, showIcon = true }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={
          showIcon
            ? 'inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium text-[var(--foreground)] transition hover:border-[var(--brand)]/50 hover:text-violet-300'
            : 'inline-flex items-center text-left transition hover:opacity-80'
        }
        aria-label={`Explain ${details.title}`}
      >
        {children ?? details.scoreLabel}
        {showIcon && <Info className="h-3 w-3" />}
      </button>
      {open && (
        <div className="fixed inset-0 z-[90] flex">
          <button type="button" className="flex-1 bg-black/45" aria-label="Close score explanation" onClick={() => setOpen(false)} />
          <aside className="h-dvh w-full max-w-xl overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--background)] p-4 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-xl sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Score explanation</p>
                <h3 className="text-lg font-semibold text-[var(--foreground)]">{details.title}</h3>
                <p className="mt-1 text-sm text-violet-300">{details.scoreLabel}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 text-[var(--text-muted)] hover:bg-[var(--surface-2)]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <section>
                <p className="mb-1 text-xs font-semibold uppercase text-[var(--text-muted)]">Formula</p>
                <p className="rounded-md bg-[var(--surface-2)]/50 p-3 font-mono text-xs text-[var(--foreground)]">{details.formula}</p>
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold uppercase text-[var(--text-muted)]">Criteria</p>
                <ul className="space-y-1 text-[var(--foreground)]">
                  {details.criteria.map((criterion) => <li key={criterion}>• {criterion}</li>)}
                </ul>
              </section>

              {details.weights && details.weights.length > 0 && (
                <section>
                  <p className="mb-1 text-xs font-semibold uppercase text-[var(--text-muted)]">Weights</p>
                  <DetailList items={details.weights} />
                </section>
              )}

              <section>
                <p className="mb-1 text-xs font-semibold uppercase text-[var(--text-muted)]">Raw values</p>
                <DetailList items={details.rawValues} />
              </section>

              {details.normalizedValues && details.normalizedValues.length > 0 && (
                <section>
                  <p className="mb-1 text-xs font-semibold uppercase text-[var(--text-muted)]">Normalized values</p>
                  <DetailList items={details.normalizedValues} />
                </section>
              )}

              <section>
                <p className="mb-1 text-xs font-semibold uppercase text-[var(--text-muted)]">Calculation</p>
                <p className="rounded-md border border-[var(--border-subtle)]/60 p-3 text-[var(--foreground)]">{details.calculation}</p>
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold uppercase text-[var(--text-muted)]">Generated reason</p>
                <p className="text-[var(--foreground)]">{details.generatedReason}</p>
              </section>

              <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-[var(--border-subtle)]/60 p-2">
                  <p className="text-[10px] uppercase text-[var(--text-muted)]">Timestamp/history</p>
                  <p className="text-sm text-[var(--foreground)]">{details.timestamp ?? 'Current calculation only; score history table not available yet.'}</p>
                </div>
                <div className="rounded-md border border-[var(--border-subtle)]/60 p-2">
                  <p className="text-[10px] uppercase text-[var(--text-muted)]">Source/method</p>
                  <p className="text-sm text-[var(--foreground)]">{details.source ?? 'Operational tables'} · {details.assignmentMethod ?? 'Computed'}</p>
                </div>
              </section>

              {details.overrideInfo && (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">{details.overrideInfo}</p>
              )}

              <section>
                <p className="mb-1 text-xs font-semibold uppercase text-[var(--text-muted)]">Action suggestion</p>
                <p className="text-[var(--foreground)]">{details.actionSuggestion ?? 'Review evidence before action.'}</p>
              </section>

              <p className="rounded-md border border-violet-500/30 bg-violet-500/10 p-3 text-xs text-violet-200">
                System recommendation supports decision-making; final action remains with the BME Head.
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
