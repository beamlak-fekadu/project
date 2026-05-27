// Notification rules — role-aware fan-out for normalized events.
//
// Each rule takes a NotificationEventRow and decides which roles/profiles
// should receive a user-facing notification and how the message should be
// worded for that role. Messages must be role-specific; we never re-broadcast
// raw event payloads.
//
// Rules return CreateNotificationInput[] (one per recipient). The engine
// applies dedupe + insert + delivery downstream.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NOTIFICATION_RECIPIENT_IDENTITY_CONTRACT,
  dedupeRecipients,
  getAdmins,
  getAssetDepartmentId,
  getBmeHeads,
  getDepartmentHeads,
  getDepartmentUsers,
  getDevelopers,
  getLeadershipRecipients,
  getProfileById,
  getProfileRecipientReadiness,
  getStoreUsers,
  getViewers,
} from './recipient-resolver';
import { buildNotificationLink } from './notification-links';
import { computeDedupeKey } from './notification-dedupe';
import type {
  CreateNotificationInput,
  NotificationCategory,
  NotificationEventRow,
  NotificationEventType,
  NotificationPriority,
  RecipientProfile,
} from '@/types/notifications';

type DbClient = SupabaseClient;

function pickPayloadString(
  payload: Record<string, unknown> | undefined | null,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function pickPayloadNumber(
  payload: Record<string, unknown> | undefined | null,
  key: string,
): number | null {
  const value = payload?.[key];
  return typeof value === 'number' ? value : null;
}

function describeAsset(event: NotificationEventRow): string {
  const payload = event.payload ?? {};
  const code = pickPayloadString(payload, 'asset_code');
  const name = pickPayloadString(payload, 'asset_name');
  if (code && name) return `${name} (${code})`;
  if (name) return name;
  if (code) return code;
  return 'the asset';
}

function describeDepartment(event: NotificationEventRow): string {
  return pickPayloadString(event.payload ?? {}, 'department_name') ?? 'the department';
}

function describeRequest(event: NotificationEventRow): string {
  return pickPayloadString(event.payload ?? {}, 'request_number') ?? 'a request';
}

function describeWorkOrder(event: NotificationEventRow): string {
  return pickPayloadString(event.payload ?? {}, 'work_order_number') ?? 'a work order';
}

function formatEquipmentConditionForMessage(condition: string | null): string {
  switch (condition) {
    case 'functional':
      return 'functional';
    case 'needs_repair':
      return 'still marked as needing repair';
    case 'non_functional':
      return 'still marked as non-functional';
    case 'under_maintenance':
      return 'still under maintenance';
    case 'decommissioned':
      return 'decommissioned';
    default:
      return 'updated';
  }
}

function describePart(event: NotificationEventRow): string {
  return pickPayloadString(event.payload ?? {}, 'part_name') ?? 'a spare part';
}

function buildRow(
  event: NotificationEventRow,
  recipient: RecipientProfile,
  partial: Omit<CreateNotificationInput, 'recipient_profile_id' | 'event_id' | 'priority' | 'category'> & {
    priority?: NotificationPriority;
    category: NotificationCategory;
    eventType?: NotificationEventType;
  },
): CreateNotificationInput {
  const link = buildNotificationLink((partial.eventType ?? event.event_type) as NotificationEventType, {
    source_id: event.source_id,
    asset_id: event.asset_id,
    department_id: event.department_id,
    payload: event.payload ?? {},
  });
  return {
    recipient_profile_id: recipient.id,
    recipient_role: recipient.primaryRole ?? null,
    title: partial.title,
    message: partial.message,
    priority: partial.priority ?? event.priority,
    category: partial.category,
    source_type: event.event_type,
    source_id: event.source_id ?? null,
    event_id: event.id,
    asset_id: event.asset_id ?? null,
    department_id: event.department_id ?? null,
    action_href: link?.href ?? null,
    action_label: link?.label ?? null,
    dedupe_key: computeDedupeKey({
      recipient_profile_id: recipient.id,
      event_type: event.event_type,
      source_type: event.event_type,
      source_id: event.source_id ?? event.asset_id ?? null,
    }),
    metadata: partial.metadata ?? {},
  };
}

async function getRelevantAssetDepartment(
  client: DbClient,
  event: NotificationEventRow,
): Promise<string | null> {
  if (event.department_id) return event.department_id;
  if (event.asset_id) return await getAssetDepartmentId(client, event.asset_id);
  return null;
}

interface ExpectedProfileRecipient {
  label: string;
  profileId: string | null;
  expectedRole?: string | null;
  sourceFields: string[];
}

function pickFirstPayloadString(
  payload: Record<string, unknown> | undefined | null,
  keys: string[],
): { value: string | null; sourceFields: string[] } {
  const presentFields = keys.filter((key) => typeof payload?.[key] === 'string' && String(payload?.[key]).length > 0);
  return {
    value: presentFields.length > 0 ? String(payload?.[presentFields[0]]) : null,
    sourceFields: keys,
  };
}

function expectedDirectProfiles(event: NotificationEventRow): ExpectedProfileRecipient[] {
  const payload = event.payload ?? {};
  const eventType = event.event_type as NotificationEventType;
  switch (eventType) {
    case 'work_order.assigned': {
      const picked = pickFirstPayloadString(payload, ['technician_profile_id', 'assigned_to']);
      return [{
        label: 'assigned_technician',
        profileId: picked.value,
        expectedRole: 'technician',
        sourceFields: picked.sourceFields,
      }];
    }
    case 'work_order.created':
    case 'work_order.status_changed':
    case 'work_order.on_hold':
    case 'work_order.completed':
    case 'work_order.aging_or_overdue':
    case 'pm.overdue':
    case 'pm.assigned':
    case 'pm.completed': {
      const picked = pickFirstPayloadString(payload, ['assigned_to']);
      return [{
        label: 'assigned_technician',
        profileId: picked.value,
        expectedRole: 'technician',
        sourceFields: picked.sourceFields,
      }];
    }
    case 'maintenance_request.created':
    case 'maintenance_request.status_changed':
    case 'calibration.request_status_changed': {
      const picked = pickFirstPayloadString(payload, ['requested_by']);
      return [{
        label: 'requester',
        profileId: picked.value,
        expectedRole: null,
        sourceFields: picked.sourceFields,
      }];
    }
    case 'offline_sync.conflict':
    case 'offline_sync.failed': {
      const picked = pickFirstPayloadString(payload, ['actor_profile_id']);
      return [{
        label: 'actor',
        profileId: picked.value,
        expectedRole: null,
        sourceFields: picked.sourceFields,
      }];
    }
    case 'system.test_notification': {
      const picked = pickFirstPayloadString(payload, ['target_profile_id']);
      return picked.value
        ? [{
          label: 'test_target',
          profileId: picked.value,
          expectedRole: null,
          sourceFields: picked.sourceFields,
        }]
        : [];
    }
    default:
      return [];
  }
}

function expectedRoleRecipients(event: NotificationEventRow): string[] {
  const eventType = event.event_type as NotificationEventType;
  const priority = pickPayloadString(event.payload ?? {}, 'priority') ?? event.priority;
  const highOrCritical = priority === 'critical' || priority === 'high';
  switch (eventType) {
    case 'maintenance_request.created':
      return ['bme_head', 'admin', 'department_head'];
    case 'maintenance_request.status_changed':
      return ['department_head'];
    case 'work_order.assigned':
      return highOrCritical ? ['technician', 'bme_head', 'admin'] : ['technician'];
    case 'work_order.on_hold':
      return ['technician', 'bme_head', 'admin'];
    case 'work_order.completed':
      return ['technician', 'bme_head', 'admin', 'department_head'];
    case 'pm.overdue':
      return ['bme_head', 'admin', 'technician'];
    case 'pm.assigned':
      return ['technician'];
    case 'pm.completed':
    case 'calibration.overdue':
    case 'calibration.failed_or_adjusted':
    case 'calibration.request_created':
    case 'qr.label_needs_replacement':
    case 'qr.revoked_scanned':
      return ['bme_head', 'admin'];
    case 'spare_part.stockout':
    case 'work_order.stock_blocked':
    case 'reorder.requested':
    case 'procurement.delayed':
      return ['store_user', 'bme_head', 'admin'];
    case 'spare_part.low_stock':
    case 'spare_part.restocked':
    case 'procurement.delivered':
    case 'procurement.delivered_pending_receipt':
      return ['store_user'];
    case 'replacement.review_candidate':
    case 'replacement.strong_candidate':
    case 'risk.critical_asset_risk':
      return ['bme_head', 'admin', 'viewer'];
    case 'department.readiness_risk':
      return ['department_head', 'department_user', 'bme_head', 'admin', 'viewer'];
    case 'department.critical_asset_down':
      return ['department_head', 'bme_head', 'admin', 'viewer'];
    case 'offline_sync.conflict':
      return ['bme_head', 'admin'];
    case 'copilot.provider_failure':
    case 'notification.rule_failed':
      return ['developer'];
    case 'system.test_notification':
      return pickPayloadString(event.payload ?? {}, 'target_profile_id') ? [] : ['developer'];
    default:
      return [];
  }
}

async function buildRuleDiagnostics(
  client: DbClient,
  event: NotificationEventRow,
): Promise<Record<string, unknown>> {
  const expectedProfiles = expectedDirectProfiles(event);
  const expectedProfileDiagnostics = await Promise.all(
    expectedProfiles.map(async (expected) => ({
      label: expected.label,
      source_fields: expected.sourceFields,
      ...(await getProfileRecipientReadiness(client, expected.profileId, expected.expectedRole ?? null)),
    })),
  );
  return {
    auth_link_required: true,
    recipient_contract: NOTIFICATION_RECIPIENT_IDENTITY_CONTRACT,
    expected_recipient_roles: Array.from(new Set(expectedRoleRecipients(event))).sort(),
    expected_profile_recipients: expectedProfileDiagnostics,
  };
}

async function matchedRule(
  client: DbClient,
  event: NotificationEventRow,
  ruleName: string,
  rows: CreateNotificationInput[],
): Promise<RuleResult> {
  return {
    rule_name: ruleName,
    rows,
    status: 'matched',
    diagnostics: await buildRuleDiagnostics(client, event),
  };
}

// ─── Rule implementations ───────────────────────────────────────────────────

async function rule_maintenanceRequestCreated(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const asset = describeAsset(event);
  const requestNumber = describeRequest(event);
  const urgency = pickPayloadString(event.payload ?? {}, 'urgency') ?? 'medium';
  const isCritical = urgency === 'critical' || urgency === 'high';
  const departmentId = await getRelevantAssetDepartment(client, event);

  const leadership = await getLeadershipRecipients(client);
  for (const r of leadership) {
    rows.push(
      buildRow(event, r, {
        category: isCritical ? 'critical' : 'request',
        title: isCritical
          ? 'Critical equipment request submitted'
          : 'Maintenance request submitted',
        message: `${asset} has a ${urgency} maintenance request ${requestNumber} awaiting BME review.`,
      }),
    );
  }

  if (departmentId) {
    const heads = await getDepartmentHeads(client, departmentId);
    for (const r of heads) {
      rows.push(
        buildRow(event, r, {
          category: 'request',
          title: 'Department equipment request submitted',
          message: `${asset} request ${requestNumber} has been submitted to BME for maintenance.`,
        }),
      );
    }
  }

  // Requester notification (their own submission confirmation).
  const requesterId = pickPayloadString(event.payload ?? {}, 'requested_by');
  if (requesterId) {
    const profile = await getProfileById(client, requesterId);
    if (profile) {
      rows.push(
        buildRow(event, profile, {
          category: 'request',
          priority: 'info',
          title: 'Your maintenance request was submitted',
          message: `Request ${requestNumber} for ${asset} is now in BME review.`,
        }),
      );
    }
  }

  return rows;
}

async function rule_maintenanceRequestStatusChanged(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const status = pickPayloadString(event.payload ?? {}, 'status') ?? 'updated';
  const asset = describeAsset(event);
  const requestNumber = describeRequest(event);
  const departmentId = await getRelevantAssetDepartment(client, event);

  // Requester
  const requesterId = pickPayloadString(event.payload ?? {}, 'requested_by');
  if (requesterId) {
    const profile = await getProfileById(client, requesterId);
    if (profile) {
      let title = 'Maintenance request update';
      let message = `Request ${requestNumber} for ${asset} status: ${status}.`;
      let priority: NotificationPriority = 'medium';
      if (status === 'rejected') {
        title = 'Maintenance request rejected';
        message = `Request ${requestNumber} for ${asset} was rejected. Open the request for details or to submit a clarification.`;
        priority = 'high';
      } else if (status === 'approved') {
        title = 'Maintenance request approved';
        message = `Request ${requestNumber} for ${asset} has been approved.`;
        priority = 'medium';
      } else if (status === 'assigned') {
        title = 'Work assigned to your request';
        message = `Request ${requestNumber} for ${asset} has been assigned for repair.`;
        priority = 'medium';
      } else if (status === 'in_progress') {
        title = 'Work has started';
        message = `Work has started on request ${requestNumber} for ${asset}.`;
        priority = 'medium';
      } else if (status === 'completed') {
        const finalCondition = pickPayloadString(event.payload ?? {}, 'final_equipment_condition');
        title = 'Request completed';
        message = finalCondition === 'functional'
          ? `Your maintenance request for ${asset} has been completed. The equipment is now functional.`
          : `Your maintenance request for ${asset} has been completed. The equipment is ${formatEquipmentConditionForMessage(finalCondition)}.`;
        priority = 'medium';
      }
      rows.push(
        buildRow(event, profile, {
          category: 'request',
          title,
          message,
          priority,
        }),
      );
    }
  }

  if (departmentId) {
    const heads = await getDepartmentHeads(client, departmentId);
    for (const r of heads) {
      rows.push(
        buildRow(event, r, {
          category: 'request',
          title: 'Department request update',
          message: `Request ${requestNumber} for ${asset} status: ${status}.`,
          priority: 'medium',
        }),
      );
    }
  }

  return rows;
}

async function rule_workOrderAssigned(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const asset = describeAsset(event);
  const woNumber = describeWorkOrder(event);
  // NOTIF-01: accept either canonical key. `technician_profile_id` is the
  // canonical assignment field; `assigned_to` is what some emit sites used
  // historically. Both must resolve to the same notification recipient.
  const technicianId =
    pickPayloadString(event.payload ?? {}, 'technician_profile_id') ??
    pickPayloadString(event.payload ?? {}, 'assigned_to');
  const priority = pickPayloadString(event.payload ?? {}, 'priority') ?? 'medium';
  const isCritical = priority === 'critical' || priority === 'high';

  if (technicianId) {
    const profile = await getProfileById(client, technicianId);
    if (profile) {
      rows.push(
        buildRow(event, profile, {
          category: isCritical ? 'critical' : 'task',
          title: isCritical ? 'Critical work assigned to you' : 'Work assigned to you',
          message: `${woNumber} for ${asset} is assigned to you (${priority}).`,
          priority: isCritical ? 'critical' : 'high',
        }),
      );
    }
  }

  // BME leadership also tracks high/critical assignments
  if (isCritical) {
    const leadership = await getLeadershipRecipients(client);
    for (const r of leadership) {
      rows.push(
        buildRow(event, r, {
          category: 'task',
          title: 'Critical work order assigned',
          message: `${woNumber} for ${asset} has been assigned. Priority: ${priority}.`,
          priority: 'high',
        }),
      );
    }
  }
  return rows;
}

async function rule_workOrderStatus(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const asset = describeAsset(event);
  const woNumber = describeWorkOrder(event);
  const status = pickPayloadString(event.payload ?? {}, 'status') ?? event.event_type;
  const technicianId = pickPayloadString(event.payload ?? {}, 'assigned_to');
  const departmentId = await getRelevantAssetDepartment(client, event);

  // Technician on assigned work
  if (technicianId) {
    const profile = await getProfileById(client, technicianId);
    if (profile) {
      let title = 'Work order update';
      let message = `${woNumber} for ${asset} status: ${status}.`;
      let priority: NotificationPriority = 'medium';
      if (event.event_type === 'work_order.on_hold') {
        title = 'Work order on hold';
        message = `${woNumber} for ${asset} has been placed on hold.`;
        priority = 'high';
      } else if (event.event_type === 'work_order.completed') {
        title = 'Work order completed';
        message = `${woNumber} for ${asset} has been completed.`;
        priority = 'medium';
      }
      rows.push(
        buildRow(event, profile, {
          category: 'task',
          title,
          message,
          priority,
        }),
      );
    }
  }

  // Leadership for on_hold + completed of critical work
  if (event.event_type === 'work_order.on_hold' || event.event_type === 'work_order.completed') {
    const leadership = await getLeadershipRecipients(client);
    for (const r of leadership) {
      rows.push(
        buildRow(event, r, {
          category: event.event_type === 'work_order.on_hold' ? 'critical' : 'task',
          title:
            event.event_type === 'work_order.on_hold'
              ? 'Work order on hold'
              : 'Work order completed',
          message: `${woNumber} for ${asset} ${
            event.event_type === 'work_order.on_hold' ? 'is on hold' : 'has been completed'
          }.`,
          priority: event.event_type === 'work_order.on_hold' ? 'high' : 'medium',
        }),
      );
    }
  }

  // Department head if work is completed (visibility on their request)
  if (event.event_type === 'work_order.completed' && departmentId) {
    const heads = await getDepartmentHeads(client, departmentId);
    for (const r of heads) {
      rows.push(
        buildRow(event, r, {
          category: 'request',
          title: 'Repair completed in your department',
          message: `${asset} repair (${woNumber}) is completed.`,
          priority: 'medium',
        }),
      );
    }
  }

  return rows;
}

async function rule_pmOverdue(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const asset = describeAsset(event);
  const leadership = await getLeadershipRecipients(client);
  for (const r of leadership) {
    rows.push(
      buildRow(event, r, {
        category: 'compliance',
        title: 'PM overdue',
        message: `Preventive maintenance is overdue for ${asset}.`,
        priority: 'high',
      }),
    );
  }
  const technicianId = pickPayloadString(event.payload ?? {}, 'assigned_to');
  if (technicianId) {
    const profile = await getProfileById(client, technicianId);
    if (profile) {
      rows.push(
        buildRow(event, profile, {
          category: 'task',
          title: 'PM task overdue',
          message: `Preventive maintenance for ${asset} is overdue.`,
          priority: 'high',
        }),
      );
    }
  }
  return rows;
}

async function rule_pmAssignedOrCompleted(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const asset = describeAsset(event);
  const technicianId = pickPayloadString(event.payload ?? {}, 'assigned_to');
  if (event.event_type === 'pm.assigned' && technicianId) {
    const profile = await getProfileById(client, technicianId);
    if (profile) {
      rows.push(
        buildRow(event, profile, {
          category: 'task',
          title: 'PM task assigned',
          message: `Preventive maintenance for ${asset} has been assigned to you.`,
          priority: 'medium',
        }),
      );
    }
  }
  if (event.event_type === 'pm.completed') {
    const leadership = await getLeadershipRecipients(client);
    for (const r of leadership) {
      rows.push(
        buildRow(event, r, {
          category: 'compliance',
          title: 'PM completed',
          message: `Preventive maintenance has been completed for ${asset}.`,
          priority: 'info',
        }),
      );
    }
  }
  return rows;
}

async function rule_calibration(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const asset = describeAsset(event);
  const leadership = await getLeadershipRecipients(client);

  if (event.event_type === 'calibration.overdue') {
    for (const r of leadership) {
      rows.push(
        buildRow(event, r, {
          category: 'compliance',
          title: 'Calibration overdue',
          message: `Calibration is overdue for ${asset}.`,
          priority: 'high',
        }),
      );
    }
  } else if (event.event_type === 'calibration.failed_or_adjusted') {
    const result = pickPayloadString(event.payload ?? {}, 'result') ?? 'fail';
    for (const r of leadership) {
      rows.push(
        buildRow(event, r, {
          category: 'compliance',
          title: 'Calibration result requires attention',
          message: `Calibration result for ${asset} is "${result}".`,
          priority: 'high',
        }),
      );
    }
  } else if (event.event_type === 'calibration.request_created') {
    for (const r of leadership) {
      rows.push(
        buildRow(event, r, {
          category: 'request',
          title: 'Calibration request submitted',
          message: `A calibration request for ${asset} is awaiting review.`,
          priority: 'medium',
        }),
      );
    }
  } else if (event.event_type === 'calibration.request_status_changed') {
    const status = pickPayloadString(event.payload ?? {}, 'status') ?? 'updated';
    const requesterId = pickPayloadString(event.payload ?? {}, 'requested_by');
    if (requesterId) {
      const profile = await getProfileById(client, requesterId);
      if (profile) {
        rows.push(
          buildRow(event, profile, {
            category: 'request',
            title: 'Calibration request update',
            message: `Calibration request for ${asset} status: ${status}.`,
            priority: 'medium',
          }),
        );
      }
    }
  }
  return rows;
}

async function rule_stock(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const part = describePart(event);
  const storeUsers = await getStoreUsers(client);
  const leadership = await getLeadershipRecipients(client);

  if (event.event_type === 'spare_part.stockout') {
    for (const r of dedupeRecipients([...storeUsers, ...leadership])) {
      rows.push(
        buildRow(event, r, {
          category: 'stock',
          title: 'Stockout',
          message: `${part} is out of stock.`,
          priority: 'high',
        }),
      );
    }
  } else if (event.event_type === 'spare_part.low_stock') {
    const onHand = pickPayloadNumber(event.payload ?? {}, 'on_hand');
    const minLevel = pickPayloadNumber(event.payload ?? {}, 'minimum_level')
      ?? pickPayloadNumber(event.payload ?? {}, 'reorder_level');
    for (const r of storeUsers) {
      rows.push(
        buildRow(event, r, {
          category: 'stock',
          title: 'Low stock',
          message: `${part} is low (on hand ${onHand ?? '?'} / min ${minLevel ?? '?'}).`,
          priority: 'medium',
        }),
      );
    }
  } else if (event.event_type === 'spare_part.restocked') {
    // R9: confirmation event. Store User sees that the part is back above
    // reorder level. Low priority — informational only, no Telegram by
    // default (TELEGRAM_MIN_PRIORITY filters it out).
    const onHand = pickPayloadNumber(event.payload ?? {}, 'on_hand');
    const reorder = pickPayloadNumber(event.payload ?? {}, 'reorder_level');
    for (const r of storeUsers) {
      rows.push(
        buildRow(event, r, {
          category: 'stock',
          title: 'Stock restocked',
          message: `${part} is back above the reorder level (on hand ${onHand ?? '?'} / reorder ${reorder ?? '?'}).`,
          priority: 'low',
        }),
      );
    }
  } else if (event.event_type === 'work_order.stock_blocked') {
    const asset = describeAsset(event);
    for (const r of dedupeRecipients([...storeUsers, ...leadership])) {
      rows.push(
        buildRow(event, r, {
          category: 'stock',
          title: 'Stock blocker delaying repair',
          message: `A repair for ${asset} is blocked by missing stock${part ? ` (${part})` : ''}.`,
          priority: 'high',
        }),
      );
    }
  } else if (event.event_type === 'reorder.requested') {
    for (const r of storeUsers) {
      rows.push(
        buildRow(event, r, {
          category: 'procurement',
          title: 'Reorder requested',
          message: `Reorder requested for ${part}.`,
          priority: 'medium',
        }),
      );
    }
    for (const r of leadership) {
      rows.push(
        buildRow(event, r, {
          category: 'procurement',
          title: 'Reorder requested',
          message: `Store has requested a reorder for ${part}.`,
          priority: 'medium',
        }),
      );
    }
  }
  return rows;
}

async function rule_procurement(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const description = pickPayloadString(event.payload ?? {}, 'description') ?? 'a procurement request';
  const storeUsers = await getStoreUsers(client);
  const leadership = await getLeadershipRecipients(client);
  if (event.event_type === 'procurement.delayed') {
    for (const r of dedupeRecipients([...storeUsers, ...leadership])) {
      rows.push(
        buildRow(event, r, {
          category: 'procurement',
          title: 'Procurement delayed',
          message: `Procurement is delayed: ${description}.`,
          priority: 'high',
        }),
      );
    }
  } else if (event.event_type === 'procurement.delivered') {
    for (const r of storeUsers) {
      rows.push(
        buildRow(event, r, {
          category: 'procurement',
          title: 'Procurement delivered',
          message: `Delivery ready for receive: ${description}.`,
          priority: 'medium',
        }),
      );
    }
  } else if (event.event_type === 'procurement.delivered_pending_receipt') {
    // R21: Store User gets a clear "record receipt" action item. The action
    // link in the payload deep-links to /spare-parts with the receipt modal
    // prefilled (procurement_id pre-set, so the resulting stock_receipts
    // row carries the procurement linkage).
    for (const r of storeUsers) {
      rows.push(
        buildRow(event, r, {
          category: 'procurement',
          title: 'Record stock receipt for delivered procurement',
          message: `Delivered: ${description}. Click to record the stock receipt — current_stock is not updated until you do.`,
          priority: 'medium',
        }),
      );
    }
  }
  return rows;
}

async function rule_replacement(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const asset = describeAsset(event);
  const leadership = await getLeadershipRecipients(client);
  for (const r of leadership) {
    rows.push(
      buildRow(event, r, {
        category: 'replacement',
        title: event.event_type === 'replacement.strong_candidate'
          ? 'Strong replacement candidate'
          : 'Replacement review candidate',
        message: `${asset} should be reviewed for replacement.`,
        priority: event.event_type === 'replacement.strong_candidate' ? 'high' : 'medium',
      }),
    );
  }
  const viewers = await getViewers(client);
  for (const r of viewers) {
    rows.push(
      buildRow(event, r, {
        category: 'management',
        title: 'Replacement review may affect service',
        message: `${asset} has been flagged for replacement review.`,
        priority: 'medium',
      }),
    );
  }
  return rows;
}

async function rule_riskCritical(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const asset = describeAsset(event);
  const leadership = await getLeadershipRecipients(client);
  for (const r of leadership) {
    rows.push(
      buildRow(event, r, {
        category: 'critical',
        title: 'Critical asset risk',
        message: `${asset} risk level is critical.`,
        priority: 'critical',
      }),
    );
  }
  const viewers = await getViewers(client);
  for (const r of viewers) {
    rows.push(
      buildRow(event, r, {
        category: 'management',
        title: 'Critical equipment risk increased',
        message: `${asset} has been flagged as critical risk.`,
        priority: 'high',
      }),
    );
  }
  return rows;
}

async function rule_departmentReadiness(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const dept = describeDepartment(event);
  if (!event.department_id) return rows;
  const heads = await getDepartmentHeads(client, event.department_id);
  const users = await getDepartmentUsers(client, event.department_id);
  const leadership = await getLeadershipRecipients(client);
  const viewers = await getViewers(client);

  if (event.event_type === 'department.readiness_risk') {
    for (const r of dedupeRecipients([...heads, ...users, ...leadership])) {
      rows.push(
        buildRow(event, r, {
          category: 'management',
          title: 'Department readiness risk',
          message: `${dept} readiness has dropped.`,
          priority: 'high',
        }),
      );
    }
    for (const r of viewers) {
      rows.push(
        buildRow(event, r, {
          category: 'management',
          title: 'Service readiness risk',
          message: `${dept} readiness has dropped.`,
          priority: 'high',
        }),
      );
    }
  } else if (event.event_type === 'department.critical_asset_down') {
    const asset = describeAsset(event);
    for (const r of dedupeRecipients([...heads, ...leadership])) {
      rows.push(
        buildRow(event, r, {
          category: 'critical',
          title: 'Critical equipment down',
          message: `${asset} in ${dept} is currently down.`,
          priority: 'critical',
        }),
      );
    }
    for (const r of viewers) {
      rows.push(
        buildRow(event, r, {
          category: 'management',
          title: 'Critical equipment affecting service',
          message: `${asset} in ${dept} is currently down.`,
          priority: 'high',
        }),
      );
    }
  }
  return rows;
}

async function rule_offline(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const actorId = pickPayloadString(event.payload ?? {}, 'actor_profile_id');
  const description = pickPayloadString(event.payload ?? {}, 'description') ?? 'an offline action';
  const leadership = await getLeadershipRecipients(client);

  if (event.event_type === 'offline_sync.conflict') {
    for (const r of leadership) {
      rows.push(
        buildRow(event, r, {
          category: 'offline',
          title: 'Offline sync conflict needs review',
          message: `${description} produced a sync conflict.`,
          priority: 'high',
        }),
      );
    }
  }
  if (actorId) {
    const profile = await getProfileById(client, actorId);
    if (profile) {
      rows.push(
        buildRow(event, profile, {
          category: 'offline',
          title:
            event.event_type === 'offline_sync.conflict'
              ? 'Your offline action needs review'
              : 'Your offline action failed',
          message: `${description} ${
            event.event_type === 'offline_sync.conflict' ? 'conflicted with server state' : 'failed during sync'
          }.`,
          priority: 'high',
        }),
      );
    }
  }
  return rows;
}

async function rule_qr(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const asset = describeAsset(event);
  const leadership = await getLeadershipRecipients(client);
  if (event.event_type === 'qr.label_needs_replacement') {
    for (const r of leadership) {
      rows.push(
        buildRow(event, r, {
          category: 'qr',
          title: 'QR label needs replacement',
          message: `QR label for ${asset} has been marked needs replacement.`,
          priority: 'medium',
        }),
      );
    }
  } else if (event.event_type === 'qr.revoked_scanned') {
    for (const r of leadership) {
      rows.push(
        buildRow(event, r, {
          category: 'qr',
          title: 'Revoked QR token scanned',
          message: `A revoked QR token for ${asset} was scanned.`,
          priority: 'high',
        }),
      );
    }
  }
  return rows;
}

async function rule_system(
  client: DbClient,
  event: NotificationEventRow,
): Promise<CreateNotificationInput[]> {
  const rows: CreateNotificationInput[] = [];
  const developers = await getDevelopers(client);
  if (event.event_type === 'copilot.provider_failure') {
    for (const r of developers) {
      rows.push(
        buildRow(event, r, {
          category: 'system',
          title: 'AI Copilot provider failure',
          message: `Copilot provider returned a failure. Open Developer Lab diagnostics for details.`,
          priority: 'medium',
        }),
      );
    }
  } else if (event.event_type === 'notification.rule_failed') {
    const rule = pickPayloadString(event.payload ?? {}, 'rule_name') ?? 'unknown';
    for (const r of developers) {
      rows.push(
        buildRow(event, r, {
          category: 'system',
          title: 'Notification rule failed',
          message: `Rule "${rule}" failed while processing an event.`,
          priority: 'medium',
        }),
      );
    }
  } else if (event.event_type === 'system.test_notification') {
    const targetId = pickPayloadString(event.payload ?? {}, 'target_profile_id');
    if (targetId) {
      const profile = await getProfileById(client, targetId);
      if (profile) {
        rows.push(
          buildRow(event, profile, {
            category: 'system',
            title: 'Test notification',
            message:
              pickPayloadString(event.payload ?? {}, 'message') ?? 'This is a test notification from BMEDIS.',
            priority: event.priority,
          }),
        );
      }
    } else {
      for (const r of developers) {
        rows.push(
          buildRow(event, r, {
            category: 'system',
            title: 'Test notification',
            message:
              pickPayloadString(event.payload ?? {}, 'message') ?? 'This is a test notification from BMEDIS.',
            priority: event.priority,
          }),
        );
      }
    }
  }
  return rows;
}

// ─── Public dispatcher ──────────────────────────────────────────────────────

export interface RuleResult {
  rule_name: string;
  rows: CreateNotificationInput[];
  status: 'matched' | 'skipped' | 'failed';
  error?: string;
  diagnostics?: Record<string, unknown>;
}

export async function applyNotificationRules(
  client: DbClient,
  event: NotificationEventRow,
): Promise<RuleResult> {
  const eventType = event.event_type as NotificationEventType;
  try {
    switch (eventType) {
      case 'maintenance_request.created':
        return await matchedRule(client, event, 'maintenance_request_created', await rule_maintenanceRequestCreated(client, event));
      case 'maintenance_request.status_changed':
        return await matchedRule(client, event, 'maintenance_request_status_changed', await rule_maintenanceRequestStatusChanged(client, event));
      case 'work_order.assigned':
        return await matchedRule(client, event, 'work_order_assigned', await rule_workOrderAssigned(client, event));
      case 'work_order.created':
      case 'work_order.status_changed':
      case 'work_order.on_hold':
      case 'work_order.completed':
      case 'work_order.aging_or_overdue':
        return await matchedRule(client, event, 'work_order_status', await rule_workOrderStatus(client, event));
      case 'pm.overdue':
        return await matchedRule(client, event, 'pm_overdue', await rule_pmOverdue(client, event));
      case 'pm.assigned':
      case 'pm.completed':
        return await matchedRule(client, event, 'pm_assigned_or_completed', await rule_pmAssignedOrCompleted(client, event));
      case 'calibration.overdue':
      case 'calibration.failed_or_adjusted':
      case 'calibration.request_created':
      case 'calibration.request_status_changed':
        return await matchedRule(client, event, 'calibration', await rule_calibration(client, event));
      case 'spare_part.stockout':
      case 'spare_part.low_stock':
      case 'spare_part.restocked':
      case 'work_order.stock_blocked':
      case 'reorder.requested':
        return await matchedRule(client, event, 'stock', await rule_stock(client, event));
      case 'procurement.delayed':
      case 'procurement.delivered':
      case 'procurement.delivered_pending_receipt':
        return await matchedRule(client, event, 'procurement', await rule_procurement(client, event));
      case 'replacement.review_candidate':
      case 'replacement.strong_candidate':
        return await matchedRule(client, event, 'replacement', await rule_replacement(client, event));
      case 'risk.critical_asset_risk':
        return await matchedRule(client, event, 'risk_critical', await rule_riskCritical(client, event));
      case 'department.readiness_risk':
      case 'department.critical_asset_down':
        return await matchedRule(client, event, 'department_readiness', await rule_departmentReadiness(client, event));
      case 'offline_sync.conflict':
      case 'offline_sync.failed':
        return await matchedRule(client, event, 'offline', await rule_offline(client, event));
      case 'qr.label_needs_replacement':
      case 'qr.revoked_scanned':
        return await matchedRule(client, event, 'qr', await rule_qr(client, event));
      case 'copilot.provider_failure':
      case 'notification.rule_failed':
      case 'system.test_notification':
        return await matchedRule(client, event, 'system', await rule_system(client, event));
      default:
        return {
          rule_name: 'unhandled',
          rows: [],
          status: 'skipped',
        };
    }
  } catch (err) {
    return {
      rule_name: 'rule_dispatcher',
      rows: [],
      status: 'failed',
      error: err instanceof Error ? err.message : 'unknown_rule_error',
    };
  }
}

// Expose helpers in case the engine needs to do an admin recipient lookup
// outside of a rule (e.g. when sending a test notification).
export {
  getAdmins,
  getBmeHeads,
  getDevelopers,
  getLeadershipRecipients,
  getStoreUsers,
  getViewers,
};
