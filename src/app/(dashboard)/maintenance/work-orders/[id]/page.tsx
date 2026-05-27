'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Play, Pause, CheckCircle, XCircle, UserPlus, Plus, WifiOff, RefreshCcw,
} from 'lucide-react';
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, CardFooter,
  Button, Modal, Table, Input, Select, Textarea, Spinner, Badge,
} from '@/components/ui';
import { motion } from 'framer-motion';
import { slideUp } from '@/lib/ui/motion-presets';
import { UrgencyBadge, WorkOrderStatusBadge } from '@/components/ui/StatusBadge';
import AssistantPageContextBridge from '@/components/assistant/AssistantPageContextBridge';
import {
  getWorkOrderById, getMaintenanceEventsByWorkOrderId, getRequestById,
} from '@/services/maintenance.service';
import { getEquipmentById } from '@/services/equipment.service';
import { formatEquipmentCondition, getConditionBadgeClass } from '@/utils/equipment/condition-labels';
import { assignWorkOrder, createMaintenanceEventAction, reassignWorkOrder, updateWorkOrderAction } from '@/actions/maintenance.actions';
import WorkOrderPartsNeededPanel from './WorkOrderPartsNeededPanel';
import { getOfflineQueue, runOfflineCapableAction } from '@/lib/offline/queue';
import { getOfflineReadCache, saveOfflineReadCache, type OfflineCacheScope } from '@/lib/offline/cache';
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
import { publishNotificationsUpdated } from '@/lib/notifications/client-events';
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
  const { startSync, isOnline } = useOfflineSync();
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
  // R2: reliability evidence captured at completion. Auto-feeds the
  // maintenance_events writer in updateWorkOrderAction, which migration
  // 00061's trigger then materializes into a downtime_logs row. Fields left
  // blank are derived from work-order timestamps so a corrective WO can
  // never complete without an event.
  const [repairDurationHours, setRepairDurationHours] = useState<string>('');
  const [downtimeStart, setDowntimeStart] = useState<string>('');
  const [downtimeEnd, setDowntimeEnd] = useState<string>('');
  const [failureDate, setFailureDate] = useState<string>('');
  const [completionActionTaken, setCompletionActionTaken] = useState<string>('');

  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [failureCodes, setFailureCodes] = useState<FailureCode[]>([]);
  const [actionCodes, setActionCodes] = useState<MaintenanceActionCode[]>([]);
  const [queuedActions, setQueuedActions] = useState<OfflineQueueRecord[]>([]);
  const [startIntentResult, setStartIntentResult] = useState<OfflineActionRunResult | null>(null);
  const [completionDraftResult, setCompletionDraftResult] = useState<OfflineActionRunResult | null>(null);
  const [eventOfflineResult, setEventOfflineResult] = useState<OfflineActionRunResult | null>(null);
  const [showingCachedWorkOrder, setShowingCachedWorkOrder] = useState(false);

  const workOrderCacheScope: OfflineCacheScope | null = useMemo(() => (
    profile?.id
      ? { profileId: profile.id, roleName: primaryRole, departmentId: profile.department_id ?? null }
      : null
  ), [primaryRole, profile]);
  const workOrderCacheKey = `work_order.detail.${id}`;

  const cacheWorkOrder = useCallback(async (row: WOWithJoins) => {
    if (!workOrderCacheScope) return;
    await saveOfflineReadCache(workOrderCacheKey, row, workOrderCacheScope, {
      sourceRoute: `/maintenance/work-orders/${id}`,
    }).catch(() => undefined);
  }, [id, workOrderCacheKey, workOrderCacheScope]);

  const refreshQueuedActions = useCallback(async () => {
    const queue = await getOfflineQueue();
    setQueuedActions(queue.filter((item) => item.entity_id === id || String(item.payload?.work_order_id ?? '') === id));
  }, [id]);

  // WO-completion truth fix: query maintenance_events directly linked to the
  // current work order, not the asset's full history. This ensures the
  // evidence shown next to "Completion Outcome" / "Final Equipment Condition"
  // is the evidence FOR THIS work order. Asset-wide history remains
  // accessible from /equipment/[id].
  const loadEvents = useCallback(async (workOrderId: string) => {
    const { data } = await getMaintenanceEventsByWorkOrderId(workOrderId);
    if (data) setEvents(data as unknown as EventWithJoins[]);
    else setEvents([]);
  }, []);

  const loadLinkedContext = useCallback(async (row: WOWithJoins) => {
    const requestId = (row as { request_id?: string | null }).request_id;
    await Promise.all([
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
        : Promise.resolve(setOriginatingRequest(null)),
      getEquipmentById(row.asset_id).then(({ data: eqData }) => {
        if (eqData) {
          const eq = eqData as unknown as { condition: string };
          setEquipmentCondition({ condition: eq.condition });
        }
      }).catch(() => undefined),
    ]);
  }, []);

  const loadWO = useCallback(async () => {
    const { data, error } = await getWorkOrderById(id);
    if (error || !data) {
      toast('error', 'Failed to load work order');
      return;
    }
    const row = data as unknown as WOWithJoins;
    setWO(row);
    setShowingCachedWorkOrder(false);
    await Promise.all([cacheWorkOrder(row), loadLinkedContext(row)]);
  }, [cacheWorkOrder, id, loadLinkedContext, toast]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const { data, error } = await getWorkOrderById(id);
      if (error || !data) {
        if (workOrderCacheScope) {
          const cached = await getOfflineReadCache<WOWithJoins>(workOrderCacheKey, workOrderCacheScope).catch(() => null);
          if (cached) {
            setWO(cached.data);
            setEvents([]);
            setOriginatingRequest(null);
            setEquipmentCondition(null);
            setShowingCachedWorkOrder(true);
            await refreshQueuedActions();
            setLoading(false);
            return;
          }
        }
        toast('error', 'Failed to load work order');
        setLoading(false);
        return;
      }
      const woData = data as unknown as WOWithJoins;
      setWO(woData);
      setShowingCachedWorkOrder(false);
      await cacheWorkOrder(woData);

      await Promise.all([
        loadEvents(woData.id),
        loadLinkedContext(woData),
      ]);

      await refreshQueuedActions();
      setLoading(false);
    }
    init();
  }, [cacheWorkOrder, id, loadEvents, loadLinkedContext, refreshQueuedActions, toast, workOrderCacheKey, workOrderCacheScope]);

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
      const data = result.data as { condition_sync_warning?: string; request_status_sync_warning?: string; notification_warning?: string; notification_warning_detail?: string | null } | undefined;
      if (data?.condition_sync_warning) {
        // R5: work order status changed but equipment condition didn't sync.
        toast('warning', `Work order updated. Equipment condition could not be updated: ${data.condition_sync_warning}`);
      } else if (data?.request_status_sync_warning) {
        toast('warning', `Work order updated. Linked request status could not be synced: ${data.request_status_sync_warning}`);
      } else if (data?.notification_warning) {
        toast('warning', data.notification_warning_detail
          ? `Work order updated. Notification delivery needs review: ${data.notification_warning_detail}`
          : 'Work order updated, but notification delivery needs review.');
      } else {
        toast('success', `Work order ${status.replace(/_/g, ' ')}`);
      }
      publishNotificationsUpdated('work-order-status');
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
    // R2: prefill downtime fields from the work order's lifecycle. If the WO
    // recorded started_at, that's a reasonable downtime_start default; the
    // technician can edit. Repair duration defaults to actual_hours when set.
    // WO-completion truth fix: the action layer ALSO derives these from the
    // WO's timestamps server-side, so even a blank submission produces a
    // maintenance_events row. The prefill is for transparency, not safety.
    setDowntimeStart(wo?.started_at ? new Date(wo.started_at).toISOString().slice(0, 16) : '');
    setDowntimeEnd(new Date().toISOString().slice(0, 16));
    setRepairDurationHours(wo?.actual_hours ? String(wo.actual_hours) : '');
    setFailureDate(wo?.created_at ? new Date(wo.created_at).toISOString().slice(0, 10) : '');
    setCompletionActionTaken(wo?.action_taken ?? '');
    setCompletionModalOpen(true);
  }

  async function handleCompleteWorkOrder() {
    if (!wo) return;
    setActionLoading(true);
    const completedAt = new Date().toISOString();
    const payload = {
      work_order_id: id,
      asset_id: wo.asset_id,
      status: 'completed',
      started_at: wo.started_at,
      completed_at: completedAt,
      completion_outcome: completionOutcome,
      final_equipment_condition: finalCondition,
      // R2: reliability evidence. Empty values are derived server-side from
      // the WO's started_at / completed_at / created_at so a corrective WO
      // can never complete without a maintenance_events row.
      repair_duration_hours: repairDurationHours || null,
      downtime_start: downtimeStart ? new Date(downtimeStart).toISOString() : null,
      downtime_end: downtimeEnd ? new Date(downtimeEnd).toISOString() : null,
      failure_date: failureDate || null,
      action_taken: completionActionTaken.trim() || null,
      action_taken_on_completion: completionActionTaken.trim() || null,
      performed_by_profile_id: profile?.id ?? null,
      last_known_server_updated_at: wo.updated_at,
    };
    const result = await runOfflineCapableAction({
      actionType: 'work_order.complete',
      entityType: 'work_orders',
      entityId: id,
      assetId: wo.asset_id,
      payload,
      createdByProfileId: profile?.id ?? null,
      roleName: primaryRole,
      roleNames: roles,
      sourceRoute: typeof window !== 'undefined' ? window.location.pathname + window.location.search : `/maintenance/work-orders/${id}`,
      executeOnline: () => updateWorkOrderAction(id, {
        status: 'completed',
        completed_at: completedAt,
        completion_outcome: completionOutcome,
        final_equipment_condition: finalCondition,
        repair_duration_hours: repairDurationHours || null,
        downtime_start: downtimeStart ? new Date(downtimeStart).toISOString() : null,
        downtime_end: downtimeEnd ? new Date(downtimeEnd).toISOString() : null,
        failure_date: failureDate || null,
        action_taken_on_completion: completionActionTaken.trim() || null,
      }),
      lastKnownServerState: {
        status: wo.status,
        assigned_to: wo.assigned_to,
        started_at: wo.started_at,
        updated_at: wo.updated_at,
      },
      metadata: { form: 'work_order_completion_package' },
    });
    setActionLoading(false);
    setCompletionDraftResult(result);
    await refreshQueuedActions();
    if (result.status === 'queued') {
      toast(
        'success',
        'Work-order completion queued locally. It will become official after sync. Maintenance evidence, downtime logs, analytics, reports, and notifications will update after the queued action syncs.',
      );
      setCompletionModalOpen(false);
      return;
    }
    if (result.status === 'failed' || result.status === 'conflict') {
      toast('error', result.error ?? 'Failed to complete work order');
      return;
    }

    if (result.status === 'success') {
      const actionResult = result.data as { data?: { condition_sync_warning?: string; reliability_evidence_warning?: string; request_status_sync_warning?: string; notification_warning?: string; notification_warning_detail?: string | null } };
      const data = actionResult.data;
      if (data?.condition_sync_warning) {
        // R5: completion succeeded but final equipment condition could not be recorded.
        toast('warning', `Work order completed. Final equipment condition could not be recorded: ${data.condition_sync_warning}`);
      } else if (data?.reliability_evidence_warning) {
        // Reliability evidence write failed — surface verbatim so the gap is
        // visible (RLS denial, constraint violation, etc.). Completion itself
        // succeeded.
        toast('warning', `Work order completed. ${data.reliability_evidence_warning}`);
      } else if (data?.request_status_sync_warning) {
        toast('warning', `Work order completed. Linked request status could not be synced: ${data.request_status_sync_warning}`);
      } else if (data?.notification_warning) {
        toast('warning', data.notification_warning_detail
          ? `Work order completed. Notification delivery needs review: ${data.notification_warning_detail}`
          : 'Work order completed, but notification delivery needs review.');
      } else {
        toast('success', 'Work order completed');
      }
      publishNotificationsUpdated('work-order-completed');
      setCompletionModalOpen(false);
      // Reload BOTH the WO and the events linked to this WO so the
      // "Maintenance Events" section reflects the new completion evidence
      // without requiring a manual refresh.
      await Promise.all([loadWO(), loadEvents(wo.id)]);
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
      last_known_server_updated_at: wo.updated_at,
    };
    const result = await runOfflineCapableAction({
      actionType: 'work_order.start',
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
      lastKnownServerState: {
        status: wo.status,
        assigned_to: wo.assigned_to,
        updated_at: wo.updated_at,
      },
      metadata: { form: 'work_order_detail_start' },
    });
    setActionLoading(false);
    setStartIntentResult(result);
    await refreshQueuedActions();
    if (result.status === 'queued') {
      toast('success', 'Work start queued locally. It will sync when connection returns.');
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

  const selectedTechnicianProfile = technicians.find((tech) => tech.id === selectedTechnician) ?? null;

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
      const notificationData = result.data as { request_status_sync_warning?: string; notification_warning?: string; notification_warning_detail?: string | null } | undefined;
      if (notificationData?.notification_warning) {
        toast('warning', notificationData.notification_warning_detail
          ? `Work order ${wo.assigned_to ? 'reassigned' : 'assigned'}. Notification delivery needs review: ${notificationData.notification_warning_detail}`
          : `Work order ${wo.assigned_to ? 'reassigned' : 'assigned'}, but notification delivery needs review.`);
      } else if (notificationData?.request_status_sync_warning) {
        toast('warning', `Work order ${wo.assigned_to ? 'reassigned' : 'assigned'}, but linked request status could not be synced: ${notificationData.request_status_sync_warning}`);
      } else {
        toast('success', `Work order ${wo.assigned_to ? 'reassigned' : 'assigned'}`);
      }
      publishNotificationsUpdated('work-order-assigned');
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
      await loadEvents(wo.id);
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
      <AssistantPageContextBridge
        moduleLabel="Maintenance"
        pageLabel={wo.work_order_number}
        contextRefs={{ workOrderId: id, equipmentId: wo.asset_id }}
        selectedRecordType="work_order"
        selectedRecordId={id}
        selectedRecordLabel={wo.work_order_number}
        activeTab={requestedAction ?? undefined}
        offlineStatus="unknown"
        queueStatus={{ queued: queuedActions.length }}
        pageSummary="Work order detail page with assigned technician, equipment, originating request, status, offline-capable event capture, and maintenance evidence."
        visibleCounts={{
          maintenanceEvents: events.length,
          queuedActions: queuedActions.length,
          status: wo.status,
          priority: wo.priority,
          isTerminal,
        }}
        pageDataHints={[
          `Equipment: ${wo.equipment_assets ? `${wo.equipment_assets.asset_code} - ${wo.equipment_assets.name}` : wo.asset_id}`,
          `Assigned technician: ${wo.profiles?.full_name ?? 'Unassigned'}`,
          `Status: ${wo.status}`,
          originatingRequest ? `Originating request: ${originatingRequest.request_number}` : 'No originating request loaded',
        ]}
        availableEvidenceLinks={[
          { label: 'Work order', href: `/maintenance/work-orders/${id}`, type: 'work_order' },
          { label: 'Equipment', href: `/equipment/${wo.asset_id}`, type: 'equipment' },
          ...(originatingRequest ? [{ label: 'Originating request', href: `/maintenance/requests/${originatingRequest.id}`, type: 'request' }] : []),
          { label: 'Offline Sync', href: '/offline-sync', type: 'offline' },
        ]}
        quickPrompts={['Summarize this work order.', 'What safe first-line checks should I do?', 'What should I escalate?']}
      />
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

      <motion.div
        variants={slideUp}
        initial="initial"
        animate="animate"
        className="space-y-6"
      >
        {showingCachedWorkOrder && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            Offline mode — showing cached work-order data. Last known status: {wo.status.replace(/_/g, ' ')}.
            Queue actions only if this work was cached and assigned to you; replay will validate before anything becomes official.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Work Order Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">Asset</dt>
                <dd className="mt-1 text-sm text-[var(--foreground)] font-medium">
                  {wo.equipment_assets
                    ? `${wo.equipment_assets.asset_code} — ${wo.equipment_assets.name}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">Assigned To</dt>
                <dd className="mt-1 text-sm text-[var(--foreground)] font-medium">
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
                <dd className="mt-1 text-sm text-[var(--foreground)] font-medium">
                  {wo.work_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">External Vendor</dt>
                <dd className="mt-1 text-sm text-[var(--foreground)] font-medium">
                  {wo.external_vendor ? wo.external_vendor_name || 'Yes' : 'No'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">Estimated Hours</dt>
                <dd className="mt-1 text-sm text-[var(--foreground)] font-medium">
                  {wo.estimated_hours ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">Actual Hours</dt>
                <dd className="mt-1 text-sm text-[var(--foreground)] font-medium">
                  {wo.actual_hours ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--text-muted)]">Created</dt>
                <dd className="mt-1 text-sm text-[var(--foreground)] font-medium">
                  {new Date(wo.created_at).toLocaleString()}
                </dd>
              </div>
              {wo.started_at && (
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Started</dt>
                  <dd className="mt-1 text-sm text-[var(--foreground)] font-medium">
                    {new Date(wo.started_at).toLocaleString()}
                  </dd>
                </div>
              )}
              {wo.completed_at && (
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Completed</dt>
                  <dd className="mt-1 text-sm text-[var(--foreground)] font-medium">
                    {new Date(wo.completed_at).toLocaleString()}
                  </dd>
                </div>
              )}
              {wo.root_cause && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Root Cause</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)] font-medium">
                    {wo.root_cause}
                  </dd>
                </div>
              )}
              {wo.closure_notes && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Closure Notes</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)] font-medium">
                    {wo.closure_notes}
                  </dd>
                </div>
              )}
              {wo.completion_outcome && (
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Completion Outcome</dt>
                  <dd className="mt-1 text-sm text-[var(--foreground)] font-medium">
                    {wo.completion_outcome.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </dd>
                </div>
              )}
              {wo.final_equipment_condition && (
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Final Equipment Condition</dt>
                  <dd className="mt-1 text-sm text-[var(--foreground)] font-medium">
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
                  <Button size="sm" onClick={saveWorkStartIntent} loading={actionLoading}>
                    <Play className="h-4 w-4" />
                    {isOnline ? 'Start Work' : 'Queue Start'}
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
                  Queue Start
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
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)] font-medium">{originatingRequest.fault_description}</dd>
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

        {/* R19: Parts Needed panel */}
        <WorkOrderPartsNeededPanel
          workOrderId={id}
          workOrderStatus={wo?.status ?? ''}
        />

        {/* Maintenance Event Log — scoped to THIS work order. Asset-wide
            history lives on /equipment/[id]. */}
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
            {/* Honest missing-evidence banner: a completed corrective WO with
                zero linked events points to an RLS / write failure or to a
                pre-fix legacy completion. The WO did NOT silently produce
                MTTR/MTBF evidence. */}
            {wo.status === 'completed' && wo.work_type === 'corrective' && events.length === 0 && (
              <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Completed work order is missing reliability evidence.
                MTTR / MTBF / availability did not refresh from this completion.
                {(isDeveloper || isAdmin || isBmeHead) && (
                  <span className="ml-1">Apply migration 00069 or log one linked maintenance event to repair the gap.</span>
                )}
              </div>
            )}
            <Table<EventWithJoins>
              columns={eventColumns}
              data={events}
              emptyMessage={
                wo.status === 'completed'
                  ? 'No maintenance event recorded for this work order.'
                  : 'No maintenance events logged yet.'
              }
            />
            {wo?.asset_id && (
              <a
                href={`/equipment/${wo.asset_id}#maintenance-history`}
                className="mt-3 inline-block text-xs text-[var(--brand)] hover:underline"
              >
                View full maintenance history for this asset →
              </a>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Completion Modal */}
      <Modal
        open={completionModalOpen}
        onClose={() => setCompletionModalOpen(false)}
        title="Complete Work Order"
        footer={
          <>
            <Button variant="outline" onClick={() => setCompletionModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCompleteWorkOrder} loading={actionLoading}>
              <CheckCircle className="h-4 w-4" />
              {isOnline ? 'Confirm Completion' : 'Queue Completion'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <OfflineSubmitBanner actionLabel="Work-order completion" />
          <OfflineActionResult result={completionDraftResult} />
          {!isOnline && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Offline actions are local promises, not official server facts. This completion will stay
              queued locally until replay validates the work order, assignment, and last known server state.
            </div>
          )}
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

          {/* Reliability evidence pipeline.
              For corrective work orders, a maintenance_events row is ALWAYS
              written on completion. Any field left blank below is derived
              server-side from the work order's started_at / completed_at /
              created_at timestamps, so the user can complete with whatever
              evidence they have. Migration 00061's trigger then materialises
              the matching downtime_logs row that fn_compute_mtbf reads. */}
          <div className="space-y-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-3">
            <p className="text-xs font-medium text-[var(--foreground)]">
              Reliability evidence (auto-derived from work-order timestamps if left blank)
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              MTTR / MTBF / availability refresh from this evidence. Fill in what you know — the rest is derived.
            </p>
            <Textarea
              label="Action taken / repair summary"
              placeholder="e.g. Freed stuck TGC slider, tested control response, returned to functional."
              value={completionActionTaken}
              onChange={(e) => setCompletionActionTaken(e.target.value)}
            />
            <Input
              type="number"
              step="0.25"
              min="0"
              label="Repair duration (hours)"
              placeholder="leave blank to derive from started_at → completed_at"
              value={repairDurationHours}
              onChange={(e) => setRepairDurationHours(e.target.value)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="datetime-local"
                label="Downtime start"
                value={downtimeStart}
                onChange={(e) => setDowntimeStart(e.target.value)}
              />
              <Input
                type="datetime-local"
                label="Downtime end"
                value={downtimeEnd}
                onChange={(e) => setDowntimeEnd(e.target.value)}
              />
            </div>
            <Input
              type="date"
              label="Failure date"
              value={failureDate}
              onChange={(e) => setFailureDate(e.target.value)}
            />
          </div>
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
          options={technicians.map((t) => ({
            value: t.id,
            label: `${t.full_name}${t.email ? ` · ${t.email}` : ''}${!t.user_id ? ' · no login linked' : ''}`,
          }))}
        />
        {selectedTechnicianProfile && !selectedTechnicianProfile.user_id && (
          <p className="mt-2 text-xs text-amber-300">
            This technician profile has no login linked, so in-app and Telegram notification delivery will be skipped until `profiles.user_id` is set.
          </p>
        )}
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
