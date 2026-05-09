'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Play, Pause, CheckCircle, XCircle, UserPlus, Plus, WifiOff, RefreshCcw,
} from 'lucide-react';
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, CardFooter,
  Button, Modal, Table, Input, Select, Textarea, Spinner, Badge,
} from '@/components/ui';
import { UrgencyBadge, WorkOrderStatusBadge } from '@/components/ui/StatusBadge';
import {
  getWorkOrderById, getMaintenanceEvents,
} from '@/services/maintenance.service';
import { assignWorkOrder, createMaintenanceEventAction, reassignWorkOrder, updateWorkOrderAction } from '@/actions/maintenance.actions';
import { syncOfflineWorkOrderActionsAction } from '@/actions/offline-sync.actions';
import { enqueueOfflineAction, getOfflineQueue, markOfflineActionFailed, removeOfflineAction, type OfflineWorkOrderAction } from '@/lib/offline/technician-queue';
import { getAll } from '@/services/settings.service';
import { getActiveTechnicians } from '@/services/users.service';
import { useToast } from '@/components/ui/Toast';
import { AskAiButton } from '@/components/assistant/AskAiButton';
import { useRole } from '@/hooks/useRole';
import type {
  WorkOrder, WorkOrderStatus, MaintenanceEvent, FailureCode, MaintenanceActionCode, Profile,
} from '@/types/database';

type WOWithJoins = WorkOrder & {
  equipment_assets?: { id: string; asset_code: string; name: string };
  profiles?: { id: string; full_name: string; email: string };
};

type EventWithJoins = MaintenanceEvent & {
  failure_codes?: { id: string; code: string; description: string };
  maintenance_action_codes?: { id: string; code: string; description: string };
  [key: string]: unknown;
};

const emptyEventForm = {
  event_type: 'corrective' as const,
  failure_date: '',
  downtime_start: '',
  downtime_end: '',
  repair_duration_hours: '',
  action_taken: '',
  failure_code_id: '',
  action_code_id: '',
  service_cost: '',
  notes: '',
};

