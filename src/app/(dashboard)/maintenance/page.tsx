'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Wrench, ClipboardList } from 'lucide-react';
import { PageHeader, DataTable, Tabs, Button, Spinner } from '@/components/ui';
import { UrgencyBadge, WorkOrderStatusBadge, RequestStatusBadge } from '@/components/ui/StatusBadge';
import { getMaintenanceRequests, getWorkOrders } from '@/services/maintenance.service';
import { useToast } from '@/components/ui/Toast';
import type { MaintenanceRequest, WorkOrder } from '@/types/database';

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

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function safeDisplay(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f-]{32,36}$/i.test(value) ? null : value;
}

export default function MaintenancePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [reqRes, woRes] = await Promise.all([
        getMaintenanceRequests(),
        getWorkOrders(),
      ]);
      if (reqRes.error) toast('error', 'Failed to load maintenance requests');
      if (woRes.error) toast('error', 'Failed to load work orders');
      setRequests((reqRes.data ?? []) as unknown as RequestRow[]);
      setWorkOrders((woRes.data ?? []) as unknown as WorkOrderRow[]);
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
      render: (row: RequestRow) =>
        row.fault_description.length > 60
          ? `${row.fault_description.slice(0, 60)}…`
          : row.fault_description,
      className: 'max-w-[280px]',
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
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Maintenance' }]}
      />

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
