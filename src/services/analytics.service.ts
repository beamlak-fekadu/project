import { createClient } from '@/lib/supabase/client';

export interface AnalyticsFilters {
  asset_id?: string;
  department_id?: string;
  period_start?: string;
  period_end?: string;
}

const RELIABILITY_SELECT = `
  id, asset_id, period_start, period_end, mttr_hours, mtbf_hours,
  availability_ratio, total_downtime_hours, total_operational_hours,
  failure_count, repair_count, computed_at,
  equipment_assets(id, asset_code, name, department_id)
`;

const RISK_SELECT = `
  id, asset_id, severity, occurrence, detectability, rpn, risk_level,
  assessed_by, assessed_at, notes,
  equipment_assets(id, asset_code, name, department_id)
`;

const PMC_SELECT = `
  id, department_id, category_id, asset_id, period_start, period_end,
  scheduled_count, completed_count, pmc_percentage, computed_at,
  departments(name, code)
`;

const PERFORMANCE_SELECT = `
  id, asset_id, period_start, period_end, normalized_availability,
  normalized_mttr, normalized_downtime, normalized_pmc,
  normalized_failure_rate, composite_score, weights_profile_id, computed_at,
  equipment_assets(id, asset_code, name)
`;

const REPLACEMENT_SELECT = `
  id, asset_id, period_start, period_end, age_score, failure_score,
  availability_score, maintenance_burden_score, spare_part_score,
  risk_score, cost_score, replacement_priority_index, rank,
  justification, weights_profile_id, computed_at,
  equipment_assets(id, asset_code, name, department_id)
`;

const FLAG_SELECT = `
  id, asset_id, flag_type, severity, message, details,
  is_acknowledged, acknowledged_by, acknowledged_at, generated_at, expires_at,
  equipment_assets(id, asset_code, name)
`;

function applyPeriodFilters<T extends { gte: (col: string, val: string) => T; lte: (col: string, val: string) => T }>(query: T, filters: AnalyticsFilters): T {
  if (filters.period_start) query = query.gte('period_start', filters.period_start);
  if (filters.period_end) query = query.lte('period_end', filters.period_end);
  return query;
}

export async function getReliabilityMetrics(filters: AnalyticsFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('equipment_reliability_metrics')
    .select(RELIABILITY_SELECT);

  if (filters.asset_id) query = query.eq('asset_id', filters.asset_id);
  query = applyPeriodFilters(query, filters);
  return query.order('computed_at', { ascending: false });
}

export async function getRiskScores(filters: AnalyticsFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('equipment_risk_scores')
    .select(RISK_SELECT);

  if (filters.asset_id) query = query.eq('asset_id', filters.asset_id);

  return query.order('assessed_at', { ascending: false });
}

export async function getPMComplianceMetrics(filters: AnalyticsFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('pm_compliance_metrics')
    .select(PMC_SELECT);

  if (filters.department_id) query = query.eq('department_id', filters.department_id);
  if (filters.asset_id) query = query.eq('asset_id', filters.asset_id);
  query = applyPeriodFilters(query, filters);

  return query.order('computed_at', { ascending: false });
}

export async function getPerformanceScores(filters: AnalyticsFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('equipment_performance_scores')
    .select(PERFORMANCE_SELECT);

  if (filters.asset_id) query = query.eq('asset_id', filters.asset_id);
  query = applyPeriodFilters(query, filters);

  return query.order('composite_score', { ascending: false });
}

export async function getReplacementPriorities(filters: AnalyticsFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('replacement_priority_scores')
    .select(REPLACEMENT_SELECT);

  if (filters.asset_id) query = query.eq('asset_id', filters.asset_id);
  query = applyPeriodFilters(query, filters);
  const result = await query.order('computed_at', { ascending: false });
  if (result.error || !result.data) return result;

  const latestByAsset = new Map<string, (typeof result.data)[number]>();
  for (const row of result.data) {
    if (!latestByAsset.has(row.asset_id)) {
      latestByAsset.set(row.asset_id, row);
    }
  }

  const normalized = Array.from(latestByAsset.values()).sort((a, b) => {
    const rankA = a.rank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.rank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    const timeA = new Date(a.computed_at ?? 0).getTime();
    const timeB = new Date(b.computed_at ?? 0).getTime();
    return timeB - timeA;
  });

  return { ...result, data: normalized };
}

export async function getRecommendationFlags(filters: AnalyticsFilters = {}) {
  const supabase = createClient();
  let query = supabase
    .from('recommendation_flags')
    .select(FLAG_SELECT);

  if (filters.asset_id) query = query.eq('asset_id', filters.asset_id);

  return query.order('generated_at', { ascending: false });
}

export async function acknowledgeFlag(id: string, userId: string) {
  const supabase = createClient();
  return supabase
    .from('recommendation_flags')
    .update({
      is_acknowledged: true,
      acknowledged_by: userId,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(FLAG_SELECT)
    .single();
}
