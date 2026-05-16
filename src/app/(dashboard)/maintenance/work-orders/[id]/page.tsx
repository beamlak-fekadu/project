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
  getWorkOrderById, getMaintenanceEvents, getRequestById,
} from '@/services/maintenance.service';
import { getEquipmentById } from '@/services/equipment.service';
import { formatEquipmentCondition, getConditionBadgeClass } from '@/utils/equipment/condition-labels';
import { assignWorkOrder, createMaintenanceEventAction, reassignWorkOrder, updateWorkOrderAction } from '@/actions/maintenance.actions';
import { getOfflineQueue, runOfflineCapableAction } from '@/lib/offline/queue';
import { getAll } from '@/services/settings.service';
import { getActiveTechnicians, ASSIGNABLE_TECHNICIANS_EMPTY_STATE } from '@/services/users.service';
import { useToast } from '@/components/ui/Toast';
import { OfflineActionResult } from '@/components/offline/OfflineActionResult';
import OfflineSubmitBanner from '@/components/offline/OfflineSubmitBanner';
import { AskAiButton } from '@/components/assistant/AskAiButton';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useRole } from '@/hooks/useRole';
import { useOfflineSync } from '@/components/offline/SyncEngineProvider';
import type { OfflineActionRunResult, OfflineQueueRecord } from '@/types/offline';
import type {
  WorkOrder, WorkOrderStatus, MaintenanceEvent, FailureCode, MaintenanceActionCode, Profile,
} from '@/types/domain';

type WOWithJoins = WorkOrder & {
  equipment_assets?: { id: string; asset_code: string; name: string };
  profiles?: { id: string; full_name: string; email: string };
  completion_outcome?: string | null;
  final_equipment_condition?: string | null;
};

interface OriginatingRequest {
  id: string;
  request_number: string;
  fault_description: string;
  urgency: string;
  status: string;
  reported_condition?: string | null;
  reported_condition_source?: string | null;
}

