import { createClient } from '@/lib/supabase/client';
import type { DisposalRequest, DisposalRequestStatus, DisposedAsset } from '@/types/domain';

export interface DisposalFilters {
  status?: DisposalRequestStatus;
  asset_id?: string;
}

// FK hint: disposal_requests has two FKs to profiles (requested_by,
// approved_by). Without it PGRST201 silently zeros the requester column.
const REQUEST_SELECT = `
  id, request_number, asset_id, requested_by, reason,
  disposal_method_proposed, status, approved_by, approved_at, notes,
  created_at, updated_at,
  equipment_assets(id, asset_code, name, department_id),
  profiles!disposal_requests_requested_by_fkey(id, full_name)
`;

export async function getDisposalRequests(filters: DisposalFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('disposal_requests')
    .select(REQUEST_SELECT);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.asset_id) query = query.eq('asset_id', filters.asset_id);

  return query.order('created_at', { ascending: false });
}

export async function createDisposalRequest(data: Omit<DisposalRequest, 'id' | 'request_number' | 'created_at' | 'updated_at' | 'approved_by' | 'approved_at'>) {
  const supabase = createClient();
  const requestNumber = `DSP-${Date.now().toString(36).toUpperCase()}`;
  return supabase
    .from('disposal_requests')
    .insert({ ...data, request_number: requestNumber })
    .select(REQUEST_SELECT)
    .single();
}

export async function updateDisposalRequestStatus(id: string, status: DisposalRequestStatus, approvedBy?: string) {
  const supabase = createClient();
  const updateData: Record<string, unknown> = { status };
  if (status === 'approved' && approvedBy) {
    updateData.approved_by = approvedBy;
    updateData.approved_at = new Date().toISOString();
  }
  return supabase
    .from('disposal_requests')
    .update(updateData)
    .eq('id', id)
    .select(REQUEST_SELECT)
    .single();
}

export async function createDisposedAsset(data: Omit<DisposedAsset, 'id' | 'created_at'>) {
  const supabase = createClient();
  return supabase
    .from('disposed_assets')
    .insert(data)
    .select('id, asset_id, disposal_request_id, disposal_date, disposal_method, disposal_value, disposed_by, notes, created_at')
    .single();
}
