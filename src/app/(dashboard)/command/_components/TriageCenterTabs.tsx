'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Eye, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui';
import { ScoreExplanation } from './ScoreExplanation';
import { acknowledgeCommandCenterItem, snoozeCommandCenterItem } from '@/actions/command.actions';
import { equipmentDetail, replacementEvidence, replacementReportPrefill } from '../_lib/command-center-routes';
import type {
  CalibrationTriageItem,
  CorrectiveMaintenanceItem,
  InstallationTriageItem,
  NeedsRequestItem,
  PMTriageItem,
  ProactiveRiskItem,
  ProcurementTriageItem,
  ReplacementTriageRow,
  ScoreExplanation as ScoreExplanationData,
  StockBlockerItem,
  TrainingTriageItem,
} from '../_lib/command-center-data';

// ─── Tab registry ──────────────────────────────────────────────────────────────

type TabKey =
  | 'corrective'
  | 'needsRequest'
  | 'proactiveRisk'
  | 'calibration'
  | 'pm'
  | 'stock'
  | 'installation'
  | 'replacement'
  | 'procurement'
  | 'training';

interface TabDef {
  key: TabKey;
  label: string;
  count: number;
  total: number;
  urgency?: boolean;
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

function UrgencyBadge({ urgency }: { urgency: string }) {
  const cls =
    urgency === 'critical' ? 'bg-rose-500/20 text-rose-300'
    : urgency === 'high' ? 'bg-amber-500/20 text-amber-300'
    : 'bg-slate-500/20 text-slate-300';
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>{urgency}</span>;
}

function ScoreBadge({ score, details }: { score: number; details?: ScoreExplanationData }) {
  const variant = score >= 130 ? 'error' : score >= 100 ? 'warning' : 'info';
  const badge = <Badge variant={variant}>{Math.round(score)}</Badge>;
  if (!details) return badge;
  return <ScoreExplanation details={details}>{badge}</ScoreExplanation>;
}

function EmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <CheckCircle2 className="h-7 w-7 text-emerald-400" />
      <p className="text-sm text-[var(--text-muted)]">{message}</p>
      {sub && <p className="text-xs text-[var(--text-muted)]/70">{sub}</p>}
    </div>
  );
}

function ActionLink({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  if (primary) {
    return (
      <Link
        href={href}
        className="rounded-md bg-[var(--brand)] px-2.5 py-1 text-xs font-medium text-white transition hover:opacity-90"
      >
        {label}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition hover:border-[var(--brand)]/50 hover:text-[var(--foreground)]"
    >
      {label}
    </Link>
  );
}

function AcknowledgeRiskButton({ item }: { item: ProactiveRiskItem }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return <span className="text-xs text-emerald-300">Acknowledged</span>;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const result = await acknowledgeCommandCenterItem({
          item_type: 'risk_watch',
          item_key: item.assetId,
          asset_id: item.assetId,
          signal_hash: item.signalHash,
          reason: item.reason,
        });
        setPending(false);
        if (result.success) setDone(true);
      }}
      className="rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition hover:border-[var(--brand)]/50 hover:text-[var(--foreground)] disabled:opacity-60"
    >
      {pending ? 'Acknowledging...' : 'Acknowledge'}
    </button>
  );
}

function SnoozeRiskButton({ item }: { item: ProactiveRiskItem }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return <span className="text-xs text-amber-300">Snoozed 7d</span>;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const result = await snoozeCommandCenterItem({
          item_type: 'risk_watch',
          item_key: item.assetId,
          asset_id: item.assetId,
          signal_hash: item.signalHash,
          reason: item.reason,
          days: 7,
        });
        setPending(false);
        if (result.success) setDone(true);
      }}
      className="rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition hover:border-amber-400/50 hover:text-[var(--foreground)] disabled:opacity-60"
    >
      {pending ? 'Snoozing...' : 'Snooze 7 days'}
    </button>
  );
}

