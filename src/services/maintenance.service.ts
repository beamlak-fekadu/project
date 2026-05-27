import { createClient } from '@/lib/supabase/client';
import type {
  MaintenanceRequest,
  MaintenanceRequestStatus,
  WorkOrder,
  WorkOrderStatus,
  MaintenanceEvent,
} from '@/types/domain';
import { recomputeAssetAnalytics } from '@/actions/analytics.actions';
import { logAuditEvent } from './audit.service';
import { OPEN_MAINTENANCE_REQUEST_STATUSES, OPEN_WORK_ORDER_STATUSES } from '@/utils/maintenance/request-status';

export interface MaintenanceRequestFilters {
  status?: MaintenanceRequestStatus;
  department_id?: string;
  urgency?: string;
}

export interface WorkOrderFilters {
  status?: WorkOrderStatus;
}

const REQUEST_SELECT = `
  id, request_number, asset_id, requested_by, department_id,
  fault_description, urgency, status, resolved_at, notes,
  reported_condition, reported_condition_source,
  created_at, updated_at,
  equipment_assets(id, asset_code, name, serial_number),
  departments(id, name, code)
`;

const WORK_ORDER_SELECT = `
  id, work_order_number, request_id, asset_id, assigned_to, status, priority,
  work_type, root_cause, action_taken, external_vendor, external_vendor_name,
  closure_notes, estimated_hours, actual_hours, started_at, completed_at,
  completion_outcome, final_equipment_condition,
  created_at, updated_at,
  equipment_assets(id, asset_code, name),
  profiles!work_orders_assigned_to_fkey(id, full_name, email)
`;

const EVENT_SELECT = `
  id, work_order_id, asset_id, event_type, failure_date, downtime_start, downtime_end,
  repair_duration_hours, action_taken, failure_code_id, action_code_id, service_cost,
  completed_by, completion_date, notes, created_at, updated_at,
  failure_codes(id, code, description),
  maintenance_action_codes(id, code, description)
`;

export async function getMaintenanceRequests(filters: MaintenanceRequestFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('maintenance_requests')
    .select(REQUEST_SELECT);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.department_id) query = query.eq('department_id', filters.department_id);
  if (filters.urgency) query = query.eq('urgency', filters.urgency);

  return query.order('created_at', { ascending: false });
}

export async function getRequestById(id: string) {
  const supabase = createClient();
  return supabase
    .from('maintenance_requests')
    .select(REQUEST_SELECT)
    .eq('id', id)
    .single();
}

export async function createRequest(data: Omit<MaintenanceRequest, 'id' | 'request_number' | 'created_at' | 'updated_at' | 'asset' | 'department' | 'requester'>) {
  const supabase = createClient();
  const requestNumber = `MR-${Date.now().toString(36).toUpperCase()}`;
  return supabase
    .from('maintenance_requests')
    .insert({ ...data, request_number: requestNumber })
    .select(REQUEST_SELECT)
    .single();
}

export async function updateRequestStatus(id: string, status: MaintenanceRequestStatus) {
  const supabase = createClient();
  const updateData: Record<string, unknown> = { status };
  if (status === 'completed') updateData.resolved_at = new Date().toISOString();
  return supabase
    .from('maintenance_requests')
    .update(updateData)
    .eq('id', id)
    .select(REQUEST_SELECT)
    .single();
}

export async function getWorkOrders(filters: WorkOrderFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('work_orders')
    .select(WORK_ORDER_SELECT);

  if (filters.status) query = query.eq('status', filters.status);

  return query.order('created_at', { ascending: false });
}

export async function getWorkOrderById(id: string) {
  const supabase = createClient();
  return supabase
    .from('work_orders')
    .select(WORK_ORDER_SELECT)
    .eq('id', id)
    .single();
}

export async function createWorkOrder(data: Omit<WorkOrder, 'id' | 'work_order_number' | 'created_at' | 'updated_at' | 'asset' | 'assignee' | 'request'>) {
  const supabase = createClient();
  const workOrderNumber = `WO-${Date.now().toString(36).toUpperCase()}`;
  return supabase
    .from('work_orders')
    .insert({ ...data, work_order_number: workOrderNumber })
    .select(WORK_ORDER_SELECT)
    .single();
}

export async function updateWorkOrder(id: string, data: Partial<Omit<WorkOrder, 'id' | 'work_order_number' | 'created_at' | 'updated_at' | 'asset' | 'assignee' | 'request'>>) {
  const supabase = createClient();
  const oldRow = await supabase.from('work_orders').select(WORK_ORDER_SELECT).eq('id', id).single();
  const result = await supabase
    .from('work_orders')
    .update(data)
    .eq('id', id)
    .select(WORK_ORDER_SELECT)
    .single();

  if (!result.error) {
    await logAuditEvent({
      action: data.status ? 'work_order.status_update' : 'work_order.update',
      entityType: 'work_orders',
      entityId: id,
      oldValues: (oldRow.data as Record<string, unknown> | null) ?? null,
      newValues: (result.data as Record<string, unknown> | null) ?? null,
    });
  }

  if (!result.error && data.status === 'completed') {
    const assetId = (result.data as Record<string, unknown> | null)?.asset_id as string | undefined;
    if (assetId) {
      await recomputeAssetAnalytics(assetId).catch(() => {});
    }
  }

  return result;
}

export interface OpenRequestRow {
  id: string;
  asset_id: string;
  status: string;
  urgency: string;
  created_at: string;
}

export interface OpenWorkOrderRow {
  id: string;
  asset_id: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  created_at: string;
}

