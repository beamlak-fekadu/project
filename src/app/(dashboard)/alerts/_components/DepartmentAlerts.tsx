'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bell, Clock, Gauge, Package, ShieldAlert, Wrench } from 'lucide-react';
import { PageHeader, Badge, StatCard } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { UrgencyBadge } from '@/components/ui/StatusBadge';
import ExpandableText from '@/components/ui/ExpandableText';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { createClient } from '@/lib/supabase/client';
import { generateAlertSummary } from '@/utils/decision-support/explanations';
import { MISSING_DEPARTMENT_MESSAGE } from '@/utils/department/department-scope';
import { deptEquipmentDetail } from '@/utils/department/department-evidence-links';
import type { RecommendationFlagType, Urgency } from '@/types/domain';

interface AssetInfo { id: string; asset_code: string; name: string; department_id: string }

interface AlertRow {
  id: string;
  asset_id: string;
  flag_type: RecommendationFlagType;
  severity: Urgency;
  message: string;
  details: Record<string, unknown> | null;
  is_acknowledged: boolean;
  generated_at: string;
  equipment_assets: AssetInfo;
}

function flagCategory(flag: RecommendationFlagType): { label: string; icon: React.ReactNode } {
  switch (flag) {
    case 'urgent_maintenance': return { label: 'Critical equipment unavailable', icon: <ShieldAlert className="h-4 w-4 text-rose-300" /> };
    case 'recurring_failure': return { label: 'Repeated work delay risk', icon: <AlertTriangle className="h-4 w-4 text-amber-300" /> };
    case 'overdue_pm': return { label: 'PM overdue', icon: <Clock className="h-4 w-4 text-amber-300" /> };
    case 'calibrate_soon': return { label: 'Calibration upcoming/overdue', icon: <Gauge className="h-4 w-4 text-amber-300" /> };
    case 'part_shortage':
    case 'low_stock': return { label: 'Part blocker affecting department equipment', icon: <Package className="h-4 w-4 text-orange-300" /> };
    case 'replacement_candidate': return { label: 'Replacement attention recommended', icon: <Bell className="h-4 w-4 text-violet-300" /> };
    case 'high_risk':
    case 'low_availability': return { label: 'Risk affecting department equipment', icon: <ShieldAlert className="h-4 w-4 text-rose-300" /> };
    default: return { label: 'Department alert', icon: <Wrench className="h-4 w-4 text-cyan-300" /> };
  }
}

function severityOrder(s: Urgency): number {
  const map: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return map[s] ?? 4;
}

export default function DepartmentAlerts() {
  const { user } = useAuth();
  const { profile, loading: profileLoading } = useProfile(user?.id);
  const departmentId = profile?.department_id ?? null;
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);

  useEffect(() => {
    if (profileLoading) return;
    if (!departmentId) return;
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('recommendation_flags')
        .select('id, asset_id, flag_type, severity, message, details, is_acknowledged, generated_at, equipment_assets!inner(id, asset_code, name, department_id)')
        .eq('is_acknowledged', false)
        .eq('equipment_assets.department_id', departmentId)
        .order('generated_at', { ascending: false })
        .limit(500);
      if (cancelled) return;
      const rows = ((data ?? []) as unknown as AlertRow[])
        .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
      setAlerts(rows);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [departmentId, profileLoading]);

  const counts = useMemo(() => {
    let critical = 0, high = 0, equipmentDown = 0, compliance = 0, parts = 0;
    for (const a of alerts) {
      if (a.severity === 'critical') critical++;
      if (a.severity === 'high') high++;
      if (a.flag_type === 'urgent_maintenance' || a.flag_type === 'high_risk') equipmentDown++;
      if (a.flag_type === 'overdue_pm' || a.flag_type === 'calibrate_soon') compliance++;
      if (a.flag_type === 'low_stock' || a.flag_type === 'part_shortage') parts++;
    }
    return { total: alerts.length, critical, high, equipmentDown, compliance, parts };
  }, [alerts]);

  if (profileLoading) return <PageLoader />;
  if (departmentId && loading) return <PageLoader />;

  if (!departmentId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Department Alerts" description="" />
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-6">
          <p className="font-medium text-[var(--foreground)]">No department linked</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{MISSING_DEPARTMENT_MESSAGE}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Department Alerts"
        description="Read-only signals affecting your department. Acknowledge is not a department-role action."
        breadcrumbs={[{ label: 'Department Dashboard', href: '/command' }, { label: 'Department Alerts' }]}
        actions={<Badge variant="info">Department view</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Total Alerts" value={counts.total} icon={<Bell className="h-5 w-5" />} />
        <StatCard label="Critical" value={counts.critical} icon={<ShieldAlert className="h-5 w-5" />} color="red" />
        <StatCard label="High" value={counts.high} icon={<AlertTriangle className="h-5 w-5" />} color="orange" />
        <StatCard label="Equipment risk" value={counts.equipmentDown} icon={<ShieldAlert className="h-5 w-5" />} color="red" />
        <StatCard label="Compliance" value={counts.compliance} icon={<Gauge className="h-5 w-5" />} color="yellow" />
        <StatCard label="Part blockers" value={counts.parts} icon={<Package className="h-5 w-5" />} color="orange" />
      </div>

      {alerts.length === 0 ? (
        <div className="panel-surface rounded-xl p-8 text-center">
          <Bell className="mx-auto mb-3 h-10 w-10 text-emerald-300" />
          <p className="text-sm text-[var(--foreground)]">No department alerts require attention.</p>
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
                        <Link href={deptEquipmentDetail(a.asset_id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">
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
                    <Link href={deptEquipmentDetail(a.asset_id)} className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Evidence</Link>
                    <Link href="/requests" className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Track Request</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        Acknowledge / Snooze / Resolve / Create Work Order / Assign Technician are not department-role actions.
      </p>
    </div>
  );
}
