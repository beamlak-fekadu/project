'use client';

import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Package,
  RefreshCw,
  Stethoscope,
  TrendingDown,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { EquipmentSummary } from '../_lib/command-center-data';

interface WorkInProgress {
  open_work_orders: number;
  overdue_pm: number;
  calibration_due_30d: number;
}

interface Props {
  summary: EquipmentSummary;
  wip: WorkInProgress;
  criticalActionCount: number;
  replacementCandidates: number;
  canMutate: boolean;
}

interface CardData {
  label: string;
  value: number;
  sublabel: string;
  action: string;
  href: string;
  icon: React.ReactNode;
  colorClass: string;
  iconBg: string;
  urgency?: 'critical' | 'warning' | 'normal';
}

function SummaryCard({ card, canMutate }: { card: CardData; canMutate: boolean }) {
  const borderColor =
    card.urgency === 'critical'
      ? 'border-rose-500/40 hover:border-rose-500/70'
      : card.urgency === 'warning'
        ? 'border-amber-500/40 hover:border-amber-500/70'
        : 'hover:border-[var(--brand)]/50';

  return (
    <Link
      href={card.href}
      className={`panel-surface group flex flex-col gap-3 rounded-lg border p-5 transition-all ${borderColor}`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--text-muted)]">{card.label}</p>
          <p
            className={`mt-1 text-3xl font-bold tabular-nums ${
              card.urgency === 'critical'
                ? 'text-rose-300'
                : card.urgency === 'warning'
                  ? 'text-amber-300'
                  : 'text-[var(--foreground)]'
            }`}
          >
            {card.value}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{card.sublabel}</p>
        </div>
        <div className={`shrink-0 rounded-lg p-3 ${card.iconBg}`}>{card.icon}</div>
      </div>
      {(canMutate || card.urgency !== 'critical') && (
        <p className="text-xs font-medium text-violet-300 opacity-0 transition-opacity group-hover:opacity-100">
          {card.action} →
        </p>
      )}
    </Link>
  );
}

export function SummaryActionCards({ summary, wip, criticalActionCount, replacementCandidates, canMutate }: Props) {
  const totalNonFunctional = summary.nonFunctional + summary.needsRepair + summary.underMaintenance;

  const cards: CardData[] = [
    {
      label: 'Total Equipment',
      value: summary.total,
      sublabel: 'Active tracked assets across all departments',
      action: 'View inventory breakdown',
      href: '/command/drilldown/total-equipment',
      icon: <Stethoscope className="h-5 w-5" />,
      colorClass: '',
      iconBg: 'bg-blue-500/15 text-blue-300',
    },
    {
      label: 'Functional',
      value: summary.functional,
      sublabel: `${summary.total > 0 ? Math.round((summary.functional / summary.total) * 100) : 0}% of fleet operational`,
      action: 'View operational assets',
      href: '/command/drilldown/functional',
      icon: <CheckCircle2 className="h-5 w-5" />,
      colorClass: '',
      iconBg: 'bg-emerald-500/15 text-emerald-300',
    },
    {
      label: 'Non-Functional',
      value: totalNonFunctional,
      sublabel: `${summary.nonFunctional} down · ${summary.needsRepair} needs repair · ${summary.underMaintenance} under maint.`,
      action: 'Review affected assets',
      href: '/command/drilldown/non-functional',
      icon: <XCircle className="h-5 w-5" />,
      colorClass: '',
      iconBg: 'bg-rose-500/15 text-rose-300',
      urgency: totalNonFunctional > 5 ? 'critical' : totalNonFunctional > 2 ? 'warning' : 'normal',
    },
    {
      label: 'Open Work Orders',
      value: wip.open_work_orders,
      sublabel: 'Open, assigned, in-progress, on-hold',
      action: 'Manage work queue',
      href: '/command/drilldown/open-work-orders',
      icon: <ClipboardList className="h-5 w-5" />,
      colorClass: '',
      iconBg: 'bg-blue-500/15 text-blue-300',
      urgency: wip.open_work_orders > 20 ? 'warning' : 'normal',
    },
    {
      label: 'Critical Actions',
      value: criticalActionCount,
      sublabel: 'Urgent items across all workflows',
      action: 'Open urgent queue',
      href: '/command/drilldown/critical-actions',
      icon: <AlertTriangle className="h-5 w-5" />,
      colorClass: '',
      iconBg: 'bg-rose-500/15 text-rose-300',
      urgency: criticalActionCount > 0 ? 'critical' : 'normal',
    },
    {
      label: 'Overdue PM',
      value: wip.overdue_pm,
      sublabel: 'PM tasks past their scheduled date',
      action: 'Schedule overdue PM',
      href: '/command/drilldown/overdue-pm',
      icon: <Activity className="h-5 w-5" />,
      colorClass: '',
      iconBg: 'bg-amber-500/15 text-amber-300',
      urgency: wip.overdue_pm > 10 ? 'critical' : wip.overdue_pm > 0 ? 'warning' : 'normal',
    },
    {
      label: 'Calibration Due',
      value: wip.calibration_due_30d,
      sublabel: 'Due or overdue within 30 days',
      action: 'Review calibration queue',
      href: '/command/drilldown/calibration',
      icon: <Wrench className="h-5 w-5" />,
      colorClass: '',
      iconBg: 'bg-violet-500/15 text-violet-300',
      urgency: wip.calibration_due_30d > 5 ? 'warning' : 'normal',
    },
    {
      label: 'Stock Risks',
      value: summary.stockBlockers,
      sublabel: 'Stockout or low-stock risk from shared stock source',
      action: 'Review stock risks',
      href: '/command/drilldown/stock-blockers',
      icon: <Package className="h-5 w-5" />,
      colorClass: '',
      iconBg: 'bg-orange-500/15 text-orange-300',
      urgency: summary.stockBlockers > 0 ? 'warning' : 'normal',
    },
    {
      label: 'Replacement Candidates',
      value: replacementCandidates,
      sublabel: 'Assets with high replacement priority index',
      action: 'Review lifecycle decisions',
      href: '/command/drilldown/replacement',
      icon: <TrendingDown className="h-5 w-5" />,
      colorClass: '',
      iconBg: 'bg-amber-500/15 text-amber-300',
      urgency: replacementCandidates > 0 ? 'warning' : 'normal',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {cards.map((card) => (
        <SummaryCard key={card.label} card={card} canMutate={canMutate} />
      ))}
      {/* Refresh hint card */}
      <Link
        href="/reports"
        className="panel-surface group flex flex-col items-center justify-center gap-2 rounded-lg border p-5 text-center transition hover:border-[var(--brand)]/50"
      >
        <div className="rounded-lg bg-slate-500/15 p-3 text-slate-300">
          <RefreshCw className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-[var(--text-muted)]">Reports</p>
        <p className="text-xs text-violet-300 opacity-0 transition-opacity group-hover:opacity-100">
          Open reports →
        </p>
      </Link>
    </div>
  );
}