interface EquipmentConditionSnap {
  condition: string;
}

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
  const { user } = useAuth();
  const { profile } = useProfile(user?.id);
  const { isDeveloper, isAdmin, isBmeHead, roles, primaryRole } = useRole();
  const { startSync } = useOfflineSync();
  const canManageAssignment = isDeveloper || isAdmin || isBmeHead;

  const [wo, setWO] = useState<WOWithJoins | null>(null);
  const [events, setEvents] = useState<EventWithJoins[]>([]);
  const [originatingRequest, setOriginatingRequest] = useState<OriginatingRequest | null>(null);
  const [equipmentCondition, setEquipmentCondition] = useState<EquipmentConditionSnap | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [technicians, setTechnicians] = useState<Profile[]>([]);
  const [selectedTechnician, setSelectedTechnician] = useState('');
  const [assignmentMode, setAssignmentMode] = useState<'assign' | 'reassign'>('assign');

  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [completionOutcome, setCompletionOutcome] = useState('resolved');
  const [finalCondition, setFinalCondition] = useState('functional');

  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [failureCodes, setFailureCodes] = useState<FailureCode[]>([]);
  const [actionCodes, setActionCodes] = useState<MaintenanceActionCode[]>([]);
  const [queuedActions, setQueuedActions] = useState<OfflineQueueRecord[]>([]);
  const [startIntentResult, setStartIntentResult] = useState<OfflineActionRunResult | null>(null);
  const [completionDraftResult, setCompletionDraftResult] = useState<OfflineActionRunResult | null>(null);
  const [eventOfflineResult, setEventOfflineResult] = useState<OfflineActionRunResult | null>(null);

  const refreshQueuedActions = useCallback(async () => {
    const queue = await getOfflineQueue();
    setQueuedActions(queue.filter((item) => item.entity_id === id || String(item.payload?.work_order_id ?? '') === id));
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

      // Load events, originating request, and current equipment condition in parallel
      const requestId = (woData as { request_id?: string | null }).request_id;
      await Promise.all([
        loadEvents(woData.asset_id),
        requestId
          ? getRequestById(requestId).then(({ data: reqData }) => {
              if (reqData) {
                const r = reqData as unknown as OriginatingRequest;
                setOriginatingRequest({
                  id: r.id,
                  request_number: r.request_number,
                  fault_description: r.fault_description,
                  urgency: r.urgency,
                  status: r.status,
                  reported_condition: r.reported_condition,
                  reported_condition_source: r.reported_condition_source,
                });
              }
            }).catch(() => undefined)
          : Promise.resolve(),
        getEquipmentById(woData.asset_id).then(({ data: eqData }) => {
          if (eqData) {
            const eq = eqData as unknown as { condition: string };
            setEquipmentCondition({ condition: eq.condition });
          }
        }).catch(() => undefined),
      ]);

      await refreshQueuedActions();
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

  // Outcome → default final condition mapping
  function outcomeToCondition(outcome: string): string {
    switch (outcome) {
      case 'resolved': return 'functional';
      case 'partially_resolved': return 'needs_repair';
      case 'not_resolved': return 'non_functional';
      case 'awaiting_parts_or_vendor': return 'under_maintenance';
      default: return 'functional';
    }
  }

  function openCompletionModal() {
    setCompletionOutcome('resolved');
    setFinalCondition('functional');
    setCompletionModalOpen(true);
  }

  async function handleCompleteWorkOrder() {
    if (!wo) return;
    setActionLoading(true);
    const result = await updateWorkOrderAction(id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      completion_outcome: completionOutcome,
      final_equipment_condition: finalCondition,
    });
    setActionLoading(false);
    if (!result.success) {
      toast('error', result.error ?? 'Failed to complete work order');
    } else {
      toast('success', 'Work order completed');
      setCompletionModalOpen(false);
      await loadWO();
    }
  }

  async function saveWorkStartIntent() {
    if (!wo) return;
    setActionLoading(true);
    const payload = {
      work_order_id: id,
      asset_id: wo.asset_id,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      note: 'Technician recorded intent to start work from offline-capable work order page.',
    };
    const result = await runOfflineCapableAction({
      actionType: 'work_order.start_intent',
      entityType: 'work_orders',
      entityId: id,
      assetId: wo.asset_id,
      payload,
      createdByProfileId: profile?.id ?? null,
      roleName: primaryRole,
      roleNames: roles,
      sourceRoute: typeof window !== 'undefined' ? window.location.pathname + window.location.search : `/maintenance/work-orders/${id}`,
      executeOnline: () => updateWorkOrderAction(id, {
        status: 'in_progress',
        started_at: payload.started_at,
      }),
      metadata: { form: 'work_order_detail_start_intent' },
    });
    setActionLoading(false);
    setStartIntentResult(result);
    await refreshQueuedActions();
    if (result.status === 'queued') {
      toast('success', 'Saved offline — will sync when connection returns.');
      return;
    }
    if (result.status === 'failed' || result.status === 'conflict') {
      toast('error', result.error ?? 'Failed to save start intent');
      return;
    }
    toast('success', 'Work started');
    await loadWO();
  }

  async function syncQueuedActions() {
    if (queuedActions.length === 0) {
      toast('info', 'No queued actions for this work order');
      return;
    }

    setActionLoading(true);
    const result = await startSync();
    await loadWO();
    await refreshQueuedActions();
    if (!result) {
      toast('warning', 'Sync will run when the network is online');
    } else if (result.failed > 0 || result.conflicts > 0) {
      toast('warning', `${result.failed + result.conflicts} queued action(s) need attention`);
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
    const payload = {
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
      timestamp: new Date().toISOString(),
    };
    const result = await runOfflineCapableAction({
      actionType: 'maintenance_event.log',
      entityType: 'maintenance_events',
      entityId: wo.id,
      assetId: wo.asset_id,
      payload,
      createdByProfileId: profile?.id ?? null,
      roleName: primaryRole,
      roleNames: roles,
      sourceRoute: typeof window !== 'undefined' ? window.location.pathname + window.location.search : `/maintenance/work-orders/${id}`,
      executeOnline: () => createMaintenanceEventAction(payload),
      metadata: { form: 'work_order_detail_event_modal', work_order_id: id },
    });
    setEventOfflineResult(result);
    await refreshQueuedActions();
    if (result.status === 'queued') {
      toast('success', 'Saved offline — will sync when connection returns.');
    } else if (result.status === 'failed' || result.status === 'conflict') {
      toast('error', result.error ?? 'Failed to log event');
    } else {
      toast('success', 'Maintenance event logged');
      setEventModalOpen(false);
      await loadEvents(wo.asset_id);
    }
    setActionLoading(false);
  }

  async function saveCompletionDraft() {
    if (!wo) return;
    setActionLoading(true);
    const payload = {
      work_order_id: id,
      asset_id: wo.asset_id,
      completion_outcome: completionOutcome,
      final_equipment_condition: finalCondition,
      note: `Completion draft: ${completionOutcome.replace(/_/g, ' ')}; final condition ${finalCondition.replace(/_/g, ' ')}.`,
      created_at: new Date().toISOString(),
    };
    const result = await runOfflineCapableAction({
      actionType: 'work_order.complete_draft',
      entityType: 'work_orders',
      entityId: id,
      assetId: wo.asset_id,
      payload,
      createdByProfileId: profile?.id ?? null,
      roleName: primaryRole,
      roleNames: roles,
      sourceRoute: typeof window !== 'undefined' ? window.location.pathname + window.location.search : `/maintenance/work-orders/${id}`,
      executeOnline: () => createMaintenanceEventAction({
        work_order_id: id,
        asset_id: wo.asset_id,
        event_type: 'corrective',
        action_taken: 'Completion draft saved for online validation',
        notes: payload.note,
        completion_date: null,
      }),
      metadata: { form: 'work_order_completion_draft' },
    });
    setActionLoading(false);
    setCompletionDraftResult(result);
    await refreshQueuedActions();
    if (result.status === 'queued') {
      toast('success', 'Saved offline — will sync when connection returns.');
      return;
    }
    if (result.status === 'failed' || result.status === 'conflict') {
      toast('error', result.error ?? 'Failed to save completion draft');
      return;
    }
    toast('success', 'Completion draft saved');
    setCompletionModalOpen(false);
    await loadEvents(wo.asset_id);
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
                <dt className="text-sm font-medium text-[var(--text-muted)]">Asset</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {wo.equipment_assets
                    ? `${wo.equipment_assets.asset_code} — ${wo.equipment_assets.name}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">Assigned To</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {wo.profiles?.full_name ?? 'Unassigned'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">Priority</dt>
                <dd className="mt-1"><UrgencyBadge urgency={wo.priority} /></dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">Status</dt>
                <dd className="mt-1"><WorkOrderStatusBadge status={wo.status} /></dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">Work Type</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {wo.work_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">External Vendor</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {wo.external_vendor ? wo.external_vendor_name || 'Yes' : 'No'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">Estimated Hours</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {wo.estimated_hours ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">Actual Hours</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {wo.actual_hours ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">Created</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {new Date(wo.created_at).toLocaleString()}
                </dd>
              </div>
              {wo.started_at && (
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Started</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {new Date(wo.started_at).toLocaleString()}
                  </dd>
                </div>
              )}
              {wo.completed_at && (
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Completed</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {new Date(wo.completed_at).toLocaleString()}
                  </dd>
                </div>
              )}
              {wo.root_cause && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Root Cause</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900 dark:text-white">
                    {wo.root_cause}
                  </dd>
                </div>
              )}
              {wo.closure_notes && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Closure Notes</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900 dark:text-white">
                    {wo.closure_notes}
                  </dd>
                </div>
              )}
              {wo.completion_outcome && (
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Completion Outcome</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {wo.completion_outcome.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </dd>
                </div>
              )}
              {wo.final_equipment_condition && (
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Final Equipment Condition</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {wo.final_equipment_condition.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
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
                    Start Work
                  </Button>
                )}
                {wo.status === 'in_progress' && (
                  <Button size="sm" variant="secondary" onClick={() => handleStatusUpdate('on_hold')} loading={actionLoading}>
                    <Pause className="h-4 w-4" />
                    Put On Hold
                  </Button>
                )}
                {(wo.status === 'in_progress' || wo.status === 'assigned') && (
                  <Button size="sm" onClick={openCompletionModal} loading={actionLoading}>
                    <CheckCircle className="h-4 w-4" />
                    Complete Work
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={saveWorkStartIntent} loading={actionLoading}>
                  <WifiOff className="h-4 w-4" />
                  Save Start Intent
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

        {(startIntentResult || completionDraftResult || eventOfflineResult) && (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <OfflineActionResult result={startIntentResult} />
              <OfflineActionResult result={completionDraftResult} />
              <OfflineActionResult result={eventOfflineResult} />
            </CardContent>
          </Card>
        )}

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
                  <div key={action.client_action_id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-[var(--foreground)]">{action.action_type.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {new Date(action.created_at).toLocaleString()}
                        {action.retry_count ? ` · retries ${action.retry_count}` : ''}
                        {action.last_error ? ` · ${action.last_error}` : ''}
                      </p>
                    </div>
                    <Badge variant={action.sync_status === 'conflict' ? 'error' : action.sync_status === 'failed' ? 'warning' : 'info'}>
                      {action.sync_status === 'queued' ? 'Pending sync' : action.sync_status.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Originating Request */}
        {originatingRequest && (
          <Card>
            <CardHeader>
              <CardTitle>Originating Request</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-[var(--text-muted)]">Request #</dt>
                  <dd className="mt-1 text-sm">
                    <a href={`/maintenance/requests/${originatingRequest.id}`} className="text-[var(--brand)] hover:underline">
                      {originatingRequest.request_number}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-[var(--text-muted)]">Urgency</dt>
                  <dd className="mt-1">
                    <UrgencyBadge urgency={originatingRequest.urgency as never} />
                  </dd>
                </div>
                {originatingRequest.reported_condition && (
                  <div>
                    <dt className="text-xs font-medium text-[var(--text-muted)]">Reported Condition</dt>
                    <dd className="mt-1 text-sm font-medium">
                      {originatingRequest.reported_condition === 'functional_issue'
                        ? <span className="text-emerald-300">Functional (issue observed)</span>
                        : originatingRequest.reported_condition === 'needs_repair'
                        ? <span className="text-amber-300">Needs repair</span>
                        : <span className="text-rose-300">Non-functional</span>}
                      {originatingRequest.reported_condition_source && (
                        <span className="ml-1.5 text-xs font-normal text-[var(--text-muted)]">· via {originatingRequest.reported_condition_source}</span>
                      )}
                    </dd>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-[var(--text-muted)]">Fault Description</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900 dark:text-white">{originatingRequest.fault_description}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        )}

        {/* Equipment Condition Context */}
        {equipmentCondition && (
          <Card>
            <CardHeader>
              <CardTitle>Condition Trace</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {originatingRequest?.reported_condition && (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
                    <p className="text-xs text-[var(--text-muted)]">Condition at request time</p>
                    <p className="mt-1 text-xs font-medium text-[var(--foreground)]">
                      {originatingRequest.reported_condition === 'functional_issue' ? 'Functional (issue)' : originatingRequest.reported_condition === 'needs_repair' ? 'Needs repair' : 'Non-functional'}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      {originatingRequest.reported_condition === 'functional_issue'
                        ? 'Minor functional issue does not degrade condition by itself.'
                        : 'Request creation synced the equipment condition to the reported risk.'}
                    </p>
                  </div>
                )}
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
                  <p className="text-xs text-[var(--text-muted)]">During work order</p>
                  <p className="mt-1 text-xs font-medium text-[var(--foreground)]">{wo.status.replace(/_/g, ' ')}</p>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                    {wo.status === 'in_progress'
                      ? 'Starting work sets the equipment to Under maintenance.'
                      : wo.status === 'on_hold'
                        ? 'On hold preserves the current maintenance/repair condition until the blocker is resolved.'
                        : wo.status === 'completed'
                          ? 'Completion applies the final equipment condition below.'
                          : 'Assignment/open state preserves request condition until work starts.'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-muted)]">Current condition</p>
                  <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${getConditionBadgeClass(equipmentCondition.condition)}`}>
                    {formatEquipmentCondition(equipmentCondition.condition)}
                  </span>
                </div>
                {wo?.final_equipment_condition && (
                  <div>
                    <p className="text-xs text-[var(--text-muted)]">Final (at completion)</p>
                    <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${getConditionBadgeClass(wo.final_equipment_condition)}`}>
                      {formatEquipmentCondition(wo.final_equipment_condition)}
                    </span>
                  </div>
                )}
                {wo?.completion_outcome && (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
                    <p className="text-xs text-[var(--text-muted)]">Completion outcome</p>
                    <p className="mt-1 text-xs font-medium text-[var(--foreground)]">
                      {wo.completion_outcome.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">Source action: work-order completion updated the final condition and analytics.</p>
                  </div>
                )}
              </div>
              {wo?.equipment_assets?.id && (
                <a href={`/equipment/${wo.equipment_assets.id}`} className="mt-3 block text-xs text-[var(--brand)] hover:underline">
                  View equipment detail →
                </a>
              )}
            </CardContent>
          </Card>
        )}

        {/* Maintenance Event Log */}
        <Card>
          <CardHeader>
            <CardTitle>Maintenance Events</CardTitle>
            {!isTerminal && (
              <div className="flex items-center gap-2">
                <a
                  href={`/maintenance/work-orders/${id}/events/new`}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-3)]"
                  title="Open the full event form on its own page"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Work Event
                </a>
                <Button size="sm" onClick={openEventModal}>
                  <Plus className="h-4 w-4" />
                  Log Event
                </Button>
              </div>
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

      {/* Completion Modal */}
      <Modal
        open={completionModalOpen}
        onClose={() => setCompletionModalOpen(false)}
        title="Complete Work Order"
        footer={
          <>
            <Button variant="outline" onClick={() => setCompletionModalOpen(false)}>Cancel</Button>
            <Button variant="secondary" onClick={saveCompletionDraft} loading={actionLoading}>
              <WifiOff className="h-4 w-4" />
              Save Draft
            </Button>
            <Button onClick={handleCompleteWorkOrder} loading={actionLoading}>
              <CheckCircle className="h-4 w-4" />
              Confirm Completion
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <OfflineSubmitBanner actionLabel="Completion draft" />
          <OfflineActionResult result={completionDraftResult} />
          <p className="text-sm text-[var(--text-muted)]">
            Select the resolution outcome and the equipment&apos;s final condition. This is used to update the equipment record and analytics.
          </p>
          <Select
            label="Completion Outcome *"
            value={completionOutcome}
            onChange={(e) => {
              setCompletionOutcome(e.target.value);
              setFinalCondition(outcomeToCondition(e.target.value));
            }}
            options={[
              { value: 'resolved', label: 'Resolved — issue fully fixed' },
              { value: 'partially_resolved', label: 'Partially resolved — some issues remain' },
              { value: 'not_resolved', label: 'Not resolved — equipment still non-functional' },
              { value: 'awaiting_parts_or_vendor', label: 'Awaiting parts or vendor — blocked' },
            ]}
          />
          <Select
            label="Final Equipment Condition *"
            value={finalCondition}
            onChange={(e) => setFinalCondition(e.target.value)}
            options={[
              { value: 'functional', label: 'Functional' },
              { value: 'needs_repair', label: 'Needs repair' },
              { value: 'non_functional', label: 'Non-functional' },
              { value: 'under_maintenance', label: 'Under maintenance (awaiting next step)' },
            ]}
          />
          <p className="rounded-md bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-muted)]">
            Equipment condition will be updated to <strong className="text-[var(--foreground)]">{finalCondition.replace(/_/g, ' ')}</strong> after completion.
          </p>
        </div>
      </Modal>

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
          <p className="mt-2 text-xs text-amber-300">{ASSIGNABLE_TECHNICIANS_EMPTY_STATE}</p>
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
        <div className="mb-4 space-y-3">
          <OfflineSubmitBanner actionLabel="Maintenance event" />
          <OfflineActionResult result={eventOfflineResult} />
        </div>
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
