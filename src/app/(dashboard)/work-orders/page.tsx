'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, CheckCircle, Clock, UserPlus, Wrench } from 'lucide-react';
import { PageHeader, DataTable, Button, Spinner, StatCard, Badge } from '@/components/ui';
import { UrgencyBadge, WorkOrderStatusBadge } from '@/components/ui/StatusBadge';
import { getWorkOrders } from '@/services/maintenance.service';
import { useToast } from '@/components/ui/Toast';
import { useRole } from '@/hooks/useRole';
import type { WorkOrder, WorkOrderStatus } from '@/types/domain';
import { ROUTES } from '@/constants';
import { maintenanceRequestDetail, workOrderDetail } from '@/app/(dashboard)/command/_lib/command-center-routes';

type WorkOrderRow = WorkOrder & {
  equipment_assets?: { id: string; asset_code?: string | null; name?: string | null } | Array<{ id: string; asset_code?: string | null; name?: string | null }> | null;
  profiles?: { id: string; full_name?: string | null; email?: string | null } | Array<{ id: string; full_name?: string | null; email?: string | null }> | null;
  [key: string]: unknown;
};

const FILTERS = [
  { id: 'active', label: 'Active' },
  { id: 'all', label: 'All' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'completed', label: 'Completed' },
  { id: 'critical-active', label: 'Critical/High' },
] as const;

type FilterId = typeof FILTERS[number]['id'];

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function ageDays(row: WorkOrderRow) {
  const start = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000));
}

function durationDays(row: WorkOrderRow) {
  if (!row.completed_at || !row.created_at) return ageDays(row);
  const start = new Date(row.created_at).getTime();
  const end = new Date(row.completed_at).getTime();
  return Math.max(0, Math.ceil((end - start) / 86_400_000));
}

function timelineLabel(row: WorkOrderRow) {
  return row.status === 'completed' ? `${durationDays(row)}d duration` : `${ageDays(row)}d open`;
}

function isActiveWork(row: WorkOrderRow) {
  return ['open', 'assigned', 'in_progress', 'on_hold'].includes(row.status);
}

function isOverdueActive(row: WorkOrderRow) {
  return isActiveWork(row) && ageDays(row) >= 7;
}

