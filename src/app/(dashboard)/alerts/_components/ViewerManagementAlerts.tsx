'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bell, Clock, Info, Package, ShieldAlert } from 'lucide-react';
import { PageHeader, Badge, StatCard } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { UrgencyBadge } from '@/components/ui/StatusBadge';
import ExpandableText from '@/components/ui/ExpandableText';
import { getRecommendationFlags } from '@/services/analytics.service';
import { generateAlertSummary } from '@/utils/decision-support/explanations';
import {
  viewerEquipmentDetail,
  viewerReplacementEvidence,
  viewerReport,
} from '@/utils/viewer/evidence-links';
import type { RecommendationFlagType, Urgency } from '@/types/domain';

interface AssetInfo {
  id: string;
  asset_code: string;
  name: string;
}

interface AlertRow {
  id: string;
  asset_id: string;
  flag_type: RecommendationFlagType;
  severity: Urgency;
  message: string;
  details: Record<string, unknown>;
  is_acknowledged: boolean;
  generated_at: string;
  equipment_assets: AssetInfo;
}

// Management-significant flag types only — the Viewer Alerts inbox should not
// flood leadership with low-level technician signals.
const MANAGEMENT_FLAG_TYPES = new Set<RecommendationFlagType>([
  'urgent_maintenance',
  'replacement_candidate',
  'recurring_failure',
  'part_shortage',
  'high_risk',
  'low_availability',
  'overdue_pm',
  'low_stock',
]);

function flagCategory(flag: RecommendationFlagType): { label: string; icon: React.ReactNode } {
  switch (flag) {
    case 'urgent_maintenance':
      return { label: 'Critical equipment unavailable', icon: <ShieldAlert className="h-4 w-4 text-rose-300" /> };
    case 'recurring_failure':
      return { label: 'Critical work overdue', icon: <AlertTriangle className="h-4 w-4 text-amber-300" /> };
    case 'overdue_pm':
      return { label: 'PM/calibration compliance risk', icon: <Clock className="h-4 w-4 text-amber-300" /> };
    case 'part_shortage':
    case 'low_stock':
      return { label: 'Stock blockers affecting repair', icon: <Package className="h-4 w-4 text-orange-300" /> };
    case 'replacement_candidate':
      return { label: 'Replacement candidate needing attention', icon: <Bell className="h-4 w-4 text-violet-300" /> };
    case 'high_risk':
    case 'low_availability':
      return { label: 'Risk requiring management awareness', icon: <ShieldAlert className="h-4 w-4 text-rose-300" /> };
    default:
      return { label: 'Management alert', icon: <Info className="h-4 w-4 text-cyan-300" /> };
  }
}

function severityOrder(s: Urgency): number {
  const map: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return map[s] ?? 4;
}

function evidenceHref(a: AlertRow): string {
  if (a.flag_type === 'replacement_candidate') return viewerReplacementEvidence(a.asset_id);
  if (a.flag_type === 'overdue_pm') return viewerReport('pm-compliance');
  if (a.flag_type === 'part_shortage' || a.flag_type === 'low_stock') return viewerReport('spare-parts-stock');
  if (a.flag_type === 'recurring_failure') return viewerEquipmentDetail(a.asset_id);
  return viewerEquipmentDetail(a.asset_id);
}

export default function ViewerManagementAlerts() {
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await getRecommendationFlags();
        const filtered = ((data ?? []) as unknown as AlertRow[])
          .filter((a) => !a.is_acknowledged && MANAGEMENT_FLAG_TYPES.has(a.flag_type));
        setAlerts(filtered.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity)));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const counts = useMemo(() => {
    let critical = 0, high = 0, medium = 0;
    for (const a of alerts) {
      if (a.severity === 'critical') critical++;
      else if (a.severity === 'high') high++;
      else if (a.severity === 'medium') medium++;
    }
    return { total: alerts.length, critical, high, medium };
  }, [alerts]);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Management Alerts"
        description="Read-only inbox of management-significant signals only. Low-level technical alerts are not shown."
        breadcrumbs={[{ label: 'Command Center', href: '/command' }, { label: 'Management Alerts' }]}
        actions={<Badge variant="default">Read-only view</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Management Alerts" value={counts.total} icon={<Bell className="h-5 w-5" />} />
        <StatCard label="Critical" value={counts.critical} icon={<ShieldAlert className="h-5 w-5" />} color="red" />
        <StatCard label="High" value={counts.high} icon={<AlertTriangle className="h-5 w-5" />} color="orange" />
        <StatCard label="Medium" value={counts.medium} icon={<Clock className="h-5 w-5" />} color="yellow" />
      </div>

      {alerts.length === 0 ? (
        <div className="panel-surface rounded-xl p-8 text-center">
          <Bell className="mx-auto mb-3 h-10 w-10 text-emerald-300" />
          <p className="text-sm text-[var(--foreground)]">No management-level alerts require attention.</p>
        </div>
      ) : (
        <div className="panel-surface rounded-xl">
          <div className="border-b border-[var(--border-subtle)]/60 p-4">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Active Alerts</h2>
          </div>
          <ul className="divide-y divide-[var(--border-subtle)]/60">
            {alerts.map((a) => {
              const cat = flagCategory(a.flag_type);
              return (
                <li key={a.id} className="flex flex-col gap-2 p-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex flex-1 items-start gap-3">
                    <div className="rounded-md bg-[var(--surface-2)] p-2">{cat.icon}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--foreground)]">{cat.label}</span>
                        <UrgencyBadge urgency={a.severity} />
                      </div>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        <Link href={viewerEquipmentDetail(a.asset_id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                          {a.equipment_assets?.name ?? 'Unknown asset'}
                        </Link>
                        {a.equipment_assets?.asset_code && (
                          <span className="text-xs text-[var(--text-subtle)]"> · {a.equipment_assets.asset_code}</span>
                        )}
                      </p>
                      <ExpandableText
                        text={generateAlertSummary({ flagType: a.flag_type, details: a.details, assetName: a.equipment_assets?.name }) || a.message}
                        lines={2}
                        className="mt-1 text-xs text-[var(--text-muted)]"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 md:flex-col md:items-end">
                    <Link href={evidenceHref(a)} className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Evidence</Link>
                    <Link href={viewerEquipmentDetail(a.asset_id)} className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Asset Profile</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
