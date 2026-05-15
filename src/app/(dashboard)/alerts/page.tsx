'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  Clock,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { getRecommendationFlags } from '@/services/analytics.service';
import { acknowledgeAlertFlagAction } from '@/actions/alerts.actions';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useRole } from '@/hooks/useRole';
import { PageHeader, StatCard, Badge, Button, Tabs, FilterBar } from '@/components/ui';
import ClearFiltersButton from '@/components/ui/ClearFiltersButton';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { UrgencyBadge } from '@/components/ui/StatusBadge';
import Card, { CardContent } from '@/components/ui/Card';
import type { Urgency, RecommendationFlagType } from '@/types/domain';
import { generateAlertSummary } from '@/utils/decision-support/explanations';
import ExpandableText from '@/components/ui/ExpandableText';
import { replacementEvidence } from '@/app/(dashboard)/command/_lib/command-center-routes';
import ViewerManagementAlerts from './_components/ViewerManagementAlerts';
import StoreLogisticsAlerts from './_components/StoreLogisticsAlerts';
import DepartmentAlerts from './_components/DepartmentAlerts';

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
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  generated_at: string;
  expires_at: string | null;
  equipment_assets: AssetInfo;
}

const SEVERITY_OPTIONS = [
  { value: '', label: 'All Severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const FLAG_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'urgent_maintenance', label: 'Urgent Maintenance' },
  { value: 'monitor_closely', label: 'Monitor Closely' },
  { value: 'prioritize_pm', label: 'Prioritize PM' },
  { value: 'calibrate_soon', label: 'Calibrate Soon' },
  { value: 'replacement_candidate', label: 'Replacement Candidate' },
  { value: 'recurring_failure', label: 'Recurring Failure' },
  { value: 'part_shortage', label: 'Part Shortage' },
  { value: 'high_risk', label: 'High Risk' },
  { value: 'low_availability', label: 'Low Availability' },
  { value: 'overdue_pm', label: 'Overdue PM' },
  { value: 'warranty_expiring', label: 'Warranty Expiring' },
  { value: 'contract_expiring', label: 'Contract Expiring' },
  { value: 'low_stock', label: 'Low Stock' },
];

function flagTypeLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function severityIcon(severity: Urgency) {
  switch (severity) {
    case 'critical':
      return <ShieldAlert className="h-5 w-5 text-red-600" />;
    case 'high':
      return <AlertTriangle className="h-5 w-5 text-orange-500" />;
    case 'medium':
      return <Clock className="h-5 w-5 text-yellow-500" />;
    default:
      return <Info className="h-5 w-5 text-blue-400" />;
  }
}

function severityOrder(s: Urgency): number {
  const map: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return map[s] ?? 4;
}

function sourceHref(alert: AlertRow) {
  if (alert.flag_type === 'replacement_candidate') return replacementEvidence(alert.asset_id);
  if (['calibrate_soon'].includes(alert.flag_type)) return `/calibration?assetId=${alert.asset_id}&action=record-result&source=alerts`;
  if (['prioritize_pm', 'overdue_pm'].includes(alert.flag_type)) return `/pm?assetId=${alert.asset_id}&filter=overdue&source=alerts`;
  if (['part_shortage', 'low_stock'].includes(alert.flag_type)) return '/spare-parts?tab=blockers&source=alerts';
  if (['urgent_maintenance', 'recurring_failure'].includes(alert.flag_type)) return `/maintenance/requests/new?assetId=${alert.asset_id}&source=alerts&urgency=${alert.severity}`;
  return `/equipment/${alert.asset_id}`;
}

function sourceActionLabel(alert: AlertRow) {
  if (alert.flag_type === 'replacement_candidate') return 'Open Replacement Evidence';
  if (['calibrate_soon'].includes(alert.flag_type)) return 'Open Calibration Task';
  if (['prioritize_pm', 'overdue_pm'].includes(alert.flag_type)) return 'Open PM Task';
  if (['part_shortage', 'low_stock'].includes(alert.flag_type)) return 'Open Stock Detail';
  if (alert.flag_type === 'urgent_maintenance') return 'Create Maintenance Request';
  if (alert.flag_type === 'recurring_failure') return 'Open Maintenance Evidence';
  if (alert.flag_type === 'high_risk') return 'Open Asset Profile';
  return 'Open Asset Profile';
}

function alertGroup(alert: AlertRow) {
  if (['critical', 'high'].includes(alert.severity) && ['urgent_maintenance', 'recurring_failure', 'overdue_pm', 'calibrate_soon'].includes(alert.flag_type)) return 'act_now';
  if (['overdue_pm', 'calibrate_soon'].includes(alert.flag_type)) return 'overdue';
  if (['part_shortage', 'low_stock'].includes(alert.flag_type)) return 'stock';
  if (['replacement_candidate', 'high_risk', 'low_availability'].includes(alert.flag_type)) return 'risk';
  return 'monitoring';
}

export default function AlertsPage() {
  const { roles } = useRole();
  const isViewerOnly =
    roles.includes('viewer') &&
    !roles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  const isStoreOnly =
    roles.includes('store_user') &&
    !roles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  const isDepartmentOnly =
    (roles.includes('department_head') || roles.includes('department_user')) &&
    !roles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  if (isDepartmentOnly) return <DepartmentAlerts />;
  if (isStoreOnly) return <StoreLogisticsAlerts />;
  if (isViewerOnly) return <ViewerManagementAlerts />;
  return <OperationalAlertsPage />;
}

function OperationalAlertsPage() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { profile } = useProfile(user?.id);
  const { primaryRole } = useRole();
  const { toast } = useToast();
  const [data, setData] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({ severity: '', flag_type: '' });
  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get('tab');
    return tab === 'act-now' ? 'act_now' : tab ?? 'act_now';
  });

  useEffect(() => {
    async function load() {
      try {
        const { data: rows } = await getRecommendationFlags();
        if (rows) setData(rows as unknown as AlertRow[]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleAcknowledge = useCallback(
    async (id: string) => {
      if (!user) return;
      setAcknowledging(id);
      try {
        const result = await acknowledgeAlertFlagAction(id);
        if (!result.success) {
          toast('error', 'Failed to acknowledge alert');
        } else {
          const ackBy = profile?.id ?? null;
          setData((prev) =>
            prev.map((a) =>
              a.id === id ? { ...a, is_acknowledged: true, acknowledged_by: ackBy, acknowledged_at: new Date().toISOString() } : a
            )
          );
          toast('success', 'Alert acknowledged');
        }
      } finally {
        setAcknowledging(null);
      }
    },
    [profile?.id, toast, user]
  );

  if (loading) return <PageLoader />;

  const unacknowledged = data.filter((d) => !d.is_acknowledged);

  const filtered = unacknowledged
    .filter((d) => !filters.severity || d.severity === filters.severity)
    .filter((d) => !filters.flag_type || d.flag_type === filters.flag_type)
    .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));

  const criticalCount = unacknowledged.filter((d) => d.severity === 'critical').length;
  const highCount = unacknowledged.filter((d) => d.severity === 'high').length;
  const mediumCount = unacknowledged.filter((d) => d.severity === 'medium').length;
  const acknowledgedCount = data.filter((d) => d.is_acknowledged).length;
  const overdueCount = unacknowledged.filter((d) => ['overdue_pm', 'calibrate_soon'].includes(d.flag_type)).length;
  const stockCount = unacknowledged.filter((d) => ['part_shortage', 'low_stock'].includes(d.flag_type)).length;
  const riskCount = unacknowledged.filter((d) => ['replacement_candidate', 'high_risk', 'low_availability'].includes(d.flag_type)).length;

  function showAlertTab(tab: string, nextFilters: Record<string, string> = { severity: '', flag_type: '' }) {
    setActiveTab(tab);
    setFilters(nextFilters);
  }

  const filterByGroup = (group: string) => {
    if (group === 'acknowledged') return data.filter((d) => d.is_acknowledged);
    if (group === 'all') return filtered;
    if (group === 'overdue') return filtered.filter((d) => ['overdue_pm', 'calibrate_soon'].includes(d.flag_type));
    if (group === 'stock') return filtered.filter((d) => ['part_shortage', 'low_stock'].includes(d.flag_type));
    if (group === 'risk') return filtered.filter((d) => ['replacement_candidate', 'high_risk', 'low_availability'].includes(d.flag_type));
    return filtered.filter((d) => alertGroup(d) === group);
  };

  const renderAlertList = (alerts: AlertRow[]) => {
    if (alerts.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle className="mb-3 h-10 w-10 text-green-400" />
          <p className="text-sm text-[var(--text-muted)]">No alerts in this category</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {alerts.map((alert) => (
          <Card key={alert.id}>
            <CardContent>
              <div className="flex items-start gap-4">
                <div className="mt-1 flex-shrink-0">{severityIcon(alert.severity)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <UrgencyBadge urgency={alert.severity} />
                    <Badge variant="info">{flagTypeLabel(alert.flag_type)}</Badge>
                    {alert.equipment_assets && (
                      <Link
                        href={`/equipment/${alert.equipment_assets.id}`}
                        className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {alert.equipment_assets.asset_code} — {alert.equipment_assets.name}
                      </Link>
                    )}
                  </div>
                  <div className="mt-2 text-sm text-gray-800 dark:text-gray-200">
                    <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">Why it triggered</p>
                    <ExpandableText
                      text={generateAlertSummary({
                        assetName: alert.equipment_assets?.name,
                        flagType: alert.flag_type,
                        details: alert.details,
                      })}
                      lines={2}
                    />
                  </div>
                  {alert.details && Object.keys(alert.details).length > 0 && (
                    <div className="mt-2 rounded-md bg-gray-50 p-2 dark:bg-gray-800/50">
                      <div className="flex flex-wrap gap-1 text-xs text-[var(--text-muted)]">
                        {Object.entries(alert.details).slice(0, 4).map(([k, v]) => (
                          <span key={k} className="rounded-full bg-[var(--surface-2)] px-2 py-0.5">
                            <span className="font-medium">{k.replace(/_/g, ' ')}:</span> {String(v)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-[var(--text-subtle)]">
                      <div>Generated: {new Date(alert.generated_at).toLocaleString()}</div>
                      {alert.acknowledged_at && <div>Acknowledged: {new Date(alert.acknowledged_at).toLocaleString()}</div>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={sourceHref(alert)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-strong)]">
                        {sourceActionLabel(alert)}
                      </Link>
                      {alert.is_acknowledged ? (
                        <Badge variant="success">Acknowledged</Badge>
                      ) : primaryRole !== 'viewer' && (
                        <Button
                          onClick={() => handleAcknowledge(alert.id)}
                          disabled={acknowledging === alert.id}
                          variant="outline"
                          size="sm"
                        >
                          {acknowledging === alert.id ? (
                            'Acknowledging...'
                          ) : (
                            <>
                              <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                              Acknowledge
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  const tabData = [
    {
      id: 'act_now',
      label: 'Act Now',
      count: filterByGroup('act_now').length,
      content: renderAlertList(filterByGroup('act_now')),
    },
    {
      id: 'overdue',
      label: 'Overdue',
      count: filterByGroup('overdue').length,
      content: renderAlertList(filterByGroup('overdue')),
    },
    {
      id: 'stock',
      label: 'Stock',
      count: filterByGroup('stock').length,
      content: renderAlertList(filterByGroup('stock')),
    },
    {
      id: 'risk',
      label: 'Risk / Replacement',
      count: filterByGroup('risk').length,
      content: renderAlertList(filterByGroup('risk')),
    },
    {
      id: 'monitoring',
      label: 'Monitoring',
      count: filterByGroup('monitoring').length,
      content: renderAlertList(filterByGroup('monitoring')),
    },
    {
      id: 'acknowledged',
      label: 'Acknowledged',
      count: acknowledgedCount,
      content: renderAlertList(filterByGroup('acknowledged')),
    },
    {
      id: 'all',
      label: 'All',
      count: filtered.length,
      content: renderAlertList(filtered),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts & Recommendations"
        description={`${unacknowledged.length} active alert${unacknowledged.length !== 1 ? 's' : ''} requiring attention`}
        breadcrumbs={[
          { label: 'Command Center', href: '/command' },
          { label: 'Alerts' },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Critical"
          value={criticalCount}
          icon={<ShieldAlert className="h-6 w-6" />}
          color="red"
          active={filters.severity === 'critical'}
          onClick={() => setFilters((prev) => ({ ...prev, severity: 'critical' }))}
        />
        <StatCard
          label="High"
          value={highCount}
          icon={<AlertTriangle className="h-6 w-6" />}
          color="orange"
          active={filters.severity === 'high'}
          onClick={() => setFilters((prev) => ({ ...prev, severity: 'high' }))}
        />
        <StatCard
          label="Medium"
          value={mediumCount}
          icon={<Clock className="h-6 w-6" />}
          color="yellow"
          active={filters.severity === 'medium'}
          onClick={() => setFilters((prev) => ({ ...prev, severity: 'medium' }))}
        />
        <StatCard
          label="Unacknowledged"
          value={unacknowledged.length}
          icon={<Bell className="h-6 w-6" />}
          color="blue"
          active={activeTab !== 'acknowledged' && !filters.severity && !filters.flag_type}
          onClick={() => showAlertTab('act_now')}
        />
        <StatCard
          label="Acknowledged"
          value={acknowledgedCount}
          icon={<CheckCircle className="h-6 w-6" />}
          color="green"
          active={activeTab === 'acknowledged'}
          onClick={() => showAlertTab('acknowledged')}
        />
        <StatCard
          label="Overdue"
          value={overdueCount}
          icon={<AlertTriangle className="h-6 w-6" />}
          color="orange"
          active={activeTab === 'overdue'}
          onClick={() => showAlertTab('overdue')}
        />
        <StatCard
          label="Stock"
          value={stockCount}
          icon={<AlertTriangle className="h-6 w-6" />}
          color="yellow"
          active={activeTab === 'stock'}
          onClick={() => showAlertTab('stock')}
        />
        <StatCard
          label="Risk / Replacement"
          value={riskCount}
          icon={<Info className="h-6 w-6" />}
          color="purple"
          active={activeTab === 'risk'}
          onClick={() => showAlertTab('risk')}
        />
      </div>

      {(activeTab !== 'act_now' || filters.severity || filters.flag_type) && (
        <div className="flex justify-end">
          <ClearFiltersButton onClick={() => { setActiveTab('act_now'); setFilters({ severity: '', flag_type: '' }); }} />
        </div>
      )}

      <FilterBar
        filters={[
          { key: 'severity', label: 'Severity', options: SEVERITY_OPTIONS },
          { key: 'flag_type', label: 'Type', options: FLAG_TYPE_OPTIONS },
        ]}
        values={filters}
        onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
        onReset={() => setFilters({ severity: '', flag_type: '' })}
      />

      {filters.flag_type === 'recurring_failure' && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-sm text-[var(--text-muted)]">
          Recurring-failure flags currently appear only after 4 or more failures in the seeded assessment period. Assets with 2-3 events are intentionally below threshold.
        </div>
      )}

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-sm text-[var(--text-muted)]">
        Acknowledged alerts hide from the active queue until the underlying signal changes. Informational signals should be acknowledged or converted into a real workflow item when action is needed.
      </div>

      <Tabs tabs={tabData} activeTab={activeTab} defaultTab="act_now" onChange={setActiveTab} />
    </div>
  );
}
