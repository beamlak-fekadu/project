// Phase 4 QR role context service.
//
// Server-only. The QR token resolves an asset, but this service decides what
// contextual evidence is loaded from the authenticated user's role/profile.
// Every query is best-effort and uses the normal Supabase server client/RLS.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { buildAssetQrPath, buildAssetQrUrl, getQrBaseUrl } from '@/utils/qr/url';
import { isValidQrTokenFormat, maskQrToken } from '@/utils/qr/token';
import type { QrLandingAsset } from './qr.service';

type Client = SupabaseClient;

export type QrRoleCategory =
  | 'developer'
  | 'bme_head'
  | 'technician'
  | 'department_head'
  | 'department_user'
  | 'store_user'
  | 'viewer'
  | 'unknown';

export type QrProfileContext = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  job_title?: string | null;
  department_id?: string | null;
  roleNames: string[];
};

export type QrQueryHealth = {
  section: string;
  ok: boolean;
  unavailable?: boolean;
  message?: string;
};

export type QrMaintenanceRequestRow = {
  id: string;
  request_number: string | null;
  status: string | null;
  urgency: string | null;
  request_type: string | null;
  fault_description: string | null;
  reported_condition: string | null;
  requested_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type QrWorkOrderRow = {
  id: string;
  work_order_number: string | null;
  status: string | null;
  priority: string | null;
  work_type: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  request_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type QrPmScheduleRow = {
  id: string;
  status: string | null;
  scheduled_date: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  completed_at: string | null;
  updated_at: string | null;
};

export type QrCalibrationRecordRow = {
  id: string;
  result: string | null;
  calibration_date: string | null;
  next_due_date: string | null;
  updated_at: string | null;
};

export type QrCalibrationRequestRow = {
  id: string;
  request_number: string | null;
  status: string | null;
  urgency: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type QrMaintenanceEventRow = {
  id: string;
  event_type: string | null;
  action_taken: string | null;
  completion_date: string | null;
  work_order_id: string | null;
  created_at: string | null;
};

export type QrStockIssueRow = {
  id: string;
  quantity: number | null;
  issue_date: string | null;
  notes: string | null;
  part_id: string | null;
  part_code: string | null;
  part_name: string | null;
  work_order_id: string | null;
  maintenance_event_id: string | null;
};

export type QrProcurementLinkRow = {
  id: string;
  request_number: string | null;
  title: string | null;
  status: string | null;
  priority: string | null;
  created_at: string | null;
  source: 'specification_request';
};

export type QrRecommendationFlagRow = {
  id: string;
  flag_type: string | null;
  severity: string | null;
  message: string | null;
  generated_at: string | null;
};

export type QrRiskSummary = {
  rpn: number | null;
  risk_level: string | null;
  computed_at: string | null;
};

export type QrReplacementSummary = {
  replacement_priority_index: number | null;
  rank: number | null;
  computed_at: string | null;
  band: 'strong_candidate' | 'review_candidate' | 'monitor' | 'unavailable';
};

export type QrRoleContext = {
  roleCategory: QrRoleCategory;
  restricted: boolean;
  restrictedReason?: string;
  queryHealth: QrQueryHealth[];
  route: {
    path: string | null;
    url: string | null;
    baseUrl: string;
    maskedToken: string;
    tokenFormatValid: boolean;
  };
  requests: {
    open: QrMaintenanceRequestRow[];
    department: QrMaintenanceRequestRow[];
    mine: QrMaintenanceRequestRow[];
  };
  workOrders: {
    open: QrWorkOrderRow[];
    assignedToMe: QrWorkOrderRow[];
    otherOpen: QrWorkOrderRow[];
    onHold: QrWorkOrderRow[];
    completedRecent: QrWorkOrderRow[];
  };
  pm: {
    active: QrPmScheduleRow[];
    overdue: QrPmScheduleRow[];
    assignedToMe: QrPmScheduleRow[];
  };
  calibration: {
    latest: QrCalibrationRecordRow | null;
    recent: QrCalibrationRecordRow[];
    state: 'overdue' | 'due_soon' | 'current' | 'no_history' | 'unavailable';
    openRequests: QrCalibrationRequestRow[];
  };
  parts: {
    stockIssues: QrStockIssueRow[];
    procurementLinks: QrProcurementLinkRow[];
    stockFlags: QrRecommendationFlagRow[];
    hasDirectStockEvidence: boolean;
  };
  history: {
    maintenanceEvents: QrMaintenanceEventRow[];
    completedWorkOrders: QrWorkOrderRow[];
    calibrationRecords: QrCalibrationRecordRow[];
  };
  decisionSupport: {
    risk: QrRiskSummary | null;
    replacement: QrReplacementSummary | null;
  };
};

const OPEN_REQUEST_STATUSES = ['pending', 'approved', 'assigned', 'in_progress'];
const OPEN_WO_STATUSES = ['open', 'pending', 'assigned', 'in_progress', 'on_hold'];
const ACTIVE_PM_STATUSES = ['scheduled', 'in_progress', 'overdue', 'deferred'];
const CALIBRATION_DUE_SOON_DAYS = 30;

async function resolveClient(client?: Client): Promise<Client> {
  if (client) return client;
  return (await createClient()) as unknown as Client;
}

export function getQrRoleCategory(roleNames: string[]): QrRoleCategory {
  if (roleNames.includes('developer')) return 'developer';
  if (roleNames.includes('bme_head') || roleNames.includes('admin')) return 'bme_head';
  if (roleNames.includes('technician')) return 'technician';
  if (roleNames.includes('store_user')) return 'store_user';
  if (roleNames.includes('department_head')) return 'department_head';
  if (roleNames.includes('department_user')) return 'department_user';
  if (roleNames.includes('viewer')) return 'viewer';
  return 'unknown';
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function replacementBand(score: number | null): QrReplacementSummary['band'] {
  if (score == null) return 'unavailable';
  if (score >= 0.7) return 'strong_candidate';
  if (score >= 0.55) return 'review_candidate';
  return 'monitor';
}

function calibrationState(latest: QrCalibrationRecordRow | null): QrRoleContext['calibration']['state'] {
  if (!latest) return 'no_history';
  if (!latest.next_due_date) return 'no_history';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(latest.next_due_date);
  due.setHours(0, 0, 0, 0);
  if (Number.isNaN(due.getTime())) return 'unavailable';
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= CALIBRATION_DUE_SOON_DAYS) return 'due_soon';
  return 'current';
}

function baseContext(asset: QrLandingAsset, roleCategory: QrRoleCategory): QrRoleContext {
  return {
    roleCategory,
    restricted: false,
    queryHealth: [],
    route: {
      path: buildAssetQrPath(asset.qr_token),
      url: buildAssetQrUrl(asset.qr_token),
      baseUrl: getQrBaseUrl(),
      maskedToken: maskQrToken(asset.qr_token),
      tokenFormatValid: isValidQrTokenFormat(asset.qr_token),
    },
    requests: { open: [], department: [], mine: [] },
    workOrders: { open: [], assignedToMe: [], otherOpen: [], onHold: [], completedRecent: [] },
    pm: { active: [], overdue: [], assignedToMe: [] },
    calibration: { latest: null, recent: [], state: 'unavailable', openRequests: [] },
    parts: { stockIssues: [], procurementLinks: [], stockFlags: [], hasDirectStockEvidence: false },
    history: { maintenanceEvents: [], completedWorkOrders: [], calibrationRecords: [] },
    decisionSupport: { risk: null, replacement: null },
  };
}

function mapRequest(row: Record<string, unknown>): QrMaintenanceRequestRow {
  return {
    id: String(row.id),
    request_number: asText(row.request_number),
    status: asText(row.status),
    urgency: asText(row.urgency),
    request_type: asText(row.request_type),
    fault_description: asText(row.fault_description),
    reported_condition: asText(row.reported_condition),
    requested_by: asText(row.requested_by),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
  };
}

function mapWorkOrder(row: Record<string, unknown>): QrWorkOrderRow {
  const profile = firstRelation(row.profiles as Record<string, unknown> | Record<string, unknown>[] | null);
  return {
    id: String(row.id),
    work_order_number: asText(row.work_order_number),
    status: asText(row.status),
    priority: asText(row.priority),
    work_type: asText(row.work_type),
    assigned_to: asText(row.assigned_to),
    assigned_to_name: asText(profile?.full_name) ?? asText(profile?.email),
    request_id: asText(row.request_id),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
    started_at: asText(row.started_at),
    completed_at: asText(row.completed_at),
  };
}

function mapPm(row: Record<string, unknown>): QrPmScheduleRow {
  const profile = firstRelation(row.profiles as Record<string, unknown> | Record<string, unknown>[] | null);
  return {
    id: String(row.id),
    status: asText(row.status),
    scheduled_date: asText(row.scheduled_date),
    assigned_to: asText(row.assigned_to),
    assigned_to_name: asText(profile?.full_name) ?? asText(profile?.email),
    completed_at: asText(row.completed_at),
    updated_at: asText(row.updated_at),
  };
}

function mapCalibration(row: Record<string, unknown>): QrCalibrationRecordRow {
  return {
    id: String(row.id),
    result: asText(row.result),
    calibration_date: asText(row.calibration_date),
    next_due_date: asText(row.next_due_date),
    updated_at: asText(row.updated_at),
  };
}

function mapEvent(row: Record<string, unknown>): QrMaintenanceEventRow {
  return {
    id: String(row.id),
    event_type: asText(row.event_type),
    action_taken: asText(row.action_taken),
    completion_date: asText(row.completion_date),
    work_order_id: asText(row.work_order_id),
    created_at: asText(row.created_at),
  };
}

function mapStockIssue(row: Record<string, unknown>): QrStockIssueRow {
  const part = firstRelation(row.spare_parts as Record<string, unknown> | Record<string, unknown>[] | null);
  const event = firstRelation(row.maintenance_events as Record<string, unknown> | Record<string, unknown>[] | null);
  return {
    id: String(row.id),
    quantity: asNumber(row.quantity),
    issue_date: asText(row.issue_date),
    notes: asText(row.notes),
    part_id: asText(row.part_id),
    part_code: asText(part?.part_code),
    part_name: asText(part?.name),
    work_order_id: asText(event?.work_order_id),
    maintenance_event_id: asText(row.issued_to_event_id),
  };
}

function mapProcurementLink(row: Record<string, unknown>): QrProcurementLinkRow | null {
  const procurement = firstRelation(row.procurement_requests as Record<string, unknown> | Record<string, unknown>[] | null);
  if (!procurement?.id) return null;
  return {
    id: String(procurement.id),
    request_number: asText(procurement.request_number),
    title: asText(procurement.title),
    status: asText(procurement.status),
    priority: asText(procurement.priority),
    created_at: asText(procurement.created_at),
    source: 'specification_request',
  };
}

function mapFlag(row: Record<string, unknown>): QrRecommendationFlagRow {
  return {
    id: String(row.id),
    flag_type: asText(row.flag_type),
    severity: asText(row.severity),
    message: asText(row.message),
    generated_at: asText(row.generated_at),
  };
}

function isPmOverdue(row: QrPmScheduleRow): boolean {
  if (row.status === 'overdue') return true;
  if (!row.scheduled_date || row.status !== 'scheduled') return false;
  const due = new Date(row.scheduled_date);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

async function runQuery<T>(
  health: QrQueryHealth[],
  section: string,
  loader: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    const value = await loader();
    health.push({ section, ok: true });
    return value;
  } catch (err) {
    const message = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : 'Query failed';
    health.push({ section, ok: false, unavailable: true, message });
    return fallback;
  }
}

export async function getQrRoleContext({
  asset,
  profile,
  client,
}: {
  asset: QrLandingAsset;
  profile: QrProfileContext;
  client?: Client;
}): Promise<QrRoleContext> {
  const supabase = await resolveClient(client);
  const roleCategory = getQrRoleCategory(profile.roleNames);
  const context = baseContext(asset, roleCategory);

  if (roleCategory === 'department_head' || roleCategory === 'department_user') {
    if (!profile.department_id) {
      return {
        ...context,
        restricted: true,
        restrictedReason:
          'Your profile is not linked to a department. Contact an administrator before using QR scans for department workflows.',
      };
    }
    if (!asset.department_id || profile.department_id !== asset.department_id) {
      return {
        ...context,
        restricted: true,
        restrictedReason:
          'This asset is not linked to your department. Operational QR details and request actions are hidden.',
      };
    }
  }

  const health = context.queryHealth;

  // Source table: maintenance_requests. Used for open issues, department
  // request history, and "my requests" on request-focused role views.
  const requestRows = await runQuery(health, 'maintenance_requests', async () => {
    const { data, error } = await supabase
      .from('maintenance_requests')
      .select('id, request_number, status, urgency, request_type, fault_description, reported_condition, requested_by, created_at, updated_at')
      .eq('asset_id', asset.id)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapRequest);
  }, []);

  context.requests.open = requestRows.filter((row) => row.status ? OPEN_REQUEST_STATUSES.includes(row.status) : false);
  context.requests.department = requestRows;
  context.requests.mine = requestRows.filter((row) => row.requested_by === profile.id);

  // Source table: work_orders joined to profiles. Used for exact work evidence
  // and technician "assigned to me" filtering.
  const workRows = await runQuery(health, 'work_orders', async () => {
    const { data, error } = await supabase
      .from('work_orders')
      .select('id, work_order_number, status, priority, work_type, assigned_to, request_id, created_at, updated_at, started_at, completed_at, profiles(full_name, email)')
      .eq('asset_id', asset.id)
      .order('created_at', { ascending: false })
      .limit(35);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapWorkOrder);
  }, []);

  context.workOrders.open = workRows.filter((row) => row.status ? OPEN_WO_STATUSES.includes(row.status) : false);
  context.workOrders.assignedToMe = context.workOrders.open.filter((row) => row.assigned_to === profile.id);
  context.workOrders.otherOpen = context.workOrders.open.filter((row) => row.assigned_to !== profile.id);
  context.workOrders.onHold = context.workOrders.open.filter((row) => row.status === 'on_hold');
  context.workOrders.completedRecent = workRows.filter((row) => row.status === 'completed').slice(0, 5);

  // Source table: pm_schedules joined to profiles. Used for active PM,
  // overdue PM, and technician assigned PM context.
  const pmRows = await runQuery(health, 'pm_schedules', async () => {
    const { data, error } = await supabase
      .from('pm_schedules')
      // FK hint: pm_schedules has two FKs to profiles (assigned_to, completed_by).
      // QR context wants the technician currently assigned to the upcoming PM.
      .select('id, status, scheduled_date, assigned_to, completed_at, updated_at, profiles!pm_schedules_assigned_to_fkey(full_name, email)')
      .eq('asset_id', asset.id)
      .order('scheduled_date', { ascending: false })
      .limit(25);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapPm);
  }, []);

  context.pm.active = pmRows.filter((row) => row.status ? ACTIVE_PM_STATUSES.includes(row.status) : false);
  context.pm.overdue = context.pm.active.filter(isPmOverdue);
  context.pm.assignedToMe = context.pm.active.filter((row) => row.assigned_to === profile.id);

  // Source table: calibration_records. Used for latest due state and recent
  // calibration history. Missing history is displayed as a real empty state.
  const calibrationRows = await runQuery(health, 'calibration_records', async () => {
    const { data, error } = await supabase
      .from('calibration_records')
      .select('id, result, calibration_date, next_due_date, updated_at')
      .eq('asset_id', asset.id)
      .order('calibration_date', { ascending: false })
      .limit(8);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapCalibration);
  }, []);
  context.calibration.recent = calibrationRows;
  context.calibration.latest = calibrationRows[0] ?? null;
  context.calibration.state = calibrationState(context.calibration.latest);

  // Source table: calibration_requests. Used for "open calibration request"
  // routing in the QR action builder — when present, calibration row actions
  // open the exact pending/approved request instead of a filtered list.
  context.calibration.openRequests = await runQuery(health, 'calibration_requests', async () => {
    const { data, error } = await supabase
      .from('calibration_requests')
      .select('id, request_number, status, urgency, created_at, updated_at')
      .eq('asset_id', asset.id)
      .in('status', ['pending', 'approved', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      request_number: asText(row.request_number),
      status: asText(row.status),
      urgency: asText(row.urgency),
      created_at: asText(row.created_at),
      updated_at: asText(row.updated_at),
    }));
  }, []);

  // Source table: maintenance_events. Used as service history evidence only.
  const maintenanceEvents = await runQuery(health, 'maintenance_events', async () => {
    const { data, error } = await supabase
      .from('maintenance_events')
      .select('id, event_type, action_taken, completion_date, work_order_id, created_at')
      .eq('asset_id', asset.id)
      .order('created_at', { ascending: false })
      .limit(12);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapEvent);
  }, []);
  context.history.maintenanceEvents = maintenanceEvents;
  context.history.completedWorkOrders = context.workOrders.completedRecent;
  context.history.calibrationRecords = context.calibration.recent;

  // Source tables: stock_issues -> maintenance_events -> spare_parts. This is
  // direct linkage only; no fuzzy asset/part matching is performed.
  const stockIssueRows = await runQuery(health, 'stock_issues', async () => {
    const { data, error } = await supabase
      .from('stock_issues')
      .select('id, part_id, quantity, issue_date, notes, issued_to_event_id, spare_parts(id, part_code, name), maintenance_events!inner(id, asset_id, work_order_id)')
      .eq('maintenance_events.asset_id', asset.id)
      .order('issue_date', { ascending: false })
      .limit(20);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapStockIssue);
  }, []);
  context.parts.stockIssues = stockIssueRows;

  // Source table: specification_requests with procurement_request_id. This is
  // the only direct asset-to-procurement bridge in the current schema.
  const procurementLinks = await runQuery(health, 'specification_requests.procurement_requests', async () => {
    const { data, error } = await supabase
      .from('specification_requests')
      .select('id, procurement_request_id, procurement_requests(id, request_number, title, status, priority, created_at)')
      .eq('asset_id', asset.id)
      .not('procurement_request_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>)
      .map(mapProcurementLink)
      .filter((row): row is QrProcurementLinkRow => Boolean(row));
  }, []);
  context.parts.procurementLinks = procurementLinks;

  // Source table: recommendation_flags. Only stock-related, unacknowledged
  // flags are shown in the parts/blockers context.
  const stockFlags = await runQuery(health, 'recommendation_flags.stock', async () => {
    const { data, error } = await supabase
      .from('recommendation_flags')
      .select('id, flag_type, severity, message, generated_at')
      .eq('asset_id', asset.id)
      .eq('is_acknowledged', false)
      .in('flag_type', ['low_stock', 'part_shortage'])
      .order('generated_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapFlag);
  }, []);
  context.parts.stockFlags = stockFlags;
  context.parts.hasDirectStockEvidence =
    stockIssueRows.length > 0 || procurementLinks.length > 0 || stockFlags.length > 0 || context.workOrders.onHold.length > 0;

  // Source table: equipment_risk_scores. Used only as existing decision
  // support evidence; no narrative or recalculation is generated here.
  context.decisionSupport.risk = await runQuery(health, 'equipment_risk_scores', async () => {
    const { data, error } = await supabase
      .from('equipment_risk_scores')
      .select('rpn, risk_level, computed_at')
      .eq('asset_id', asset.id)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
      rpn: asNumber(row.rpn),
      risk_level: asText(row.risk_level),
      computed_at: asText(row.computed_at),
    };
  }, null);

  // Source table: replacement_priority_scores. Used as existing RPI evidence
  // only; thresholds mirror documented prototype decision bands.
  context.decisionSupport.replacement = await runQuery(health, 'replacement_priority_scores', async () => {
    const { data, error } = await supabase
      .from('replacement_priority_scores')
      .select('replacement_priority_index, rank, computed_at')
      .eq('asset_id', asset.id)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const score = asNumber(row.replacement_priority_index);
    return {
      replacement_priority_index: score,
      rank: asNumber(row.rank),
      computed_at: asText(row.computed_at),
      band: replacementBand(score),
    };
  }, null);

  return context;
}
