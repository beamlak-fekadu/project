'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Wrench, ClipboardList } from 'lucide-react';
import { PageHeader, DataTable, Tabs, Button, Spinner } from '@/components/ui';
import { UrgencyBadge, WorkOrderStatusBadge, RequestStatusBadge } from '@/components/ui/StatusBadge';
import { getMaintenanceRequests, getWorkOrders } from '@/services/maintenance.service';
import { getRecommendationFlags } from '@/services/analytics.service';
import { useToast } from '@/components/ui/Toast';
import type { MaintenanceRequest, WorkOrder } from '@/types/database';
import { generateAlertSummary } from '@/utils/decision-support/explanations';

type RequestRow = MaintenanceRequest & {
  equipment_assets?: { id: string; asset_code?: string | null; name?: string | null; serial_number?: string | null } | Array<{ id: string; asset_code?: string | null; name?: string | null; serial_number?: string | null }> | null;
  departments?: { id: string; name?: string | null; code?: string | null } | Array<{ id: string; name?: string | null; code?: string | null }> | null;
  [key: string]: unknown;
};

type WorkOrderRow = WorkOrder & {
  equipment_assets?: { id: string; asset_code?: string | null; name?: string | null } | Array<{ id: string; asset_code?: string | null; name?: string | null }> | null;
  profiles?: { id: string; full_name?: string | null; email?: string | null } | Array<{ id: string; full_name?: string | null; email?: string | null }> | null;
  [key: string]: unknown;
};

interface RecurringFailureFlag {
  id: string;
  asset_id: string;
  message: string;
  severity: string;
  generated_at: string;
  details?: Record<string, unknown>;
  equipment_assets?: { id?: string; asset_code?: string; name?: string } | null;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function safeDisplay(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f-]{32,36}$/i.test(value) ? null : value;
}

