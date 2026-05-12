'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { RefreshCcw, RotateCcw } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, useToast } from '@/components/ui';
import {
  recomputeAllAnalyticsDeveloperAction,
  refreshDecisionSupportSnapshotsAction,
  refreshFmeaRiskScoresAction,
} from '@/actions/developer-lab.actions';

const SCORE_CRITERIA = [
  { key: 'ageScore', label: 'Age' },
  { key: 'failureScore', label: 'Failures' },
  { key: 'availabilityScore', label: 'Availability' },
  { key: 'maintenanceBurdenScore', label: 'Maintenance burden' },
  { key: 'sparePartScore', label: 'Spare support' },
  { key: 'riskScore', label: 'FMEA risk' },
  { key: 'costScore', label: 'Lifecycle cost' },
] as const;

type ScoreKey = typeof SCORE_CRITERIA[number]['key'];

const DEFAULT_WEIGHTS: Record<ScoreKey, number> = {
  ageScore: 15,
  failureScore: 20,
  availabilityScore: 15,
  maintenanceBurdenScore: 15,
  sparePartScore: 10,
  riskScore: 15,
  costScore: 10,
};

export interface LabReplacementRow {
  assetId: string;
  assetCode: string;
  assetName: string;
  departmentName: string;
  rank: number | null;
  priorityIndex: number | null;
  scores: Record<ScoreKey, number | null>;
}

interface Props {
  replacementRows: LabReplacementRow[];
}

function computeRpi(row: LabReplacementRow, weights: Record<ScoreKey, number>) {
  const totalWeight = SCORE_CRITERIA.reduce((sum, criterion) => sum + weights[criterion.key], 0);
  if (totalWeight <= 0) return 0;
  const weighted = SCORE_CRITERIA.reduce((sum, criterion) => {
    const value = row.scores[criterion.key] ?? 0;
    return sum + value * weights[criterion.key];
  }, 0);
  return weighted / totalWeight;
}

function runLabel(delta: number | null) {
  if (delta == null || delta === 0) return 'No movement';
  return delta > 0 ? `Up ${delta}` : `Down ${Math.abs(delta)}`;
}