function scoreDetails(params: {
  title: string;
  score: number;
  formula: string;
  criteria: string[];
  rawValues: Array<{ label: string; value: string | number | null }>;
  calculation: string;
  reason: string;
  source?: string;
  weights?: Array<{ label: string; value: string }>;
  normalizedValues?: Array<{ label: string; value: string | number | null }>;
  actionSuggestion?: string;
}): ScoreExplanationData {
  return {
    title: params.title,
    scoreLabel: `${Math.round(params.score)}`,
    formula: params.formula,
    criteria: params.criteria,
    weights: params.weights,
    rawValues: params.rawValues,
    normalizedValues: params.normalizedValues,
    calculation: params.calculation,
    generatedReason: params.reason,
    source: params.source ?? 'Command Center triage fetchers',
    assignmentMethod: 'Computed from operational data',
    actionSuggestion: params.actionSuggestion,
  };
}

// ─── Corrective Maintenance tab ────────────────────────────────────────────────

function CorrectiveList({
  rows,
  total,
  canMutate,
}: {
  rows: CorrectiveMaintenanceItem[];
  total: number;
  canMutate: boolean;
}) {
  if (rows.length === 0)
    return (
      <EmptyState
        message="No open corrective maintenance work"
        sub="Non-functional assets without requests are shown under Needs Request."
      />
    );

  return (
    <div>
      <ul className="divide-y divide-[var(--border-subtle)]/60">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={equipmentDetail(row.assetId)}
                  className="font-medium text-[var(--foreground)] hover:text-violet-300"
                >
                  {row.assetName}
                </Link>
                <span className="text-xs text-[var(--text-muted)]">{row.assetCode}</span>
                <UrgencyBadge urgency={row.urgency} />
                <Badge variant="info">{row.sourceType === 'work_order' ? 'Work Order' : 'Request'}</Badge>
                {row.assignedToName && (
                  <span className="text-xs text-[var(--text-muted)]">→ {row.assignedToName}</span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {row.departmentName}
                {row.daysOpen > 0 ? ` · Open ${row.daysOpen}d` : ''}
                {' · '}
                {row.reason}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ScoreBadge
                score={row.score}
                details={scoreDetails({
                  title: `Corrective priority — ${row.assetName}`,
                  score: row.score,
                  formula: 'urgency score + work status score + age adjustment',
                  criteria: ['Urgency/priority', 'Open work status', 'Days open'],
                  rawValues: [
                    { label: 'Urgency', value: row.urgency },
                    { label: 'Status', value: row.status },
                    { label: 'Days open', value: row.daysOpen },
                  ],
                  calculation: `Computed item score = ${Math.round(row.score)}`,
                  reason: row.reason,
                  actionSuggestion: 'Open work order, assign technician, or review maintenance history.',
                })}
              />
              {canMutate && (
                <ActionLink
                  href={row.primaryActionHref}
                  label={row.primaryActionLabel}
                  primary
                />
              )}
              {row.secondaryActionHref && <ActionLink href={row.secondaryActionHref} label={row.secondaryActionLabel ?? 'Details'} />}
            </div>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <div className="mt-3 text-right">
          <Link href="/command/drilldown/open-work-orders" className="text-xs text-violet-300 hover:text-violet-200">
            View all {total} corrective items →
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Needs Request tab ────────────────────────────────────────────────────────

function NeedsRequestList({
  rows,
  total,
  canMutate,
}: {
  rows: NeedsRequestItem[];
  total: number;
  canMutate: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        message="No assets currently need a corrective request"
        sub="Non-functional, needs-repair, or under-maintenance assets without open corrective work appear here"
      />
    );
  }

  return (
    <div>
      <ul className="divide-y divide-[var(--border-subtle)]/60">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={equipmentDetail(row.assetId)} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                  {row.assetName}
                </Link>
                <span className="text-xs text-[var(--text-muted)]">{row.assetCode}</span>
                <Badge variant="warning">{row.condition.replace(/_/g, ' ')}</Badge>
                {row.riskLevel && <Badge variant={row.riskLevel === 'critical' ? 'error' : 'warning'}>{row.riskLevel} risk</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {row.departmentName}{row.rpn != null ? ` · RPN ${row.rpn}` : ''}{row.healthScore != null ? ` · Health ${row.healthScore}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]/80">{row.reason}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ScoreBadge
                score={row.score}
                details={scoreDetails({
                  title: `Needs request score — ${row.assetName}`,
                  score: row.score,
                  formula: '90 base + condition severity + department criticality + risk + health penalty',
                  criteria: ['Current condition problem', 'No open corrective request/work order', 'Department/category criticality', 'RPN/health if available'],
                  rawValues: [
                    { label: 'Condition', value: row.condition.replace(/_/g, ' ') },
                    { label: 'Criticality', value: row.departmentCriticality ?? 'Not set' },
                    { label: 'RPN', value: row.rpn },
                    { label: 'Health score', value: row.healthScore },
                  ],
                  calculation: `90 base + condition/risk adjustments = ${Math.round(row.score)}`,
                  reason: row.reason,
                  actionSuggestion: 'Create a corrective maintenance request, then assign work if approved.',
                })}
              />
              {canMutate && <ActionLink href={row.createRequestHref} label="Create Request" primary />}
              <ActionLink href={equipmentDetail(row.assetId)} label={canMutate ? 'View Risk' : 'Details'} />
              <ActionLink href={equipmentDetail(row.assetId)} label={canMutate ? 'View Equipment' : 'View'} />
            </div>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <div className="mt-3 text-right">
          <Link href="/command/drilldown/non-functional" className="text-xs text-violet-300 hover:text-violet-200">
            View all {total} assets needing requests →
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Proactive Risk Watch tab ──────────────────────────────────────────────────

function ProactiveRiskList({
  rows,
  total,
  canMutate,
}: {
  rows: ProactiveRiskItem[];
  total: number;
  canMutate: boolean;
}) {
  if (rows.length === 0)
    return (
      <EmptyState
        message="No proactive risk signals detected"
        sub="Assets with warning flags, high RPN, or poor PM compliance appear here"
      />
    );

  return (
    <div>
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          These assets have <strong>no open corrective request</strong> but show risk signals. Consider creating a
          request, scheduling PM, or reviewing risk.
        </span>
      </div>
      <ul className="divide-y divide-[var(--border-subtle)]/60">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={equipmentDetail(row.assetId)}
                  className="font-medium text-[var(--foreground)] hover:text-violet-300"
                >
                  {row.assetName}
                </Link>
                <span className="text-xs text-[var(--text-muted)]">{row.assetCode}</span>
                {row.riskLevel && (
                  <Badge
                    variant={
                      row.riskLevel === 'critical' ? 'error' : row.riskLevel === 'high' ? 'warning' : 'info'
                    }
                  >
                    {row.riskLevel} risk
                  </Badge>
                )}
                {row.condition !== 'functional' && (
                  <Badge variant="warning">{row.condition.replace(/_/g, ' ')}</Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {row.departmentName}
                {row.rpn ? ` · RPN ${row.rpn}` : ''}
                {row.flags.length > 0 ? ` · Flags: ${row.flags.map((f) => f.replace(/_/g, ' ')).join(', ')}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]/80">{row.reason}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ScoreBadge
                score={row.score}
                details={scoreDetails({
                  title: `Risk watch score — ${row.assetName}`,
                  score: row.score,
                  formula: 'risk level contribution + active recommendation flag contribution',
                  criteria: ['High/critical RPN', 'Active recommendation flags', 'No open corrective work', 'Functional/active condition'],
                  rawValues: [
                    { label: 'RPN', value: row.rpn },
                    { label: 'Risk level', value: row.riskLevel },
                    { label: 'Flags', value: row.flags.length ? row.flags.join(', ') : 'None' },
                    { label: 'Condition', value: row.condition },
                  ],
                  calculation: `Computed risk watch score = ${Math.round(row.score)}`,
                  reason: row.reason,
                  actionSuggestion: 'Review risk, schedule PM/calibration, or create a request if condition worsens.',
                })}
              />
              <ActionLink href={equipmentDetail(row.assetId)} label="Review Risk" primary={canMutate} />
              {canMutate && <AcknowledgeRiskButton item={row} />}
              {canMutate && <SnoozeRiskButton item={row} />}
            </div>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <div className="mt-3 text-right">
          <Link href="/alerts" className="text-xs text-violet-300 hover:text-violet-200">
            View all {total} risk signals →
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Calibration tab ──────────────────────────────────────────────────────────

function CalibrationList({ rows, total, canMutate }: { rows: CalibrationTriageItem[]; total: number; canMutate: boolean }) {
  if (rows.length === 0) return <EmptyState message="No calibration items due or overdue" />;
  return (
    <div>
      <ul className="divide-y divide-[var(--border-subtle)]/60">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={equipmentDetail(row.assetId)} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                  {row.assetName}
                </Link>
                <span className="text-xs text-[var(--text-muted)]">{row.assetCode}</span>
                {row.lastResult === 'fail' && <Badge variant="error">Last: Fail</Badge>}
                {row.lastResult === 'adjusted' && <Badge variant="warning">Last: Adjusted</Badge>}
                {row.daysOverdue > 0 && <Badge variant={row.daysOverdue > 90 ? 'error' : 'warning'}>{row.daysOverdue}d overdue</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{row.departmentName} · {row.reason}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ScoreBadge score={row.score} details={scoreDetails({
                title: `Calibration priority — ${row.assetName}`,
                score: row.score,
                formula: '50 base + min(50, days overdue × 0.5)',
                criteria: ['Due date', 'Days overdue', 'Last result if available'],
                rawValues: [{ label: 'Next due date', value: row.nextDueDate }, { label: 'Days overdue', value: row.daysOverdue }, { label: 'Last result', value: row.lastResult }],
                calculation: `50 + min(50, ${row.daysOverdue} × 0.5) = ${Math.round(row.score)}`,
                reason: row.reason,
                actionSuggestion: 'Schedule calibration or record the latest result.',
              })} />
              {canMutate && <ActionLink href={row.scheduleHref} label="Schedule Calibration" primary />}
              {canMutate && <ActionLink href={row.recordHref} label="Record Result" />}
              <ActionLink href={row.detailHref} label="View Asset" />
            </div>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <div className="mt-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>Showing top {rows.length} of {total} calibration items.</span>
          <Link href="/command/drilldown/calibration" className="text-xs text-violet-300 hover:text-violet-200">View all {total} calibration items →</Link>
        </div>
      )}
    </div>
  );
}

// ─── PM tab ───────────────────────────────────────────────────────────────────

function PMList({ rows, total, canMutate }: { rows: PMTriageItem[]; total: number; canMutate: boolean }) {
  if (rows.length === 0) return <EmptyState message="No overdue preventive maintenance items" />;
  return (
    <div>
      <ul className="divide-y divide-[var(--border-subtle)]/60">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={equipmentDetail(row.assetId)} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                  {row.assetName}
                </Link>
                <span className="text-xs text-[var(--text-muted)]">{row.assetCode}</span>
                {row.daysOverdue > 30 && <Badge variant="error">{row.daysOverdue}d overdue</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{row.departmentName} · {row.reason}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ScoreBadge score={row.score} details={scoreDetails({
                title: `PM priority — ${row.assetName}`,
                score: row.score,
                formula: '50 base + min(50, days overdue × 0.3)',
                criteria: ['Scheduled date', 'Days overdue', 'Equipment context'],
                rawValues: [{ label: 'Scheduled date', value: row.scheduledDate }, { label: 'Days overdue', value: row.daysOverdue }],
                calculation: `50 + min(50, ${row.daysOverdue} × 0.3) = ${Math.round(row.score)}`,
                reason: row.reason,
                actionSuggestion: 'Schedule PM, assign PM, or review checklist.',
              })} />
              {canMutate && <ActionLink href={row.detailHref} label="Schedule PM" primary />}
              {canMutate && <ActionLink href={row.assignHref} label="Assign PM" />}
              <ActionLink href={row.checklistHref} label="View Checklist" />
            </div>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <div className="mt-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>Showing top {rows.length} of {total} PM items.</span>
          <Link href="/command/drilldown/overdue-pm" className="text-xs text-violet-300 hover:text-violet-200">View all {total} PM items →</Link>
        </div>
      )}
    </div>
  );
}

// ─── Stock blockers tab ───────────────────────────────────────────────────────

function StockList({ rows, total, canMutate }: { rows: StockBlockerItem[]; total: number; canMutate: boolean }) {
  if (rows.length === 0) return <EmptyState message="All spare parts are adequately stocked" />;
  return (
    <div>
      <ul className="divide-y divide-[var(--border-subtle)]/60">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-[var(--foreground)]">{row.partName}</p>
                <span className="text-xs text-[var(--text-muted)]">{row.partCode}</span>
                {row.currentStock === 0 && <Badge variant="error">Out of stock</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Stock: {row.currentStock} · Reorder at: {row.reorderLevel} · {row.reason}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ScoreBadge score={row.score} details={scoreDetails({
                title: `Stock blocker score — ${row.partName}`,
                score: row.score,
                formula: '100 if out of stock, else 60 + ((reorder level - current stock) ÷ reorder level) × 40',
                criteria: ['Current stock', 'Reorder level', 'Stockout severity'],
                rawValues: [{ label: 'Current stock', value: row.currentStock }, { label: 'Reorder level', value: row.reorderLevel }],
                calculation: row.currentStock === 0 ? 'Out of stock = 100' : `60 + ((${row.reorderLevel} - ${row.currentStock}) ÷ ${row.reorderLevel}) × 40 = ${Math.round(row.score)}`,
                reason: row.reason,
                actionSuggestion: 'Request procurement, view part, or issue stock if available.',
              })} />
              {canMutate && <ActionLink href={row.procurementHref} label="Request Procurement" primary />}
              {row.issueStockHref && canMutate && <ActionLink href={row.issueStockHref} label="Issue Stock" />}
              <ActionLink href={row.detailHref} label="Details" />
            </div>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <div className="mt-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>Showing top {rows.length} of {total} stock items.</span>
          <Link href="/command/drilldown/stock-blockers" className="text-xs text-violet-300 hover:text-violet-200">View all {total} stock items →</Link>
        </div>
      )}
    </div>
  );
}

// ─── Installation tab ─────────────────────────────────────────────────────────

function InstallationList({ rows, total, canMutate }: { rows: InstallationTriageItem[]; total: number; canMutate: boolean }) {
  if (rows.length === 0) return <EmptyState message="No pending installation or commissioning items" />;
  return (
    <div>
      <ul className="divide-y divide-[var(--border-subtle)]/60">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={equipmentDetail(row.assetId)} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                  {row.assetName}
                </Link>
                <span className="text-xs text-[var(--text-muted)]">{row.assetCode}</span>
                <Badge variant="info">{row.status.replace(/_/g, ' ')}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{row.departmentName} · {row.reason}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ScoreBadge score={row.score} details={scoreDetails({
                title: `Installation priority — ${row.assetName}`,
                score: row.score,
                formula: '40 base + min(40, days pending × 0.5)',
                criteria: ['Pending commissioning status', 'Days pending', 'Department context'],
                rawValues: [{ label: 'Status', value: row.status }, { label: 'Days pending', value: row.daysPending }],
                calculation: `40 + min(40, ${row.daysPending} × 0.5) = ${Math.round(row.score)}`,
                reason: row.reason,
                actionSuggestion: 'Schedule installation, commission, or view asset.',
              })} />
              {canMutate && <ActionLink href={row.scheduleHref} label="Schedule Installation" primary />}
              {canMutate && <ActionLink href={row.commissionHref} label="Commission" />}
              <ActionLink href={row.assetHref} label="View Asset" />
            </div>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <div className="mt-3 text-right">
          <Link href="/command/drilldown/installation" className="text-xs text-violet-300 hover:text-violet-200">View all {total} installation items →</Link>
        </div>
      )}
    </div>
  );
}

// ─── Replacement tab ──────────────────────────────────────────────────────────

function ReplacementList({ rows, total, canMutate }: { rows: ReplacementTriageRow[]; total: number; canMutate: boolean }) {
  if (rows.length === 0) return <EmptyState message="No replacement candidates identified" />;
  return (
    <div>
      <ul className="divide-y divide-[var(--border-subtle)]/60">
        {rows.map((row) => (
          <li key={row.asset_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-300">
                  {row.rank}
                </span>
                <Link href={equipmentDetail(row.asset_id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                  {row.asset_name}
                </Link>
                <span className="text-xs text-[var(--text-muted)]">{row.asset_code}</span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{row.department_name} · {row.reason}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ScoreExplanation details={{
                title: `Replacement Priority Index — ${row.asset_name}`,
                scoreLabel: `RPI ${Math.round(row.priority_index * 100)}/100`,
                formula: 'weighted sum of normalized criteria × 100',
                criteria: ['Availability', 'Age', 'Failure rate', 'Maintenance burden', 'Risk/RPN', 'Spare parts', 'Cost'],
                weights: [
                  { label: 'Availability', value: '20%' },
                  { label: 'Age', value: '15%' },
                  { label: 'Failure rate', value: '15%' },
                  { label: 'Maintenance burden', value: '15%' },
                  { label: 'Risk/RPN', value: '15%' },
                  { label: 'Spare parts', value: '10%' },
                  { label: 'Cost', value: '10%' },
                ],
                rawValues: [{ label: 'Rank', value: row.rank }],
                normalizedValues: [
                  { label: 'Availability score', value: row.availability_score },
                  { label: 'Age score', value: row.age_score },
                  { label: 'Failure score', value: row.failure_score },
                  { label: 'Maintenance burden', value: row.maintenance_burden_score },
                  { label: 'Risk score', value: row.risk_score },
                  { label: 'Spare part score', value: row.spare_part_score },
                  { label: 'Cost score', value: row.cost_score },
                ],
                calculation: `RPI = ${Math.round(row.priority_index * 100)}/100`,
                generatedReason: row.reason,
                source: 'v_replacement_decision / replacement_priority_scores',
                assignmentMethod: 'Computed; no manual override shown',
                actionSuggestion: 'Review replacement evidence and include in report if justified.',
              }}>
                <Badge variant="warning">RPI {Math.round(row.priority_index * 100)}/100</Badge>
              </ScoreExplanation>
              <ActionLink href={replacementEvidence(row.asset_id)} label="View Evidence" primary={canMutate} />
              {canMutate && <ActionLink href={replacementReportPrefill(row.asset_id, { reason: row.reason, rank: row.rank, rpi: row.priority_index <= 1 ? row.priority_index * 100 : row.priority_index })} label="Add to Report" />}
            </div>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <div className="mt-3 text-right">
          <Link href="/command/drilldown/replacement" className="text-xs text-violet-300 hover:text-violet-200">View all {total} replacement candidates →</Link>
        </div>
      )}
    </div>
  );
}

// ─── Procurement tab ──────────────────────────────────────────────────────────

function ProcurementList({ rows, total, canMutate }: { rows: ProcurementTriageItem[]; total: number; canMutate: boolean }) {
  if (rows.length === 0) return <EmptyState message="No pending procurement requests" />;
  return (
    <div>
      <ul className="divide-y divide-[var(--border-subtle)]/60">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-[var(--foreground)]">{row.requestNumber}</p>
                <Badge variant="info">{row.status.replace(/_/g, ' ')}</Badge>
                {row.daysDelayed > 0 && <Badge variant="warning">{row.daysDelayed}d delayed</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{row.description} · {row.reason}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ScoreBadge score={row.score} details={scoreDetails({
                title: `Procurement priority — ${row.requestNumber}`,
                score: row.score,
                formula: '45 base + min(45, days delayed × 0.5)',
                criteria: ['Request status', 'Days delayed', 'Priority where available'],
                rawValues: [{ label: 'Status', value: row.status }, { label: 'Days delayed', value: row.daysDelayed }],
                calculation: `45 + min(45, ${row.daysDelayed} × 0.5) = ${Math.round(row.score)}`,
                reason: row.reason,
                actionSuggestion: 'Update status, escalate, or view request.',
              })} />
              {canMutate && <ActionLink href={row.updateHref} label="Update Status" primary />}
              {canMutate && <ActionLink href={row.escalateHref} label="Escalate" />}
              <ActionLink href={row.detailHref} label="View Request" />
            </div>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <div className="mt-3 text-right">
          <Link href="/command/drilldown/procurement" className="text-xs text-violet-300 hover:text-violet-200">View all {total} procurement items →</Link>
        </div>
      )}
    </div>
  );
}

// ─── Training tab ─────────────────────────────────────────────────────────────

function TrainingList({ rows, total, canMutate }: { rows: TrainingTriageItem[]; total: number; canMutate: boolean }) {
  if (rows.length === 0) return <EmptyState message="No pending training requests" />;
  return (
    <div>
      <ul className="divide-y divide-[var(--border-subtle)]/60">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-[var(--foreground)]">{row.assetName}</p>
                <Badge variant="info">{row.status.replace(/_/g, ' ')}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{row.departmentName} · {row.reason}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ScoreBadge score={row.score} details={scoreDetails({
                title: `Training priority — ${row.assetName}`,
                score: row.score,
                formula: '35 base + min(35, days pending × 0.3)',
                criteria: ['Request status', 'Days pending', 'Department context'],
                rawValues: [{ label: 'Status', value: row.status }, { label: 'Days pending', value: row.daysPending }],
                calculation: `35 + min(35, ${row.daysPending} × 0.3) = ${Math.round(row.score)}`,
                reason: row.reason,
                actionSuggestion: 'Schedule training, assign trainer, or mark complete.',
              })} />
              {canMutate && <ActionLink href="/training" label="Schedule Training" primary />}
              {canMutate && <ActionLink href="/training" label="Assign Trainer" />}
              {canMutate && <ActionLink href="/training" label="Mark Complete" />}
              {!canMutate && <ActionLink href="/training" label="Details" />}
            </div>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <div className="mt-3 text-right">
          <Link href="/training" className="text-xs text-violet-300 hover:text-violet-200">View all {total} training requests →</Link>
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface Props {
  corrective: { rows: CorrectiveMaintenanceItem[]; total: number };
  needsRequest: { rows: NeedsRequestItem[]; total: number };
  proactiveRisk: { rows: ProactiveRiskItem[]; total: number };
  calibration: { rows: CalibrationTriageItem[]; total: number };
  pm: { rows: PMTriageItem[]; total: number };
  stockBlockers: { rows: StockBlockerItem[]; total: number };
  installation: { rows: InstallationTriageItem[]; total: number };
  replacement: { rows: ReplacementTriageRow[]; total: number };
  procurement: { rows: ProcurementTriageItem[]; total: number };
  training: { rows: TrainingTriageItem[]; total: number };
  canMutate: boolean;
  primaryRole: string;
}

export function TriageCenterTabs({
  corrective,
  needsRequest,
  proactiveRisk,
  calibration,
  pm,
  stockBlockers,
  installation,
  replacement,
  procurement,
  training,
  canMutate,
  primaryRole,
}: Props) {
  const isStoreUser = primaryRole === 'store_user';
  const hideTrainingForBmeControlRoom = ['developer', 'admin', 'bme_head'].includes(primaryRole);

  const tabs: TabDef[] = [
    ...(!isStoreUser ? [{ key: 'corrective' as TabKey, label: 'Corrective', count: corrective.rows.length, total: corrective.total, urgency: corrective.total > 0 }] : []),
    ...(!isStoreUser ? [{ key: 'needsRequest' as TabKey, label: 'Needs Request', count: needsRequest.rows.length, total: needsRequest.total, urgency: needsRequest.total > 0 }] : []),
    ...(!isStoreUser ? [{ key: 'proactiveRisk' as TabKey, label: 'Risk Watch', count: proactiveRisk.rows.length, total: proactiveRisk.total }] : []),
    { key: 'calibration' as TabKey, label: 'Calibration', count: calibration.rows.length, total: calibration.total },
    ...(!isStoreUser ? [{ key: 'pm' as TabKey, label: 'PM', count: pm.rows.length, total: pm.total }] : []),
    { key: 'stock' as TabKey, label: 'Stock', count: stockBlockers.rows.length, total: stockBlockers.total },
    ...(!isStoreUser ? [{ key: 'installation' as TabKey, label: 'Installation', count: installation.rows.length, total: installation.total }] : []),
    ...(!isStoreUser ? [{ key: 'replacement' as TabKey, label: 'Replacement', count: replacement.rows.length, total: replacement.total }] : []),
    { key: 'procurement' as TabKey, label: 'Procurement', count: procurement.rows.length, total: procurement.total },
    // TODO: Training triage will be enabled for Department Head workflow later.
    ...(!isStoreUser && !hideTrainingForBmeControlRoom ? [{ key: 'training' as TabKey, label: 'Training', count: training.rows.length, total: training.total }] : []),
  ];

  const defaultTab: TabKey = isStoreUser ? 'stock' : corrective.total > 0 ? 'corrective' : needsRequest.total > 0 ? 'needsRequest' : proactiveRisk.total > 0 ? 'proactiveRisk' : 'calibration';
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);

  return (
    <div className="panel-surface rounded-lg">
      {/* Tab bar */}
      <div className="border-b border-[var(--border-subtle)]/60 px-4">
        <nav className="-mb-px flex gap-1 overflow-x-auto" role="tablist">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            const hasItems = tab.total > 0;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.key)}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-[var(--brand)] text-[var(--brand)]'
                    : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-subtle)] hover:text-[var(--foreground)]'
                }`}
              >
                {tab.key === 'proactiveRisk' && <ShieldAlert className="h-3.5 w-3.5" />}
                {tab.key === 'needsRequest' && <AlertCircle className="h-3.5 w-3.5 text-amber-400" />}
                {tab.key === 'corrective' && tab.urgency && <AlertCircle className="h-3.5 w-3.5 text-rose-400" />}
                {tab.label}
                {hasItems && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                      isActive
                        ? 'bg-[var(--brand)]/20 text-[var(--brand)]'
                        : tab.urgency
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                    }`}
                  >
                    {tab.total}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <div className="px-5 py-4">
        {activeTab === 'corrective' && (
          <CorrectiveList rows={corrective.rows} total={corrective.total} canMutate={canMutate} />
        )}
        {activeTab === 'needsRequest' && (
          <NeedsRequestList rows={needsRequest.rows} total={needsRequest.total} canMutate={canMutate} />
        )}
        {activeTab === 'proactiveRisk' && (
          <ProactiveRiskList rows={proactiveRisk.rows} total={proactiveRisk.total} canMutate={canMutate} />
        )}
        {activeTab === 'calibration' && (
          <CalibrationList rows={calibration.rows} total={calibration.total} canMutate={canMutate} />
        )}
        {activeTab === 'pm' && <PMList rows={pm.rows} total={pm.total} canMutate={canMutate} />}
        {activeTab === 'stock' && <StockList rows={stockBlockers.rows} total={stockBlockers.total} canMutate={canMutate} />}
        {activeTab === 'installation' && (
          <InstallationList rows={installation.rows} total={installation.total} canMutate={canMutate} />
        )}
        {activeTab === 'replacement' && (
          <ReplacementList rows={replacement.rows} total={replacement.total} canMutate={canMutate} />
        )}
        {activeTab === 'procurement' && (
          <ProcurementList rows={procurement.rows} total={procurement.total} canMutate={canMutate} />
        )}
        {activeTab === 'training' && (
          <TrainingList rows={training.rows} total={training.total} canMutate={canMutate} />
        )}
        {/* Viewer-only note */}
        {!canMutate && (
          <p className="mt-3 text-right text-xs text-[var(--text-muted)]/60">
            <Eye className="inline h-3 w-3" /> Read-only view
          </p>
        )}
      </div>
    </div>
  );
}