function FaultDescriptionCell({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = description.length > 120;

  return (
    <div className="max-w-[22rem] whitespace-normal">
      <p className={`text-sm text-[var(--foreground)] ${expanded ? '' : 'line-clamp-2'}`}>
        {description}
      </p>
      {isLong && (
        <button
          type="button"
          className="mt-1 text-xs font-medium text-[var(--brand)] hover:text-[var(--brand-strong)]"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export default function MaintenancePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [recurringFailures, setRecurringFailures] = useState<RecurringFailureFlag[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [reqRes, woRes, flagRes] = await Promise.all([
        getMaintenanceRequests(),
        getWorkOrders(),
        getRecommendationFlags(), // fetch all flags; filtered to recurring_failure + unacknowledged below
      ]);
      if (reqRes.error) toast('error', 'Failed to load maintenance requests');
      if (woRes.error) toast('error', 'Failed to load work orders');
      setRequests((reqRes.data ?? []) as unknown as RequestRow[]);
      setWorkOrders((woRes.data ?? []) as unknown as WorkOrderRow[]);
      const allFlags = (flagRes.data ?? []) as unknown as Array<RecurringFailureFlag & { flag_type: string; is_acknowledged: boolean }>;
      setRecurringFailures(
        allFlags.filter((f) => f.flag_type === 'recurring_failure' && !f.is_acknowledged)
      );
      setLoading(false);
    }
    load();
  }, [toast]);

  const requestColumns = [
    { key: 'request_number', header: 'Request #', sortable: true },
    {
      key: 'asset_name',
      header: 'Asset',
      sortable: true,
      render: (row: RequestRow) => {
        const asset = firstRelation(row.equipment_assets);
        return (
          safeDisplay(asset?.name)
          ?? safeDisplay(asset?.asset_code)
          ?? safeDisplay(asset?.serial_number)
          ?? '—'
        );
      },
    },
    {
      key: 'department_name',
      header: 'Department',
      render: (row: RequestRow) => {
        const department = firstRelation(row.departments);
        return safeDisplay(department?.name) ?? safeDisplay(department?.code) ?? '—';
      },
    },
    {
      key: 'fault_description',
      header: 'Fault Description',
      render: (row: RequestRow) => <FaultDescriptionCell description={row.fault_description} />,
      className: 'max-w-[360px] whitespace-normal align-top',
    },
    {
      key: 'urgency',
      header: 'Urgency',
      sortable: true,
      render: (row: RequestRow) => <UrgencyBadge urgency={row.urgency} />,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row: RequestRow) => <RequestStatusBadge status={row.status} />,
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: RequestRow) => new Date(row.created_at).toLocaleDateString(),
    },
  ];

  const woColumns = [
    { key: 'work_order_number', header: 'WO #', sortable: true },
    {
      key: 'asset_name',
      header: 'Asset',
      sortable: true,
      render: (row: WorkOrderRow) => {
        const asset = firstRelation(row.equipment_assets);
        return safeDisplay(asset?.name) ?? safeDisplay(asset?.asset_code) ?? '—';
      },
    },
    {
      key: 'assigned_to_name',
      header: 'Assigned To',
      render: (row: WorkOrderRow) => firstRelation(row.profiles)?.full_name ?? 'Unassigned',
    },
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      render: (row: WorkOrderRow) => <UrgencyBadge urgency={row.priority} />,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row: WorkOrderRow) => <WorkOrderStatusBadge status={row.status} />,
    },
    {
      key: 'work_type',
      header: 'Type',
      sortable: true,
      render: (row: WorkOrderRow) =>
        row.work_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    },
    {
      key: 'started_at',
      header: 'Started',
      sortable: true,
      render: (row: WorkOrderRow) =>
        row.started_at ? new Date(row.started_at).toLocaleDateString() : '—',
    },
    {
      key: 'completed_at',
      header: 'Completed',
      sortable: true,
      render: (row: WorkOrderRow) =>
        row.completed_at ? new Date(row.completed_at).toLocaleDateString() : '—',
    },
  ];

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Maintenance"
        description="Manage maintenance requests and work orders"
        breadcrumbs={[{ label: 'Command Center', href: '/command' }, { label: 'Maintenance' }]}
      />

      {/* Recurring failure equipment card */}
      {recurringFailures.length > 0 && (
        <div className="mb-6 panel-surface rounded-lg p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-rose-300">
            <Wrench className="h-4 w-4" />
            Recurring failure equipment ({recurringFailures.length})
          </h2>
          <div className="max-h-64 overflow-y-auto divide-y divide-[var(--border-subtle)]/60">
            {recurringFailures.map((flag) => {
              const asset = flag.equipment_assets;
              const assetId = asset?.id ?? flag.asset_id;
              return (
                <div key={flag.id} className="flex items-center justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                      {asset?.name ?? 'Unknown asset'}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{asset?.asset_code ?? flag.asset_id}</p>
                    <p className="truncate text-xs text-[var(--text-muted)]">
                      {generateAlertSummary({
                        assetName: asset?.name,
                        flagType: 'recurring_failure',
                        details: flag.details ?? null,
                      })}
                    </p>
                  </div>
                  <Link
                    href={`/inventory/${assetId}?tab=history`}
                    className="shrink-0 text-xs font-medium text-violet-300 hover:text-violet-200"
                  >
                    View history →
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Tabs
        tabs={[
          {
            id: 'requests',
            label: 'Requests',
            count: requests.length,
            content: (
              <DataTable<RequestRow>
                columns={requestColumns}
                data={requests}
                searchPlaceholder="Search requests…"
                onRowClick={(row) => router.push(`/maintenance/requests/${row.id}`)}
                emptyMessage="No maintenance requests found"
                actions={
                  <Link href="/maintenance/requests/new">
                    <Button size="sm">
                      <ClipboardList className="h-4 w-4" />
                      New Request
                    </Button>
                  </Link>
                }
              />
            ),
          },
          {
            id: 'work-orders',
            label: 'Work Orders',
            count: workOrders.length,
            content: (
              <DataTable<WorkOrderRow>
                columns={woColumns}
                data={workOrders}
                searchPlaceholder="Search work orders…"
                onRowClick={(row) => router.push(`/maintenance/work-orders/${row.id}`)}
                emptyMessage="No work orders found"
                actions={
                  <Link href="/maintenance/work-orders/new">
                    <Button size="sm">
                      <Wrench className="h-4 w-4" />
                      New Work Order
                    </Button>
                  </Link>
                }
              />
            ),
          },
        ]}
      />
    </div>
  );
}
