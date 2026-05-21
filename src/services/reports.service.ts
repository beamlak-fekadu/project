// R28 (Phase 6): reports.service.ts uses the BROWSER Supabase client. RLS
// is the enforcement layer for who can read what. Two privileged reports
// — `/reports/offline-sync-evidence` and the `/audit` page — already have
// dedicated server-rendered routes using `@/lib/supabase/server` +
// `requireRole`; do NOT route those through this file. Other admin-only
// reports (QR scan evidence, QR coverage, audit-style data inside
// `/reports/[type]`) are gated at the UI layer via reportConfigs.adminOnly
// in `src/app/(dashboard)/reports/page.tsx` and at the DB layer via RLS.
// A future pass MAY centralize all admin reports under server actions,
// but doing so piecemeal would create a confusing two-pattern reports
// service. Keep the entire file on the browser client OR migrate it all.

import { createClient } from '@/lib/supabase/client';

export interface ReportFilters {
  department_id?: string;
  category_id?: string;
  date_from?: string;
  date_to?: string;
  status?: string;
}

export async function getEquipmentReport(filters: ReportFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('equipment_assets')
    .select(`
      id, asset_code, serial_number, name, condition, status,
      installation_date, warranty_expiry, purchase_date, purchase_cost, source,
      departments(id, name, code),
      equipment_categories(id, name, code, criticality_level),
      manufacturers(id, name),
      equipment_models(id, name)
    `)
    .is('deleted_at', null);

  if (filters.department_id) query = query.eq('department_id', filters.department_id);
  if (filters.category_id) query = query.eq('category_id', filters.category_id);
  if (filters.status) query = query.eq('status', filters.status);

  return query.order('asset_code', { ascending: true });
}

export async function getQrCoverageReport(filters: ReportFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('equipment_assets')
    .select(`
      id, asset_code, name, condition, status,
      qr_token, qr_generated_at, qr_label_status, qr_label_printed_at,
      qr_label_attached_at, qr_label_replaced_at, qr_token_regenerated_at,
      departments(id, name, code),
      equipment_categories(id, name, code, criticality_level)
    `)
    .is('deleted_at', null);

  if (filters.department_id) query = query.eq('department_id', filters.department_id);
  if (filters.category_id) query = query.eq('category_id', filters.category_id);
  if (filters.status) {
    if (filters.status === 'missing_token') query = query.or('qr_token.is.null,qr_label_status.eq.not_generated');
    else query = query.eq('qr_label_status', filters.status);
  }

  return query.order('asset_code', { ascending: true });
}

export async function getQrScanEvidenceReport(filters: ReportFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('equipment_qr_scans')
    .select(`
      id, asset_id, scanned_by, role_name, scanned_at, scan_source,
      online_status, action_taken, metadata, created_at,
      equipment_assets(id, asset_code, name, department_id, departments(id, name)),
      profiles(id, full_name, email)
    `)
    .order('scanned_at', { ascending: false })
    .limit(2000);

  if (filters.date_from) query = query.gte('scanned_at', filters.date_from);
  if (filters.date_to) query = query.lte('scanned_at', filters.date_to);
  if (filters.status) query = query.eq('online_status', filters.status);

  const result = await query;
  if (filters.department_id && result.data) {
    return {
      ...result,
      data: (result.data as Array<Record<string, unknown>>).filter((row) => {
        const asset = Array.isArray(row.equipment_assets)
          ? row.equipment_assets[0] as { department_id?: string } | undefined
          : row.equipment_assets as { department_id?: string } | null;
        return asset?.department_id === filters.department_id;
      }),
    };
  }

  return result;
}

export async function getMaintenanceReport(filters: ReportFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('maintenance_events')
    .select(`
      id, event_type, failure_date, downtime_start, downtime_end,
      repair_duration_hours, action_taken, service_cost, completion_date, notes,
      equipment_assets(id, asset_code, name, departments(id, name)),
      failure_codes(id, code, description),
      maintenance_action_codes(id, code, description)
    `);

  if (filters.date_from) query = query.gte('completion_date', filters.date_from);
  if (filters.date_to) query = query.lte('completion_date', filters.date_to);

  return query.order('completion_date', { ascending: false });
}

