import { createClient } from '@/lib/supabase/client';
import type { DashboardStats, RecommendationFlag } from '@/types/database';

export async function getDashboardStats() {
  const supabase = createClient();
  return supabase
    .from('v_dashboard_stats')
    .select('total_equipment, functional_count, non_functional_count, open_work_orders, overdue_pm, calibration_due_soon, low_stock_parts, pending_disposals, active_critical_alerts')
    .single<DashboardStats>();
}

export async function getEquipmentByDepartment() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('equipment_assets')
    .select('department_id, departments(name)')
    .is('deleted_at', null);

  if (error) return { data: null, error };

  const grouped = (data ?? []).reduce<Record<string, { department_name: string; count: number }>>((acc, row) => {
    const deptId = row.department_id;
    const deptName = (row.departments as unknown as { name: string })?.name ?? 'Unknown';
    if (!acc[deptId]) acc[deptId] = { department_name: deptName, count: 0 };
    acc[deptId].count++;
    return acc;
  }, {});

  return { data: Object.values(grouped), error: null };
}

export async function getEquipmentByCondition() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('equipment_assets')
    .select('condition')
    .is('deleted_at', null);

  if (error) return { data: null, error };

  const grouped = (data ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.condition] = (acc[row.condition] ?? 0) + 1;
    return acc;
  }, {});

  return {
    data: Object.entries(grouped).map(([condition, count]) => ({ condition, count })),
    error: null,
  };
}

export async function getRecentAlerts() {
  const supabase = createClient();
  return supabase
    .from('recommendation_flags')
    .select('id, asset_id, flag_type, severity, message, details, is_acknowledged, generated_at, equipment_assets(asset_code, name)')
    .eq('is_acknowledged', false)
    .order('generated_at', { ascending: false })
    .limit(10) as unknown as { data: (RecommendationFlag & { equipment_assets: { asset_code: string; name: string } })[] | null; error: unknown };
}

export async function getOpenWorkOrders() {
  const supabase = createClient();
  return supabase
    .from('v_open_work_orders')
    .select('id, work_order_number, status, priority, work_type, created_at, started_at, asset_code, asset_name, department_name, assigned_to_name')
    .order('created_at', { ascending: false })
    .limit(10);
}

export async function getOverduePM() {
  const supabase = createClient();
  return supabase
    .from('v_overdue_pm')
    .select('id, scheduled_date, status, plan_name, asset_code, asset_name, department_name, category_name, assigned_to_name, days_overdue')
    .order('scheduled_date', { ascending: true })
    .limit(10);
}