function priorityRank(row: WorkOrderRow) {
  return ({ critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>)[row.priority] ?? 4;
}

function nextAction(row: WorkOrderRow, canMutate: boolean) {
  if (row.status === 'completed') return { label: 'View Completion Evidence', href: workOrderDetail(row.id) };
  if (row.status === 'canceled') return { label: 'View Record', href: workOrderDetail(row.id) };
  if (!canMutate) return { label: 'View Work Order', href: workOrderDetail(row.id) };
  if (row.status === 'on_hold') return { label: 'Resolve Blocker', href: workOrderDetail(row.id, 'resolve-blocker') };
  if (row.status === 'in_progress') return { label: 'Complete Work', href: workOrderDetail(row.id, 'complete') };
  if (row.status === 'open' && !row.assigned_to) return { label: 'Assign Work Order', href: workOrderDetail(row.id, 'assign') };
  if (row.status === 'assigned') return { label: 'Start Work', href: workOrderDetail(row.id, 'start') };
  return { label: 'Manage Work Order', href: workOrderDetail(row.id) };
}

function matchesFilter(row: WorkOrderRow, filter: FilterId) {
  if (filter === 'active') return isActiveWork(row);
  if (filter === 'all') return true;
  if (filter === 'unassigned') return ['open', 'assigned'].includes(row.status) && !row.assigned_to;
  if (filter === 'overdue') return isOverdueActive(row);
  if (filter === 'critical-active') return isActiveWork(row) && ['critical', 'high'].includes(row.priority);
  return row.status === filter;
}

function queueRank(row: WorkOrderRow) {
  if (isOverdueActive(row)) return 0;
  if (['critical', 'high'].includes(row.priority)) return 1;
  if (!row.assigned_to) return 2;
  if (row.status === 'in_progress') return 3;
  if (row.status === 'assigned') return 4;
  return 5;
}

export default function WorkOrdersPage() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { canManageMaintenance } = useRole();
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterId>(() => {
    const requested = searchParams.get('filter') as FilterId | null;
    return requested && FILTERS.some((item) => item.id === requested) ? requested : 'active';
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data, error } = await getWorkOrders();
      if (error) toast('error', 'Failed to load work orders');
      setWorkOrders((data ?? []) as unknown as WorkOrderRow[]);
      setLoading(false);
    }
    void load();
  }, [toast]);

  const summary = useMemo(() => {
    const open = workOrders.filter(isActiveWork);
    const thisMonth = new Date();
    return {
      open: open.length,
      unassigned: open.filter((wo) => !wo.assigned_to).length,
      assigned: workOrders.filter((wo) => wo.status === 'assigned').length,
      inProgress: workOrders.filter((wo) => wo.status === 'in_progress').length,
      onHold: workOrders.filter((wo) => wo.status === 'on_hold').length,
      overdueActive: open.filter(isOverdueActive).length,
      criticalHigh: open.filter((wo) => ['critical', 'high'].includes(wo.priority)).length,
      completedMonth: workOrders.filter((wo) => {
        if (!wo.completed_at) return false;
        const date = new Date(wo.completed_at);
        return date.getMonth() === thisMonth.getMonth() && date.getFullYear() === thisMonth.getFullYear();
      }).length,
    };
  }, [workOrders]);

  const filteredRows = useMemo(() => workOrders.filter((row) => matchesFilter(row, filter)), [filter, workOrders]);
  const activeQueue = useMemo(
    () => workOrders
      .filter(isActiveWork)
      .sort((a, b) => queueRank(a) - queueRank(b) || priorityRank(a) - priorityRank(b) || ageDays(b) - ageDays(a))
      .slice(0, 6),
    [workOrders]
  );

  const columns = [
    { key: 'work_order_number', header: 'WO #', sortable: true },
    {
      key: 'asset_name',
      header: 'Asset',
      sortable: true,
      render: (row: WorkOrderRow) => {
        const asset = firstRelation(row.equipment_assets);
        return (
          <div>
            <p className="font-medium">{asset?.asset_code ?? '—'}</p>
            <p className="text-xs text-[var(--text-muted)]">{asset?.name ?? 'Unknown asset'}</p>
          </div>
        );
      },
    },
    {
      key: 'originating_request',
      header: 'Request',
      render: (row: WorkOrderRow) => row.request_id ? (
        <Link className="text-[var(--brand)] hover:underline" href={maintenanceRequestDetail(row.request_id)}>
          Request
        </Link>
      ) : <span className="text-[var(--text-muted)]">Standalone</span>,
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
      render: (row: WorkOrderRow) => <WorkOrderStatusBadge status={row.status as WorkOrderStatus} />,
    },
    {
      key: 'assigned_to_name',
      header: 'Assigned To',
      render: (row: WorkOrderRow) => firstRelation(row.profiles)?.full_name ?? 'Unassigned',
    },
    {
      key: 'age',
      header: filter === 'completed' ? 'Duration' : 'Age',
      sortable: true,
      render: (row: WorkOrderRow) => timelineLabel(row),
    },
    {
      key: 'blocker',
      header: 'Blocker',
      render: (row: WorkOrderRow) => row.status === 'on_hold' ? (row.closure_notes ?? 'On hold') : row.external_vendor_name ? `Vendor: ${row.external_vendor_name}` : '—',
    },
    {
      key: 'next_action',
      header: 'Next Action',
      render: (row: WorkOrderRow) => {
        const action = nextAction(row, canManageMaintenance);
        return (
          <div className="flex flex-wrap gap-1.5">
            <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={action.href}>
              {action.label}
            </Link>
            {canManageMaintenance && row.status === 'assigned' && (
              <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={workOrderDetail(row.id, 'reassign')}>
                Reassign
              </Link>
            )}
            {canManageMaintenance && row.status === 'in_progress' && (
              <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={workOrderDetail(row.id, 'add-event')}>
                Add Event
              </Link>
            )}
          </div>
        );
      },
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
    <div className="space-y-6">
      <PageHeader
        title="Work Orders"
        description="Technical execution center for open, assigned, blocked, and completed biomedical work."
        breadcrumbs={[{ label: 'Command Center', href: ROUTES.COMMAND }, { label: 'Work Orders' }]}
        actions={
          canManageMaintenance ? (
            <Link href={`${ROUTES.MAINTENANCE_WORK_ORDERS}/new`}>
              <Button size="sm">
                <Wrench className="h-4 w-4" />
                New Work Order
              </Button>
            </Link>
          ) : <Badge variant="info">Read-only</Badge>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active Work Orders" value={summary.open} icon={<Wrench className="h-6 w-6" />} color="blue" active={filter === 'active'} onClick={() => setFilter('active')} />
        <StatCard label="Unassigned" value={summary.unassigned} icon={<UserPlus className="h-6 w-6" />} color="yellow" active={filter === 'unassigned'} onClick={() => setFilter('unassigned')} />
        <StatCard label="Assigned" value={summary.assigned} icon={<Clock className="h-6 w-6" />} color="purple" active={filter === 'assigned'} onClick={() => setFilter('assigned')} />
        <StatCard label="In Progress" value={summary.inProgress} icon={<Clock className="h-6 w-6" />} color="orange" active={filter === 'in_progress'} onClick={() => setFilter('in_progress')} />
        <StatCard label="On Hold" value={summary.onHold} icon={<AlertTriangle className="h-6 w-6" />} color="red" active={filter === 'on_hold'} onClick={() => setFilter('on_hold')} />
        <StatCard label="Overdue Active" value={summary.overdueActive} icon={<CalendarClock className="h-6 w-6" />} color="orange" active={filter === 'overdue'} onClick={() => setFilter('overdue')} />
        <StatCard label="Critical/High Active Work" value={summary.criticalHigh} icon={<AlertTriangle className="h-6 w-6" />} color="red" active={filter === 'critical-active'} onClick={() => setFilter('critical-active')} />
        <StatCard label="Completed This Month" value={summary.completedMonth} icon={<CheckCircle className="h-6 w-6" />} color="green" active={filter === 'completed'} onClick={() => setFilter('completed')} />
      </div>

      {activeQueue.length > 0 && (
        <section className="panel-surface rounded-lg p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">Active Work Queue</h2>
          <p className="text-sm text-[var(--text-muted)]">Ordered by overdue active work, critical/high priority, unassigned work, in-progress work, then assigned work.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setFilter('active')}>Show Active</Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {activeQueue.map((row) => {
              const asset = firstRelation(row.equipment_assets);
              const action = nextAction(row, canManageMaintenance);
              return (
                <Link key={row.id} href={action.href} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 transition hover:border-[var(--brand)]/50">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--foreground)]">{row.work_order_number}</p>
                    <UrgencyBadge urgency={row.priority} />
                  </div>
                  <p className="mt-2 text-sm text-[var(--foreground)]">{asset?.asset_code ?? 'Unknown asset'}</p>
                  <p className="truncate text-xs text-[var(--text-muted)]">{asset?.name ?? 'No asset context'}</p>
                  <div className="mt-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
                    <span>{timelineLabel(row)}</span>
                    <span className="font-medium text-[var(--brand)]">{action.label}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${filter === item.id ? 'border-[var(--brand)] bg-[var(--surface-2)] text-[var(--foreground)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--brand)]/50'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <DataTable<WorkOrderRow>
        columns={columns}
        data={filteredRows}
        searchPlaceholder="Search work orders..."
        emptyMessage="No work orders found for this filter"
        pageSize={25}
      />
    </div>
  );
}