export async function getPMReport(filters: ReportFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('pm_schedules')
    .select(`
      id, scheduled_date, status, notes,
      pm_plans(id, name, frequency_days),
      equipment_assets(id, asset_code, name, departments(id, name)),
      assigned_to_profile:profiles!pm_schedules_assigned_to_fkey(id, full_name)
    `);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.date_from) query = query.gte('scheduled_date', filters.date_from);
  if (filters.date_to) query = query.lte('scheduled_date', filters.date_to);

  return query.order('scheduled_date', { ascending: false });
}

export async function getCalibrationReport(filters: ReportFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('calibration_records')
    .select(`
      id, calibration_date, next_due_date, result, calibrated_by, notes,
      equipment_assets(id, asset_code, name, departments(id, name)),
      calibration_types(id, name, interval_months)
    `);

  if (filters.date_from) query = query.gte('calibration_date', filters.date_from);
  if (filters.date_to) query = query.lte('calibration_date', filters.date_to);

  return query.order('calibration_date', { ascending: false });
}

export async function getTrainingReport(filters: ReportFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('training_sessions')
    .select(`
      id, title, trainer, training_date, duration_hours, location, description,
      max_participants,
      equipment_assets(id, asset_code, name),
      equipment_categories(id, name),
      staff_training_records(id, staff_name, status, certification_date)
    `);

  if (filters.date_from) query = query.gte('training_date', filters.date_from);
  if (filters.date_to) query = query.lte('training_date', filters.date_to);
  if (filters.category_id) query = query.eq('category_id', filters.category_id);

  return query.order('training_date', { ascending: false });
}

export async function getSparePartsReport(filters: ReportFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('spare_parts')
    .select(`
      id, part_code, name, description, category, unit,
      reorder_level, current_stock, unit_cost, is_active
    `);

  if (filters.category_id) query = query.eq('category', filters.category_id);

  return query.order('name', { ascending: true });
}

export async function getDisposalReport(filters: ReportFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('disposal_requests')
    .select(`
      id, request_number, reason, disposal_method_proposed, status,
      approved_at, notes, created_at,
      equipment_assets(id, asset_code, name, departments(id, name)),
      disposed_assets(id, disposal_date, disposal_method, disposal_value)
    `);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.date_from) query = query.gte('created_at', filters.date_from);
  if (filters.date_to) query = query.lte('created_at', filters.date_to);

  return query.order('created_at', { ascending: false });
}

export async function getWorkOrderReport(filters: ReportFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('work_orders')
    .select(`
      id, work_order_number, request_id, status, priority, work_type,
      external_vendor, external_vendor_name, estimated_hours, actual_hours,
      started_at, completed_at, completion_outcome, final_equipment_condition,
      created_at,
      equipment_assets(id, asset_code, name, departments(id, name)),
      profiles(id, full_name)
    `);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.date_from) query = query.gte('created_at', filters.date_from);
  if (filters.date_to) query = query.lte('created_at', filters.date_to);

  return query.order('created_at', { ascending: false });
}

export async function getProcurementReport(filters: ReportFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('procurement_requests')
    .select('id, request_number, title, justification, status, priority, expected_delivery_date, created_at, updated_at');

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.date_from) query = query.gte('created_at', filters.date_from);
  if (filters.date_to) query = query.lte('created_at', filters.date_to);

  return query.order('created_at', { ascending: false });
}

export async function getReplacementReport() {
  const supabase = createClient();
  return supabase
    .from('replacement_priority_scores')
    .select(`
      id, asset_id, age_score, failure_score, availability_score,
      maintenance_burden_score, spare_part_score, risk_score, cost_score,
      replacement_priority_index, rank, justification, computed_at,
      equipment_assets(id, asset_code, name, departments(id, name))
    `)
    .is('weights_profile_id', null)
    .order('rank', { ascending: true });
}

export async function getRiskFmeaReport() {
  const supabase = createClient();
  return supabase
    .from('equipment_risk_scores')
    .select(`
      id, asset_id, severity, occurrence, detectability, rpn, risk_level,
      explanation, assignment_method, assessed_at, computed_at,
      equipment_assets(id, asset_code, name, departments(id, name))
    `)
    .order('rpn', { ascending: false });
}

export async function getAuditSecurityReport(filters: ReportFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('audit_logs')
    // FK hint required: audit_logs has two FKs to profiles (performed_by, user_id).
    .select('id, action, entity_type, entity_id, old_values, new_values, created_at, profiles!audit_logs_performed_by_fkey(full_name, email)');

  if (filters.date_from) query = query.gte('created_at', filters.date_from);
  if (filters.date_to) query = query.lte('created_at', filters.date_to);

  return query.order('created_at', { ascending: false }).limit(1000);
}
