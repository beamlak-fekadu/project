'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  Clock,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { getRecommendationFlags, acknowledgeFlag } from '@/services/analytics.service';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader, StatCard, Badge, Button, Tabs, FilterBar } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { UrgencyBadge } from '@/components/ui/StatusBadge';
import Card, { CardContent } from '@/components/ui/Card';
import type { Urgency, RecommendationFlagType } from '@/types/database';
import { generateAlertSummary } from '@/utils/decision-support/explanations';

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

export default function AlertsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({ severity: '', flag_type: '' });

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
        const { error } = await acknowledgeFlag(id, user.id);
        if (error) {
          toast('error', 'Failed to acknowledge alert');
        } else {
          setData((prev) =>
            prev.map((a) =>
              a.id === id ? { ...a, is_acknowledged: true, acknowledged_by: user.id, acknowledged_at: new Date().toISOString() } : a
            )
          );
          toast('success', 'Alert acknowledged');
        }
      } finally {
        setAcknowledging(null);
      }
    },
    [user, toast]
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

  const filterByTab = (severity: Urgency | null) =>
    (severity ? filtered.filter((d) => d.severity === severity) : filtered);

  const renderAlertList = (alerts: AlertRow[]) => {
    if (alerts.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle className="mb-3 h-10 w-10 text-green-400" />
          <p className="text-sm text-gray-500">No alerts in this category</p>
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
                        href={`/inventory/${alert.equipment_assets.id}`}
                        className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {alert.equipment_assets.asset_code} — {alert.equipment_assets.name}
                      </Link>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-gray-800 dark:text-gray-200">
                    {generateAlertSummary({
                      assetName: alert.equipment_assets?.name,
                      flagType: alert.flag_type,
                      details: alert.details,
                    })}
                  </p>
                  {alert.details && Object.keys(alert.details).length > 0 && (
                    <div className="mt-2 rounded-md bg-gray-50 p-2 dark:bg-gray-800/50">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                        {Object.entries(alert.details).map(([k, v]) => (
                          <span key={k}>
                            <span className="font-medium">{k.replace(/_/g, ' ')}:</span>{' '}
                            {String(v)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      {new Date(alert.generated_at).toLocaleString()}
                    </span>
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
      id: 'critical',
      label: 'Critical',
      count: criticalCount,
      content: renderAlertList(filterByTab('critical')),
    },
    {
      id: 'high',
      label: 'High',
      count: highCount,
      content: renderAlertList(filterByTab('high')),
    },
    {
      id: 'medium',
      label: 'Medium',
      count: mediumCount,
      content: renderAlertList(filterByTab('medium')),
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
          { label: 'Dashboard', href: '/' },
          { label: 'Alerts' },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Critical"
          value={criticalCount}
          icon={<ShieldAlert className="h-6 w-6" />}
          color="red"
        />
        <StatCard
          label="High"
          value={highCount}
          icon={<AlertTriangle className="h-6 w-6" />}
          color="orange"
        />
        <StatCard
          label="Medium"
          value={mediumCount}
          icon={<Clock className="h-6 w-6" />}
          color="yellow"
        />
        <StatCard
          label="Unacknowledged"
          value={unacknowledged.length}
          icon={<Bell className="h-6 w-6" />}
          color="blue"
        />
      </div>

      <FilterBar
        filters={[
          { key: 'severity', label: 'Severity', options: SEVERITY_OPTIONS },
          { key: 'flag_type', label: 'Type', options: FLAG_TYPE_OPTIONS },
        ]}
        values={filters}
        onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
        onReset={() => setFilters({ severity: '', flag_type: '' })}
      />

      <Tabs tabs={tabData} defaultTab="all" />
    </div>
  );
}