export default function DeveloperLabClient({ replacementRows }: Props) {
  const { toast } = useToast();
  const [pendingAction, startTransition] = useTransition();
  const [weights, setWeights] = useState<Record<ScoreKey, number>>(DEFAULT_WEIGHTS);
  const [sandboxTab, setSandboxTab] = useState<'rpi' | 'health' | 'readiness' | 'critical' | 'stock'>('rpi');

  const simulated = useMemo(() => {
    return replacementRows
      .map((row) => ({ ...row, simulatedRpi: computeRpi(row, weights), simulatedRank: 0, rankDelta: null as number | null }))
      .sort((a, b) => b.simulatedRpi - a.simulatedRpi)
      .map((row, index) => {
        const simulatedRank = index + 1;
        return {
          ...row,
          simulatedRank,
          rankDelta: row.rank == null ? null : row.rank - simulatedRank,
        };
      });
  }, [replacementRows, weights]);

  const totalWeight = SCORE_CRITERIA.reduce((sum, criterion) => sum + weights[criterion.key], 0);
  const topMovement = simulated
    .filter((row) => row.rankDelta !== 0 && row.rankDelta != null)
    .sort((a, b) => Math.abs(b.rankDelta ?? 0) - Math.abs(a.rankDelta ?? 0))
    .slice(0, 8);
  const stability = topMovement.length === 0
    ? 'Stable: top candidates unchanged'
    : topMovement.some((row) => Math.abs(row.rankDelta ?? 0) >= 5)
      ? 'Sensitive: top candidates changed significantly'
      : 'Moderate movement: some rank order changes';

  function runAction(label: string, action: () => Promise<{ success: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.success) toast('success', `${label} completed`);
      else toast('error', result.error ?? `${label} failed`);
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="items-start">
          <div>
            <CardTitle>Sensitivity Sandbox</CardTitle>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Simulation only. Does not modify operational decisions.
            </p>
          </div>
          <div className="text-right text-xs text-[var(--text-muted)]">
            <p>Total weight</p>
            <p className={totalWeight === 100 ? 'text-lg font-semibold text-emerald-300' : 'text-lg font-semibold text-amber-300'}>
              {totalWeight}%
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {[
              ['rpi', 'RPI weights'],
              ['health', 'Equipment Health weights'],
              ['readiness', 'Department Readiness weights'],
              ['critical', 'Critical Action score weights'],
              ['stock', 'Stock/procurement priority weights'],
            ].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setSandboxTab(id as typeof sandboxTab)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${sandboxTab === id ? 'border-[var(--brand)] bg-[var(--surface-2)] text-[var(--foreground)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--brand)]/50'}`}>
                {label}
              </button>
            ))}
          </div>
          {sandboxTab === 'rpi' ? (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {SCORE_CRITERIA.map((criterion) => (
                  <label key={criterion.key} className="rounded-lg border border-[var(--border-subtle)] p-3">
                    <span className="mb-2 flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-[var(--foreground)]">{criterion.label}</span>
                      <span className="text-[var(--text-muted)]">{weights[criterion.key]}%</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={40}
                      step={1}
                      value={weights[criterion.key]}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setWeights((current) => ({ ...current, [criterion.key]: value }));
                      }}
                      className="w-full accent-[var(--brand)]"
                      aria-label={`${criterion.label} simulated weight`}
                    />
                  </label>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => setWeights(DEFAULT_WEIGHTS)}>
                <RotateCcw className="h-4 w-4" />
                Reset Sandbox
              </Button>
            </>
          ) : (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 text-sm text-[var(--text-muted)]">
              Simulation limited by available fields. This tab documents the scoring family and reserves the interface for client-side ranking once its full row inputs are loaded.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ranking Comparison</CardTitle>
          <Badge variant={stability.startsWith('Sensitive') ? 'warning' : stability.startsWith('Stable') ? 'success' : 'info'}>{stability}</Badge>
        </CardHeader>
        <CardContent>
          {topMovement.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-[var(--text-muted)]">Current seed data is stable under these weights. The top five remain unchanged, but simulated RPI still recalculates from the slider values.</p>
              <div className="grid gap-2 md:grid-cols-5">
                {simulated.slice(0, 5).map((row) => (
                  <Link key={row.assetId} href={`/command/drilldown/replacement/${row.assetId}`} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 hover:border-[var(--brand)]/50">
                    <p className="text-xs text-[var(--text-muted)]">#{row.simulatedRank}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-[var(--foreground)]">{row.assetCode}</p>
                    <p className="truncate text-xs text-[var(--text-muted)]">{row.assetName}</p>
                    <p className="mt-2 text-xs font-medium text-[var(--brand)]">RPI {row.simulatedRpi.toFixed(3)}</p>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-[var(--text-muted)]">
                  <tr>
                    <th className="py-2 pr-4">Asset</th>
                    <th className="py-2 pr-4">Current</th>
                    <th className="py-2 pr-4">Simulated</th>
                    <th className="py-2 pr-4">Movement</th>
                    <th className="py-2 pr-4">Simulated RPI</th>
                    <th className="py-2">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {topMovement.map((row) => (
                    <tr key={row.assetId}>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-[var(--foreground)]">{row.assetCode} - {row.assetName}</p>
                        <p className="text-xs text-[var(--text-muted)]">{row.departmentName}</p>
                      </td>
                      <td className="py-3 pr-4">#{row.rank ?? '-'}</td>
                      <td className="py-3 pr-4">#{row.simulatedRank}</td>
                      <td className="py-3 pr-4">{runLabel(row.rankDelta)}</td>
                      <td className="py-3 pr-4">{row.simulatedRpi.toFixed(3)}</td>
                      <td className="py-3">
                        <Link className="text-xs text-[var(--brand)] hover:underline" href={`/command/drilldown/replacement/${row.assetId}`}>
                          Open evidence
                        </Link>
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
        <CardHeader className="items-start">
          <div>
            <CardTitle>Snapshot / Refresh Tools</CardTitle>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              These buttons run real refresh actions and write audit evidence. Use them deliberately during demo or validation.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              loading={pendingAction}
              onClick={() => runAction('FMEA risk refresh', refreshFmeaRiskScoresAction)}
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh FMEA Risk Scores
            </Button>
            <Button
              variant="outline"
              loading={pendingAction}
              onClick={() => runAction('Decision-support snapshot refresh', refreshDecisionSupportSnapshotsAction)}
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh Decision Snapshots
            </Button>
            <Button
              variant="outline"
              loading={pendingAction}
              onClick={() => runAction('Full analytics recompute', recomputeAllAnalyticsDeveloperAction)}
            >
              <RefreshCcw className="h-4 w-4" />
              Recompute Analytics
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
