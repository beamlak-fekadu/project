'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bell, Boxes, Package, Truck } from 'lucide-react';
import { PageHeader, Badge, StatCard } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { UrgencyBadge } from '@/components/ui/StatusBadge';
import { getRecommendationFlags } from '@/services/analytics.service';
import { generateAlertSummary } from '@/utils/decision-support/explanations';
import ExpandableText from '@/components/ui/ExpandableText';
import { storeEquipmentDetail, storeReport } from '@/utils/store/store-evidence-links';
import type { RecommendationFlagType, Urgency } from '@/types/domain';

interface AssetInfo { id: string; asset_code: string; name: string }
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

// Logistics-relevant flag types. Acknowledgement is a BME Head action — store
// user never sees an Acknowledge / Snooze button.
const STORE_FLAG_TYPES = new Set<RecommendationFlagType>([
  'low_stock',
  'part_shortage',
]);

// We additionally surface stock-related alerts:
//   - delivered procurement awaiting receipt (computed elsewhere)
//   - critical work order blocked (proxied via 'recurring_failure' or
//     'urgent_maintenance' with linked stock signal — kept out of this
//     inbox to avoid duplicating Maintenance Blockers).

function flagCategory(flag: RecommendationFlagType): { label: string; icon: React.ReactNode } {
  switch (flag) {
    case 'low_stock':
      return { label: 'Low stock', icon: <Boxes className="h-4 w-4 text-amber-300" /> };
    case 'part_shortage':
      return { label: 'Part shortage / stockout', icon: <AlertTriangle className="h-4 w-4 text-rose-300" /> };
    default:
      return { label: 'Logistics signal', icon: <Bell className="h-4 w-4 text-cyan-300" /> };
  }
}

function severityOrder(s: Urgency): number {
  const map: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return map[s] ?? 4;
}

export default function StoreLogisticsAlerts() {
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await getRecommendationFlags();
        const filtered = ((data ?? []) as unknown as AlertRow[])
          .filter((a) => !a.is_acknowledged && STORE_FLAG_TYPES.has(a.flag_type));
        setAlerts(filtered.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity)));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const counts = useMemo(() => {
    let critical = 0, high = 0, lowStock = 0, partShortage = 0;
    for (const a of alerts) {
      if (a.severity === 'critical') critical++;
      if (a.severity === 'high') high++;
      if (a.flag_type === 'low_stock') lowStock++;
      if (a.flag_type === 'part_shortage') partShortage++;
    }
    return { total: alerts.length, critical, high, lowStock, partShortage };
  }, [alerts]);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logistics Alerts"
        description="Read-only inbox of stock and procurement signals affecting the store. Acknowledge is not a store action."
        breadcrumbs={[{ label: 'Store Operations', href: '/command' }, { label: 'Logistics Alerts' }]}
        actions={<Badge variant="info">Store / logistics view</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Logistics Alerts" value={counts.total} icon={<Bell className="h-5 w-5" />} />
        <StatCard label="Critical" value={counts.critical} icon={<AlertTriangle className="h-5 w-5" />} color="red" />
        <StatCard label="Low Stock" value={counts.lowStock} icon={<Boxes className="h-5 w-5" />} color="yellow" />
        <StatCard label="Part Shortage" value={counts.partShortage} icon={<Package className="h-5 w-5" />} color="red" />
      </div>

      {alerts.length === 0 ? (
        <div className="panel-surface rounded-xl p-8 text-center">
          <Bell className="mx-auto mb-3 h-10 w-10 text-emerald-300" />
          <p className="text-sm text-[var(--foreground)]">No logistics alerts require attention.</p>
        </div>
      ) : (
        <div className="panel-surface rounded-xl">
          <div className="border-b border-[var(--border-subtle)]/60 p-4">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Active alerts</h2>
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
                        <Link href={storeEquipmentDetail(a.asset_id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">
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
                    <Link href="/spare-parts" className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Open Stock Detail</Link>
                    <Link href="/logistics?workflow=issue" className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Open Issue Queue</Link>
                    <Link href="/procurement" className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Track Procurement</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        Acknowledge / Snooze / Resolve alerts is not a store action. Export a snapshot from{' '}
        <Link href={storeReport('spare-parts-stock')} className="text-violet-300 hover:text-violet-200">Stock report</Link>{' '}or{' '}
        <Link href={storeReport('procurement-pipeline')} className="text-violet-300 hover:text-violet-200">Procurement report</Link>.
      </p>
      <span className="hidden"><Truck className="h-4 w-4" /></span>
    </div>
  );
}
