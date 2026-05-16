'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, CheckCircle, Clock, UserPlus, Wrench } from 'lucide-react';
import { PageHeader, DataTable, Button, Spinner, StatCard, Badge } from '@/components/ui';
import ClearFiltersButton from '@/components/ui/ClearFiltersButton';
import { UrgencyBadge, WorkOrderStatusBadge } from '@/components/ui/StatusBadge';
import { getWorkOrders } from '@/services/maintenance.service';
import { getPMSchedules } from '@/services/pm.service';
import { getCalibrationRequests, getUpcomingCalibrations } from '@/services/calibration.service';
import { useToast } from '@/components/ui/Toast';
import { useRole } from '@/hooks/useRole';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  formatCacheAge,
  getOfflineReadCache,
  saveOfflineReadCache,
  type OfflineCacheScope,
} from '@/lib/offline/cache';
import { CloudOff } from 'lucide-react';
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
type UnifiedTask = {
  id: string;
  type: 'Corrective' | 'PM' | 'Calibration';
  asset: string;
  department: string;
  priority: string;
  status: string;
  ageDue: string;
  why: string;
  actionLabel: string;
  href: string;
};

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
  const { canManageMaintenance, isTechnician, primaryRole } = useRole();
  const { user } = useAuth();
  const { profile } = useProfile(user?.id);
  const online = useOnlineStatus();
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [unifiedTasks, setUnifiedTasks] = useState<UnifiedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [cacheState, setCacheState] = useState<{ cachedAt: string; isStale: boolean; fromCache: boolean } | null>(null);
  const [filter, setFilter] = useState<FilterId>(() => {
    const requested = searchParams.get('filter') as FilterId | null;
    return requested && FILTERS.some((item) => item.id === requested) ? requested : 'active';
  });

  const profileId = profile?.id ?? null;
  const technicianScope: OfflineCacheScope | null = useMemo(() => (
    isTechnician && profileId ? { profileId, roleName: primaryRole, departmentId: profile?.department_id ?? null } : null
  ), [isTechnician, primaryRole, profile?.department_id, profileId]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      let loadedWorkOrders: WorkOrderRow[] = [];
      let pmRes: Awaited<ReturnType<typeof getPMSchedules>> | null = null;
      let calRequestRes: Awaited<ReturnType<typeof getCalibrationRequests>> | null = null;
      let calDueRes: Awaited<ReturnType<typeof getUpcomingCalibrations>> | null = null;
      try {
        const [workOrderRes, pmResLocal, calRequestResLocal, calDueResLocal] = await Promise.all([
          getWorkOrders(),
          getPMSchedules(),
          getCalibrationRequests(),
          getUpcomingCalibrations(90),
        ]);
        const { data, error } = workOrderRes;
        if (error) toast('error', 'Failed to load work orders');
        loadedWorkOrders = (data ?? []) as unknown as WorkOrderRow[];
        pmRes = pmResLocal;
        calRequestRes = calRequestResLocal;
        calDueRes = calDueResLocal;
        setWorkOrders(loadedWorkOrders);
        if (technicianScope && profileId) {
          const assigned = loadedWorkOrders.filter((row) => row.assigned_to === profileId);
          void saveOfflineReadCache('technician.assigned_work', assigned, technicianScope, { sourceRoute: '/work-orders' });
          setCacheState({ cachedAt: new Date().toISOString(), isStale: false, fromCache: false });
        }
      } catch (error) {
        if (technicianScope) {
          const cached = await getOfflineReadCache<WorkOrderRow[]>('technician.assigned_work', technicianScope);
          if (cached) {
            setWorkOrders(cached.data);
            setUnifiedTasks([]);
            setCacheState({ cachedAt: cached.cachedAt, isStale: cached.isStale, fromCache: true });
            setLoading(false);
            return;
          }
        }
        toast('error', error instanceof Error ? error.message : 'Failed to load work orders');
        setLoading(false);
        return;
      }
      if (!pmRes || !calRequestRes || !calDueRes) {
        setLoading(false);
        return;
      }
      const pmRows = (pmRes.data ?? []) as Array<Record<string, unknown>>;
      const calRequests = (calRequestRes.data ?? []) as Array<Record<string, unknown>>;
      const calDue = (calDueRes.data ?? []) as Array<Record<string, unknown>>;
      const calRequestByAsset = new Set(calRequests.filter((row) => ['pending', 'approved', 'in_progress'].includes(String(row.status ?? ''))).map((row) => String(row.asset_id ?? '')));

      const correctiveTasks: UnifiedTask[] = loadedWorkOrders
        .filter(isActiveWork)
        .slice(0, 8)
        .map((row) => {
          const asset = firstRelation(row.equipment_assets);
          const action = nextAction(row, canManageMaintenance);
          return {
            id: `wo-${row.id}`,
            type: 'Corrective',
            asset: `${asset?.asset_code ?? 'WO'} — ${asset?.name ?? 'Unknown asset'}`,
            department: 'Maintenance',
            priority: row.priority,
            status: row.status,
            ageDue: timelineLabel(row),
            why: isOverdueActive(row) ? 'Active work older than 7 days' : row.assigned_to ? 'Assigned corrective execution' : 'Needs assignment',
            actionLabel: action.label,
            href: action.href,
          };
        });
      const pmTasks: UnifiedTask[] = pmRows
        .filter((row) => ['scheduled', 'in_progress', 'overdue', 'deferred'].includes(String(row.status ?? '')))
        .slice(0, 8)
        .map((row) => {
          const asset = row.equipment_assets as { asset_code?: string; name?: string; departments?: { name?: string } | null; equipment_categories?: { criticality_level?: string | null } | null } | null;
          const status = String(row.status ?? 'scheduled');
          return {
            id: `pm-${row.id as string}`,
            type: 'PM',
            asset: `${asset?.asset_code ?? 'PM'} — ${asset?.name ?? 'Unknown asset'}`,
            department: asset?.departments?.name ?? 'No department',
            priority: asset?.equipment_categories?.criticality_level === 'critical' ? 'critical' : status === 'overdue' ? 'high' : 'medium',
            status,
            ageDue: row.scheduled_date ? `Due ${new Date(row.scheduled_date as string).toLocaleDateString()}` : 'No due date',
            why: status === 'overdue' ? 'Preventive maintenance is overdue' : 'Scheduled PM execution task',
            actionLabel: status === 'scheduled' ? 'Start PM Task' : status === 'in_progress' ? 'Complete PM Task' : 'Open PM Task',
            href: `/pm/schedules/${row.id as string}`,
          };
        });
      const calibrationRequestTasks: UnifiedTask[] = calRequests
        .filter((row) => ['pending', 'approved', 'in_progress'].includes(String(row.status ?? '')))
        .slice(0, 8)
        .map((row) => {
          const asset = row.equipment_assets as { asset_code?: string; name?: string; departments?: { name?: string } | null; equipment_categories?: { criticality_level?: string | null } | null } | null;
          const status = String(row.status ?? 'pending');
          return {
            id: `cal-request-${row.id as string}`,
            type: 'Calibration',
            asset: `${asset?.asset_code ?? 'CAL'} — ${asset?.name ?? 'Unknown asset'}`,
            department: asset?.departments?.name ?? 'No department',
            priority: String(row.urgency ?? asset?.equipment_categories?.criticality_level ?? 'medium'),
            status,
            ageDue: row.created_at ? `${ageDays({ created_at: row.created_at, status: 'open', priority: 'medium' } as WorkOrderRow)}d open` : 'Open request',
            why: status === 'pending' ? 'Calibration request needs review' : status === 'approved' ? 'Approved calibration needs scheduling' : 'Calibration is in progress',
            actionLabel: status === 'pending' ? 'Review Request' : status === 'approved' ? 'Schedule Calibration' : 'Record Calibration Result',
            href: `/calibration/requests/${row.id as string}${status === 'approved' ? '?action=schedule' : ''}`,
          };
        });
      const calibrationDueTasks: UnifiedTask[] = calDue
        .filter((row) => {
          const due = row.next_due_date ? new Date(row.next_due_date as string).getTime() : Infinity;
          return due <= Date.now() && !calRequestByAsset.has(String(row.asset_id ?? ''));
        })
        .slice(0, 6)
        .map((row) => {
          const asset = row.equipment_assets as { id?: string; asset_code?: string; name?: string; departments?: { name?: string } | null; equipment_categories?: { criticality_level?: string | null } | null } | null;
          return {
            id: `cal-due-${row.id as string}`,
            type: 'Calibration',
            asset: `${asset?.asset_code ?? 'CAL'} — ${asset?.name ?? 'Unknown asset'}`,
            department: asset?.departments?.name ?? 'No department',
            priority: asset?.equipment_categories?.criticality_level === 'critical' ? 'critical' : 'high',
            status: 'overdue',
            ageDue: row.next_due_date ? `Due ${new Date(row.next_due_date as string).toLocaleDateString()}` : 'Due date missing',
            why: 'Overdue calibration has no open workflow',
            actionLabel: 'Create Calibration Request',
            href: `/calibration/requests/new?assetId=${String(row.asset_id ?? asset?.id ?? '')}&calibrationTypeId=${String(row.calibration_type_id ?? '')}&source=work-execution-overdue`,
          };
        });
      setUnifiedTasks([...correctiveTasks, ...pmTasks, ...calibrationRequestTasks, ...calibrationDueTasks]
        .sort((a, b) => priorityRank({ priority: a.priority } as WorkOrderRow) - priorityRank({ priority: b.priority } as WorkOrderRow))
        .slice(0, 12));
      setLoading(false);
    }
    void load();
  }, [canManageMaintenance, profileId, technicianScope, toast]);

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
        const isActive = ['open', 'assigned', 'in_progress', 'on_hold'].includes(row.status);
        const primaryCls = isActive
          ? 'rounded-lg bg-[var(--brand)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--brand-strong)]'
          : 'rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]';
        return (
          <div className="flex flex-wrap gap-1.5">
            <Link className={primaryCls} href={action.href}>
              {action.label}
            </Link>
            {canManageMaintenance && row.status === 'assigned' && (
              <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={workOrderDetail(row.id, 'reassign')}>
                Reassign
              </Link>
            )}
            {canManageMaintenance && row.status === 'in_progress' && (
              <Link className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-400 hover:bg-amber-500/20" href={`/maintenance/work-orders/${row.id}/events/new`}>
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

      {(cacheState?.fromCache || !online.isOnline) && cacheState && isTechnician && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Offline cached data — may be stale</p>
            <p className="mt-0.5">Showing your last-cached assigned work. Last synced {formatCacheAge(cacheState.cachedAt).toLowerCase()}. Reconnect to refresh and see all active work.</p>
            {cacheState.isStale && <p className="mt-0.5">Cache exceeds the 12-hour freshness window; verify before acting on critical workflows.</p>}
          </div>
        </div>
      )}

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

      {unifiedTasks.length > 0 && (
        <section className="panel-surface rounded-lg p-4">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Unified Work Execution Queue</h2>
            <p className="text-sm text-[var(--text-muted)]">Corrective work orders, PM tasks, and calibration work are normalized here so this page is an execution surface, not only corrective maintenance.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-xs uppercase text-[var(--text-muted)]">
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Asset</th>
                  <th className="py-2 pr-4">Department</th>
                  <th className="py-2 pr-4">Priority</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Due / Age</th>
                  <th className="py-2 pr-4">Why</th>
                  <th className="py-2">Next Action</th>
                </tr>
              </thead>
              <tbody>
                {unifiedTasks.map((task) => (
                  <tr key={task.id} className="border-b border-[var(--border-subtle)]/60">
                    <td className="py-3 pr-4"><Badge variant={task.type === 'Corrective' ? 'warning' : task.type === 'PM' ? 'info' : 'purple'}>{task.type}</Badge></td>
                    <td className="py-3 pr-4 font-medium text-[var(--foreground)]">{task.asset}</td>
                    <td className="py-3 pr-4 text-[var(--text-muted)]">{task.department}</td>
                    <td className="py-3 pr-4"><UrgencyBadge urgency={task.priority as WorkOrderRow['priority']} /></td>
                    <td className="py-3 pr-4 text-[var(--text-muted)]">{task.status.replace(/_/g, ' ')}</td>
                    <td className="py-3 pr-4 text-[var(--text-muted)]">{task.ageDue}</td>
                    <td className="py-3 pr-4 text-[var(--text-muted)]">{task.why}</td>
                    <td className="py-3"><Link className="rounded-lg bg-[var(--brand)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--brand-strong)]" href={task.href}>{task.actionLabel}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            aria-pressed={filter === item.id}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${filter === item.id ? 'border-[var(--brand)] bg-[var(--surface-2)] text-[var(--foreground)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--brand)]/50'}`}
          >
            {item.label}
          </button>
        ))}
        {filter !== 'active' && (
          <ClearFiltersButton onClick={() => setFilter('active')} />
        )}
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
