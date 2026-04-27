import { createClient } from '@/lib/supabase/client';
import type {
  MaintenanceRequest,
  MaintenanceRequestStatus,
  WorkOrder,
  WorkOrderStatus,
  MaintenanceEvent,
} from '@/types/database';

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
  fault_description, urgency, status, resolved_at, notes, created_at, updated_at,
  equipment_assets(id, asset_code, name, serial_number),
  departments(id, name, code)
`;

const WORK_ORDER_SELECT = `
  id, work_order_number, request_id, asset_id, assigned_to, status, priority,
  work_type, root_cause, action_taken, external_vendor, external_vendor_name,
  closure_notes, estimated_hours, actual_hours, started_at, completed_at,
  created_at, updated_at,
  equipment_assets(id, asset_code, name),
  profiles(id, full_name, email)
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
  return supabase
    .from('work_orders')
    .update(data)
    .eq('id', id)
    .select(WORK_ORDER_SELECT)
    .single();
}

export async function getMaintenanceEvents(assetId: string) {
  const supabase = createClient();
  return supabase
    .from('maintenance_events')
    .select(EVENT_SELECT)
    .eq('asset_id', assetId)
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