export async function getOpenMaintenanceRequests() {
  const supabase = createClient();
  return supabase
    .from('maintenance_requests')
    .select('id, asset_id, status, urgency, created_at')
    .in('status', [...OPEN_MAINTENANCE_REQUEST_STATUSES])
    .order('created_at', { ascending: false });
}

export async function getOpenWorkOrders() {
  const supabase = createClient();
  return supabase
    .from('work_orders')
    .select('id, asset_id, status, priority, assigned_to, created_at')
    .in('status', [...OPEN_WORK_ORDER_STATUSES])
    .order('created_at', { ascending: false });
}

export async function getOpenRequestsForAsset(assetId: string) {
  const supabase = createClient();
  return supabase
    .from('maintenance_requests')
    .select('id, request_number, asset_id, status, urgency, reported_condition, reported_condition_source, created_at')
    .eq('asset_id', assetId)
    .in('status', [...OPEN_MAINTENANCE_REQUEST_STATUSES])
    .order('created_at', { ascending: false });
}

export interface OpenCorrectiveRequestDetail {
  id: string;
  request_number: string;
  asset_id: string;
  status: string;
  urgency: string;
  reported_condition: string | null;
  fault_description: string;
  created_at: string;
}

// Returns the first open maintenance request for an asset, or null if none exists.
// Used to enforce the duplicate prevention rule: one active corrective request per asset.
export async function getOpenCorrectiveRequestForAsset(assetId: string): Promise<OpenCorrectiveRequestDetail | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('maintenance_requests')
    .select('id, request_number, asset_id, status, urgency, reported_condition, fault_description, created_at')
    .eq('asset_id', assetId)
    .in('status', [...OPEN_MAINTENANCE_REQUEST_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as OpenCorrectiveRequestDetail | null) ?? null;
}

export async function getOpenWorkOrdersForAsset(assetId: string) {
  const supabase = createClient();
  return supabase
    .from('work_orders')
    .select('id, work_order_number, asset_id, status, priority, assigned_to, created_at')
    .eq('asset_id', assetId)
    .in('status', [...OPEN_WORK_ORDER_STATUSES])
    .order('created_at', { ascending: false });
}

export type ActiveCorrectiveBlocker =
  | (OpenCorrectiveRequestDetail & { blocker_type: 'maintenance_request' })
  | {
      blocker_type: 'work_order';
      id: string;
      work_order_number: string;
      asset_id: string;
      status: string;
      priority: string;
      assigned_to: string | null;
      created_at: string;
    };

export async function getActiveCorrectiveBlockerForAsset(assetId: string): Promise<ActiveCorrectiveBlocker | null> {
  const [request, workOrders] = await Promise.all([
    getOpenCorrectiveRequestForAsset(assetId),
    getOpenWorkOrdersForAsset(assetId),
  ]);

  if (request) return { ...request, blocker_type: 'maintenance_request' };
  const workOrder = (workOrders.data?.[0] ?? null) as {
    id: string;
    work_order_number: string;
    asset_id: string;
    status: string;
    priority: string;
    assigned_to: string | null;
    created_at: string;
  } | null;
  return workOrder ? { ...workOrder, blocker_type: 'work_order' } : null;
}

export async function getWorkOrdersByRequestId(requestId: string) {
  const supabase = createClient();
  return supabase
    .from('work_orders')
    .select(WORK_ORDER_SELECT)
    .eq('request_id', requestId)
    .order('created_at', { ascending: false });
}

export async function getLastCompletedWorkOrderForAsset(assetId: string) {
  const supabase = createClient();
  return supabase
    .from('work_orders')
    .select('id, work_order_number, asset_id, status, completion_outcome, final_equipment_condition, completed_at')
    .eq('asset_id', assetId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

// R19: parts declared as needed for a specific work order. Used by the WO
// detail Parts Needed panel and indirectly by Command Center stock blockers
// (fetchStockBlockers in command-center-data.ts pulls all open needs).
export async function getWorkOrderPartsNeeded(workOrderId: string) {
  const supabase = createClient();
  return supabase
    .from('work_order_parts_needed')
    .select(`
      id, work_order_id, spare_part_id, quantity_needed, notes, status,
      declared_by, created_at, fulfilled_at, canceled_at,
      spare_parts(id, part_code, name, current_stock, reorder_level),
      profiles!work_order_parts_needed_declared_by_fkey(id, full_name)
    `)
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: false });
}

export async function getMaintenanceEvents(assetId: string) {
  const supabase = createClient();
  return supabase
    .from('maintenance_events')
    .select(EVENT_SELECT)
    .eq('asset_id', assetId)
    .order('created_at', { ascending: false });
}

// Fetch maintenance events directly linked to a single work order. Used by
// the Work Order Detail page so the evidence shown next to "Completion
// Outcome" matches the WO the user is looking at — not the asset's full
// history. Asset-wide history is still available via getMaintenanceEvents
// where it's needed (e.g. equipment detail).
export async function getMaintenanceEventsByWorkOrderId(workOrderId: string) {
  const supabase = createClient();
  return supabase
    .from('maintenance_events')
    .select(EVENT_SELECT)
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: false });
}

export async function createMaintenanceEvent(data: Omit<MaintenanceEvent, 'id' | 'created_at' | 'updated_at' | 'failure_code' | 'action_code'>) {
  const supabase = createClient();
  return supabase
    .from('maintenance_events')
    .insert(data)
    .select(EVENT_SELECT)
    .single();
}