export default function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { isDeveloper, isAdmin, isBmeHead } = useRole();
  const canManageAssignment = isDeveloper || isAdmin || isBmeHead;

  const [wo, setWO] = useState<WOWithJoins | null>(null);
  const [events, setEvents] = useState<EventWithJoins[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [technicians, setTechnicians] = useState<Profile[]>([]);
  const [selectedTechnician, setSelectedTechnician] = useState('');
  const [assignmentMode, setAssignmentMode] = useState<'assign' | 'reassign'>('assign');

  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [failureCodes, setFailureCodes] = useState<FailureCode[]>([]);
  const [actionCodes, setActionCodes] = useState<MaintenanceActionCode[]>([]);
  const [queuedActions, setQueuedActions] = useState<OfflineWorkOrderAction[]>([]);

  const refreshQueuedActions = useCallback(() => {
    setQueuedActions(getOfflineQueue().filter((item) => item.workOrderId === id));
  }, [id]);

  const loadWO = useCallback(async () => {
    const { data, error } = await getWorkOrderById(id);
    if (error || !data) {
      toast('error', 'Failed to load work order');
      return;
    }
    setWO(data as unknown as WOWithJoins);
  }, [id, toast]);

  const loadEvents = useCallback(async (assetId: string) => {
    const { data } = await getMaintenanceEvents(assetId);
    if (data) setEvents(data as unknown as EventWithJoins[]);
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const { data, error } = await getWorkOrderById(id);
      if (error || !data) {
        toast('error', 'Failed to load work order');
        setLoading(false);
        return;
      }
      const woData = data as unknown as WOWithJoins;
      setWO(woData);
      await loadEvents(woData.asset_id);
      refreshQueuedActions();
      setLoading(false);
    }
    init();
  }, [id, toast, loadEvents, refreshQueuedActions]);

  async function handleStatusUpdate(status: WorkOrderStatus) {
    if (!wo) return;
    setActionLoading(true);
    const updates: Record<string, unknown> = { status };
    if (status === 'in_progress' && !wo.started_at) updates.started_at = new Date().toISOString();
    if (status === 'completed') updates.completed_at = new Date().toISOString();

    const result = await updateWorkOrderAction(id, updates);
    if (!result.success) {
      toast('error', result.error ?? `Failed to update work order`);
    } else {
      toast('success', `Work order ${status.replace(/_/g, ' ')}`);
      await loadWO();
    }
    setActionLoading(false);
  }

  function queueStatusUpdate(status: WorkOrderStatus) {
    enqueueOfflineAction({
      type: 'update_status',
      workOrderId: id,
      payload: { status, queued_at: new Date().toISOString() },
    });
    refreshQueuedActions();
    toast('success', 'Status update queued for sync');
  }

  async function syncQueuedActions() {
    const queue = getOfflineQueue().filter((item) => item.workOrderId === id);
    if (queue.length === 0) {
      toast('info', 'No queued actions for this work order');
      return;
    }

    setActionLoading(true);
    const result = await syncOfflineWorkOrderActionsAction(queue);
    const results = result.data ?? [];
    const failedActions = results.filter((item) => item.status === 'failed').length;
    for (const item of results) {
      if (item.status === 'synced' || item.status === 'skipped') removeOfflineAction(item.id);
      if (item.status === 'failed') markOfflineActionFailed(item.id, item.error ?? 'Sync failed');
    }
    await loadWO();
    refreshQueuedActions();
    if (failedActions > 0) {
      toast('warning', `${failedActions} queued action(s) failed to sync`);
    } else {
      toast('success', 'Queued actions synchronized');
    }
    setActionLoading(false);
  }

  const openAssignModal = useCallback(async (mode?: 'assign' | 'reassign') => {
    if (!canManageAssignment) {
      toast('warning', 'Only BME Head, admin, or developer roles can assign work orders');
      return;
    }
    const nextMode = mode ?? (wo?.assigned_to ? 'reassign' : 'assign');
    setAssignmentMode(nextMode);
    setSelectedTechnician(wo?.assigned_to ?? '');
    if (technicians.length === 0) {
      const { data } = await getActiveTechnicians();
      if (data) setTechnicians(data as unknown as Profile[]);
    }
    setAssignModalOpen(true);
  }, [canManageAssignment, technicians.length, toast, wo?.assigned_to]);

  useEffect(() => {
    const requestedAction = searchParams.get('action');
    if (!wo || !canManageAssignment || (requestedAction !== 'assign' && requestedAction !== 'reassign')) return;
    const timer = setTimeout(() => {
      void openAssignModal(requestedAction);
    }, 0);
    return () => clearTimeout(timer);
  }, [canManageAssignment, openAssignModal, searchParams, wo]);

  async function handleAssign() {
    if (!selectedTechnician) return;
    if (!wo) return;
    setActionLoading(true);
    const result = wo.assigned_to
      ? await reassignWorkOrder(id, selectedTechnician)
      : await assignWorkOrder(id, selectedTechnician);
    if (!result.success) {
      toast('error', result.error ?? `Failed to ${wo.assigned_to ? 'reassign' : 'assign'} work order`);
    } else {
      toast('success', `Work order ${wo.assigned_to ? 'reassigned' : 'assigned'}`);
      setAssignModalOpen(false);
      await loadWO();
    }
    setActionLoading(false);
  }

  async function openEventModal() {
    const [fcRes, acRes] = await Promise.all([
      failureCodes.length === 0 ? getAll('failure_codes') : { data: failureCodes },
      actionCodes.length === 0 ? getAll('maintenance_action_codes') : { data: actionCodes },
    ]);
    if (fcRes.data) setFailureCodes(fcRes.data as unknown as FailureCode[]);
    if (acRes.data) setActionCodes(acRes.data as unknown as MaintenanceActionCode[]);
    setEventForm(emptyEventForm);
    setEventModalOpen(true);
  }

  async function handleCreateEvent() {
    if (!wo) return;
    setActionLoading(true);
    const result = await createMaintenanceEventAction({
      work_order_id: wo.id,
      asset_id: wo.asset_id,
      event_type: eventForm.event_type,
      failure_date: eventForm.failure_date || null,
      downtime_start: eventForm.downtime_start || null,
      downtime_end: eventForm.downtime_end || null,
      repair_duration_hours: eventForm.repair_duration_hours ? Number(eventForm.repair_duration_hours) : null,
      action_taken: eventForm.action_taken || null,
      failure_code_id: eventForm.failure_code_id || null,
      action_code_id: eventForm.action_code_id || null,
      service_cost: eventForm.service_cost ? Number(eventForm.service_cost) : null,
      notes: eventForm.notes || null,
      completed_by: null,
      completion_date: null,
    });
    if (!result.success) {
      toast('error', result.error ?? 'Failed to log event');
    } else {
      toast('success', 'Maintenance event logged');
      setEventModalOpen(false);
      await loadEvents(wo.asset_id);
    }
    setActionLoading(false);
  }

  if (loading || !wo) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const isTerminal = wo.status === 'completed' || wo.status === 'canceled';
  const requestedAction = searchParams.get('action');

  const eventColumns = [
    {
      key: 'event_type',
      header: 'Type',
      render: (row: EventWithJoins) =>
        row.event_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    },
    {
      key: 'failure_date',
      header: 'Failure Date',
      render: (row: EventWithJoins) =>
        row.failure_date ? new Date(row.failure_date).toLocaleDateString() : '—',
    },
    {
      key: 'repair_duration_hours',
      header: 'Repair (hrs)',
      render: (row: EventWithJoins) => row.repair_duration_hours ?? '—',
    },
    {
      key: 'failure_code',
      header: 'Failure Code',
      render: (row: EventWithJoins) => row.failure_codes?.code ?? '—',
    },
    {
      key: 'action_code',
      header: 'Action Code',
      render: (row: EventWithJoins) => row.maintenance_action_codes?.code ?? '—',
    },
    {
      key: 'service_cost',
      header: 'Cost',
      render: (row: EventWithJoins) =>
        row.service_cost != null ? `$${row.service_cost.toFixed(2)}` : '—',
    },
    {
      key: 'action_taken',
      header: 'Action Taken',
      render: (row: EventWithJoins) =>
        row.action_taken
          ? row.action_taken.length > 50
            ? `${row.action_taken.slice(0, 50)}…`
            : row.action_taken
          : '—',
      className: 'max-w-[200px]',
    },
  ];

  return (
    <div>
      <PageHeader
        title={wo.work_order_number}
        description="Work Order"
        breadcrumbs={[
          { label: 'Command Center', href: '/command' },
          { label: 'Maintenance', href: '/maintenance' },
          { label: wo.work_order_number },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <AskAiButton
              moduleLabel="Maintenance"
              label="Summarize with AI"
              seedPrompt="Summarize this work order and propose safe next troubleshooting or escalation steps."
              contextRefs={{ workOrderId: id, equipmentId: wo.asset_id }}
            />
            <Button variant="outline" size="sm" onClick={() => router.push('/maintenance')}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Work Order Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Asset</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {wo.equipment_assets
                    ? `${wo.equipment_assets.asset_code} — ${wo.equipment_assets.name}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Assigned To</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {wo.profiles?.full_name ?? 'Unassigned'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Priority</dt>
                <dd className="mt-1"><UrgencyBadge urgency={wo.priority} /></dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</dt>
                <dd className="mt-1"><WorkOrderStatusBadge status={wo.status} /></dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Work Type</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {wo.work_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">External Vendor</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {wo.external_vendor ? wo.external_vendor_name || 'Yes' : 'No'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Estimated Hours</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {wo.estimated_hours ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Actual Hours</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {wo.actual_hours ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Created</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {new Date(wo.created_at).toLocaleString()}
                </dd>
              </div>
              {wo.started_at && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Started</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {new Date(wo.started_at).toLocaleString()}
                  </dd>
                </div>
              )}
              {wo.completed_at && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Completed</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {new Date(wo.completed_at).toLocaleString()}
                  </dd>
                </div>
              )}
              {wo.root_cause && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Root Cause</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900 dark:text-white">
                    {wo.root_cause}
                  </dd>
                </div>
              )}
              {wo.closure_notes && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Closure Notes</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900 dark:text-white">
                    {wo.closure_notes}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
          {!isTerminal && (
            <CardFooter>
              <div className="flex flex-wrap gap-2">
                {canManageAssignment && (
                  <Button size="sm" variant="outline" onClick={() => void openAssignModal(wo.assigned_to ? 'reassign' : 'assign')} loading={actionLoading}>
                    <UserPlus className="h-4 w-4" />
                    {wo.assigned_to ? 'Reassign' : 'Assign'}
                  </Button>
                )}
                {(wo.status === 'assigned' || wo.status === 'on_hold') && (
                  <Button size="sm" onClick={() => handleStatusUpdate('in_progress')} loading={actionLoading}>
                    <Play className="h-4 w-4" />
                    Start
                  </Button>
                )}
                {wo.status === 'in_progress' && (
                  <Button size="sm" variant="secondary" onClick={() => handleStatusUpdate('on_hold')} loading={actionLoading}>
                    <Pause className="h-4 w-4" />
                    Hold
                  </Button>
                )}
                {(wo.status === 'in_progress' || wo.status === 'assigned') && (
                  <Button size="sm" onClick={() => handleStatusUpdate('completed')} loading={actionLoading}>
                    <CheckCircle className="h-4 w-4" />
                    Complete
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => queueStatusUpdate('in_progress')}>
                  <WifiOff className="h-4 w-4" />
                  Queue Offline Start
                </Button>
                <Button size="sm" variant="outline" onClick={syncQueuedActions} loading={actionLoading}>
                  <RefreshCcw className="h-4 w-4" />
                  Sync Queue ({queuedActions.length})
                </Button>
                {!isTerminal && (
                  <Button size="sm" variant="destructive" onClick={() => handleStatusUpdate('canceled')} loading={actionLoading}>
                    <XCircle className="h-4 w-4" />
                    Cancel
                  </Button>
                )}
              </div>
            </CardFooter>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assignment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">
                  {wo.profiles?.full_name ?? 'Unassigned'}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {wo.profiles?.email ?? (wo.assigned_to ? 'Assigned technician profile' : 'No technician assigned yet')}
                </p>
                {requestedAction === 'resolve-blocker' && wo.status === 'on_hold' && (
                  <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    This work order is on hold. Review blocker notes/events, then start work again when the blocker is resolved.
                  </p>
                )}
              </div>
              {!isTerminal && canManageAssignment && (
                <Button size="sm" onClick={() => void openAssignModal(wo.assigned_to ? 'reassign' : 'assign')} loading={actionLoading}>
                  <UserPlus className="h-4 w-4" />
                  {wo.assigned_to ? 'Reassign Technician' : 'Assign Technician'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {queuedActions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Pending Offline Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-[var(--border-subtle)]">
                {queuedActions.map((action) => (
                  <div key={action.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-[var(--foreground)]">{action.type.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {new Date(action.createdAt).toLocaleString()}
                        {action.retryCount ? ` · retries ${action.retryCount}` : ''}
                        {action.lastError ? ` · ${action.lastError}` : ''}
                      </p>
                    </div>
                    <Badge variant={action.lastError ? 'warning' : 'info'}>{action.lastError ? 'Retry needed' : 'Pending'}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Maintenance Event Log */}
        <Card>
          <CardHeader>
            <CardTitle>Maintenance Events</CardTitle>
            {!isTerminal && (
              <Button size="sm" onClick={openEventModal}>
                <Plus className="h-4 w-4" />
                Log Event
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <Table<EventWithJoins>
              columns={eventColumns}
              data={events}
              emptyMessage="No maintenance events logged"
            />
          </CardContent>
        </Card>
      </div>

      {/* Assign Modal */}
      <Modal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title={assignmentMode === 'reassign' ? 'Reassign Technician' : 'Assign Technician'}
        footer={
          <>
            <Button variant="outline" onClick={() => setAssignModalOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign} loading={actionLoading} disabled={!selectedTechnician}>
              {assignmentMode === 'reassign' ? 'Reassign' : 'Assign'}
            </Button>
          </>
        }
      >
        {wo?.assigned_to && (
          <div className="mb-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-sm">
            <p className="text-xs text-[var(--text-muted)]">Current technician</p>
            <p className="font-medium text-[var(--foreground)]">{wo.profiles?.full_name ?? 'Assigned technician'}</p>
          </div>
        )}
        <Select
          label="Technician"
          placeholder="Select a technician"
          value={selectedTechnician}
          onChange={(e) => setSelectedTechnician(e.target.value)}
          options={technicians.map((t) => ({ value: t.id, label: `${t.full_name}${t.email ? ` · ${t.email}` : ''}` }))}
        />
        {technicians.length === 0 && (
          <p className="mt-2 text-xs text-amber-300">No active technician profiles were found.</p>
        )}
      </Modal>

      {/* Log Event Modal */}
      <Modal
        open={eventModalOpen}
        onClose={() => setEventModalOpen(false)}
        title="Log Maintenance Event"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEventModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateEvent} loading={actionLoading}>Save Event</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Event Type"
            value={eventForm.event_type}
            onChange={(e) => setEventForm({ ...eventForm, event_type: e.target.value as typeof eventForm.event_type })}
            options={[
              { value: 'corrective', label: 'Corrective' },
              { value: 'preventive', label: 'Preventive' },
              { value: 'inspection', label: 'Inspection' },
              { value: 'emergency', label: 'Emergency' },
            ]}
          />
          <Input
            label="Failure Date"
            type="date"
            value={eventForm.failure_date}
            onChange={(e) => setEventForm({ ...eventForm, failure_date: e.target.value })}
          />
          <Input
            label="Downtime Start"
            type="datetime-local"
            value={eventForm.downtime_start}
            onChange={(e) => setEventForm({ ...eventForm, downtime_start: e.target.value })}
          />
          <Input
            label="Downtime End"
            type="datetime-local"
            value={eventForm.downtime_end}
            onChange={(e) => setEventForm({ ...eventForm, downtime_end: e.target.value })}
          />
          <Input
            label="Repair Duration (hours)"
            type="number"
            step="0.5"
            value={eventForm.repair_duration_hours}
            onChange={(e) => setEventForm({ ...eventForm, repair_duration_hours: e.target.value })}
          />
          <Input
            label="Service Cost ($)"
            type="number"
            step="0.01"
            value={eventForm.service_cost}
            onChange={(e) => setEventForm({ ...eventForm, service_cost: e.target.value })}
          />
          <Select
            label="Failure Code"
            placeholder="Select failure code"
            value={eventForm.failure_code_id}
            onChange={(e) => setEventForm({ ...eventForm, failure_code_id: e.target.value })}
            options={failureCodes.map((fc) => ({ value: fc.id, label: `${fc.code} — ${fc.description}` }))}
          />
          <Select
            label="Action Code"
            placeholder="Select action code"
            value={eventForm.action_code_id}
            onChange={(e) => setEventForm({ ...eventForm, action_code_id: e.target.value })}
            options={actionCodes.map((ac) => ({ value: ac.id, label: `${ac.code} — ${ac.description}` }))}
          />
          <div className="sm:col-span-2">
            <Textarea
              label="Action Taken"
              value={eventForm.action_taken}
              onChange={(e) => setEventForm({ ...eventForm, action_taken: e.target.value })}
              placeholder="Describe the action taken…"
            />
          </div>
          <div className="sm:col-span-2">
            <Textarea
              label="Notes"
              value={eventForm.notes}
              onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })}
              placeholder="Additional notes…"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
