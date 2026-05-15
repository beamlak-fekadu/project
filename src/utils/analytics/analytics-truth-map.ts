// Analytics Truth Map — BMERMS decision-support metrics
//
// This file documents each metric's formula, source, refresh mechanism,
// live/snapshot/sandbox status, pages where it appears, and known limitations.
// It is a developer reference used by Developer Lab health checks and thesis
// defense presentations. No executable scoring logic lives here.
//
// Status legend:
//   live      — computed from current DB rows on each page load (no cache)
//   snapshot  — computed from a pre-aggregated DB table refreshed via RPC
//   sandbox   — computed only inside Developer Lab; never shown on operational pages

export type MetricStatus = 'live' | 'snapshot' | 'sandbox';

export interface MetricTruth {
  name: string;
  formula: string;
  sourceTables: string[];
  sourceViews?: string[];
  refreshMechanism: string;
  status: MetricStatus;
  pages: string[];
  missingDataBehavior: string;
  staleBehavior: string;
  knownLimitations?: string;
}

export const ANALYTICS_TRUTH_MAP: MetricTruth[] = [
  {
    name: 'RPN (Risk Priority Number)',
    formula: 'RPN = Severity × Occurrence × Detectability  (each 1–10)',
    sourceTables: ['equipment_risk_scores'],
    refreshMechanism:
      'recompute_equipment_analytics() RPC; triggered on work-order completion and PM completion. Seed baseline via migration 00019.',
    status: 'snapshot',
    pages: ['/equipment/[id]', '/command', '/reports/risk-fmea', '/developer-lab'],
    missingDataBehavior: 'Shows "N/A" or empty if equipment_risk_scores row absent.',
    staleBehavior:
      'Last computed_at timestamp shown in Equipment detail. Developer Lab refresh button triggers recompute.',
  },
  {
    name: 'RPI (Replacement Priority Index)',
    formula:
      'RPI = Σ(weight_j × normalized_score_ij) for j ∈ {age, failure, availability, maintenance_burden, spare_part, risk, cost}. Min-max normalized. Weights sum to 1.',
    sourceTables: ['replacement_priority_scores'],
    sourceViews: ['v_replacement_decision'],
    refreshMechanism:
      'compute_replacement_priority_scores_all() RPC; triggered manually or on risk recompute. rows with weights_profile_id IS NULL are system-computed (80 assets).',
    status: 'snapshot',
    pages: ['/replacement', '/command', '/reports/replacement-planning', '/developer-lab'],
    missingDataBehavior:
      'Assets missing a replacement_priority_scores row are excluded from ranked list. Shown in Developer Lab data health.',
    staleBehavior:
      'computed_at shown in Replacement page header. Sandbox sliders in Developer Lab do not modify live RPI.',
    knownLimitations:
      'Thresholds (STRONG ≥ 0.70, REVIEW 0.55–0.69) are prototype decisions. Import REPLACEMENT_STRONG_THRESHOLD and REPLACEMENT_REVIEW_THRESHOLD from replacement-thresholds.ts; never hardcode.',
  },
  {
    name: 'Equipment Health Score',
    formula:
      'Composite of RPN, availability, PM compliance, calibration status, open corrective work. Exact weights in DeveloperLabClient methodology tab.',
    sourceTables: ['equipment_risk_scores', 'equipment_reliability_metrics', 'pm_compliance_metrics'],
    sourceViews: ['v_asset_health_summary'],
    refreshMechanism: 'Refreshed by refresh_decision_support_snapshots() RPC.',
    status: 'snapshot',
    pages: ['/command', '/command/health (→ /developer-lab)', '/developer-lab'],
    missingDataBehavior:
      'Assets with missing reliability or risk scores get null health score, shown as "No data" in health table.',
    staleBehavior: 'Last refresh timestamp in decision_support_refresh_log.',
  },
  {
    name: 'Department Readiness',
    formula:
      'readinessPercent = functional_essential / total_essential × 100. Essential = criticality_level IN (high, critical). classifyDeptRisk() in src/utils/viewer/readiness.ts applies rule-based bands.',
    sourceTables: ['equipment_assets', 'equipment_categories'],
    refreshMechanism: 'Live — computed on each page load from equipment_assets rows.',
    status: 'live',
    pages: ['/command (Viewer)', '/command (Dept Dashboard)', '/reports/department-readiness'],
    missingDataBehavior:
      'If essentialTotal = 0, readinessPercent = null, classifyDeptRisk returns "unknown".',
    staleBehavior: 'Always current (live query).',
  },
  {
    name: 'Clinical Readiness',
    formula:
      'Snapshot of essential_functional / essential_total per department, stored in clinical_readiness_snapshots.',
    sourceTables: ['clinical_readiness_snapshots'],
    refreshMechanism: 'refresh_decision_support_snapshots() RPC.',
    status: 'snapshot',
    pages: ['/command (Viewer executive metrics)'],
    missingDataBehavior: 'Null row → shown as "Not available" in Viewer command center.',
    staleBehavior: 'snapshot_date shown in Viewer header.',
  },
  {
    name: 'PM Compliance (PMC)',
    formula: 'PMC = (completed scheduled PM tasks / total scheduled PM tasks) × 100. Skipped/deferred are NOT counted as completed.',
    sourceTables: ['pm_compliance_metrics', 'pm_schedules'],
    refreshMechanism:
      'pm_compliance_metrics rows computed by recompute_equipment_analytics(); also live via pm_schedules.status counts for recent windows.',
    status: 'snapshot',
    pages: ['/pm', '/compliance', '/reports/pm-compliance', '/command'],
    missingDataBehavior: 'No compliance rows → "N/A" shown.',
    staleBehavior:
      'pm_compliance_metrics.computed_at shown in Developer Lab. Compliance page also queries pm_schedules directly for rolling 90d window (live).',
  },
  {
    name: 'Calibration Compliance / Calibration Risk',
    formula:
      'Overdue = v_calibration_due rows where next_due_date < today. result IN (failed, adjusted) = at-risk. No single compliance % — shown as overdue count and result distribution.',
    sourceTables: ['calibration_records'],
    sourceViews: ['v_calibration_due'],
    refreshMechanism: 'Live — v_calibration_due is a live view (no caching).',
    status: 'live',
    pages: ['/calibration', '/compliance', '/reports/calibration-compliance', '/command'],
    missingDataBehavior: '0 overdue shown if calibration_records has no upcoming/past-due rows.',
    staleBehavior: 'Always current (live view).',
    knownLimitations:
      'v_calibration_due window is next_due_date ≤ today + 90 days. Assets with calibration due > 90 days away are not shown.',
  },
  {
    name: 'MTTR (Mean Time To Repair)',
    formula: 'MTTR = total_maintenance_hours / number_of_repairs',
    sourceTables: ['equipment_reliability_metrics'],
    refreshMechanism: '_recompute_asset_metrics() called by recompute_all_equipment_analytics().',
    status: 'snapshot',
    pages: ['/equipment/[id]', '/reports/biomedical-operations', '/developer-lab'],
    missingDataBehavior: 'null MTTR shown as "Insufficient data" in Equipment detail.',
    staleBehavior: 'computed_at in equipment_reliability_metrics.',
  },
  {
    name: 'MTBF (Mean Time Between Failures)',
    formula: 'MTBF = operational_hours / failure_count',
    sourceTables: ['equipment_reliability_metrics'],
    refreshMechanism: 'Same as MTTR.',
    status: 'snapshot',
    pages: ['/equipment/[id]', '/reports/biomedical-operations', '/developer-lab'],
    missingDataBehavior: 'null shown as "No recorded failures" if failure_count = 0.',
    staleBehavior: 'Same as MTTR.',
  },
  {
    name: 'Availability',
    formula: 'A = MTBF / (MTBF + MTTR)',
    sourceTables: ['equipment_reliability_metrics'],
    refreshMechanism: 'Same as MTTR.',
    status: 'snapshot',
    pages: ['/equipment/[id]', '/replacement', '/command', '/reports/biomedical-operations'],
    missingDataBehavior: 'If MTTR = 0 or MTBF = 0, shown as "Insufficient downtime data" or "100% (no failures)".',
    staleBehavior: 'Same as MTTR.',
  },
  {
    name: 'Critical Action Score',
    formula:
      'Composite cross-category score used to rank triage items in Command Center. Formula and weights in src/app/(dashboard)/command/_lib/command-center-data.ts buildCriticalActionStrip().',
    sourceTables: ['triage_action_queue', 'equipment_risk_scores', 'replacement_priority_scores'],
    sourceViews: ['v_command_center_triage'],
    refreshMechanism:
      'Triage queue refreshed by recompute_all_equipment_analytics() or Command Center manual refresh. Auto-refreshes every 10s in the header.',
    status: 'snapshot',
    pages: ['/command (BME Head / Developer)'],
    missingDataBehavior: 'Empty triage queue → no critical actions shown.',
    staleBehavior: 'Stale triage shown with "last refreshed" notice. Manual refresh via RefreshButton.',
    knownLimitations: 'Sandbox-only sensitivity tabs in Developer Lab do not modify live action scores.',
  },
  {
    name: 'Stock Blocker Priority',
    formula:
      'on_hold work orders with parts_needed signal from low_stock/part_shortage recommendation_flags. No composite score — shown as count and criticality of affected equipment.',
    sourceTables: ['work_orders', 'recommendation_flags', 'spare_parts'],
    sourceViews: ['v_open_work_orders'],
    refreshMechanism: 'Live — queried on page load.',
    status: 'live',
    pages: ['/spare-parts', '/maintenance (Store view)', '/command (Store)'],
    missingDataBehavior: '0 blockers shown if no on_hold work orders.',
    staleBehavior: 'Always current.',
  },
  {
    name: 'Procurement Delay / Pipeline Pressure',
    formula:
      'Delayed = procurement_requests with status = in_transit or ordered for > threshold days. Pipeline = sum of open procurement rows by status band.',
    sourceTables: ['procurement_requests'],
    refreshMechanism: 'Live — queried on page load.',
    status: 'live',
    pages: ['/procurement', '/command (Store)', '/logistics', '/reports/procurement-pipeline'],
    missingDataBehavior: '0 delayed shown if no matching rows.',
    staleBehavior: 'Always current.',
  },
  {
    name: 'Technician Workload',
    formula:
      'Count of open work orders assigned to each technician, grouped by priority band. Source: v_open_work_orders.assigned_to_name.',
    sourceTables: ['work_orders'],
    sourceViews: ['v_open_work_orders'],
    refreshMechanism: 'Live — queried on Command Center load.',
    status: 'live',
    pages: ['/command (BME Head / Developer)', '/work-orders'],
    missingDataBehavior:
      'Unassigned WOs shown in "Unassigned" band. Technician with 0 open WOs not shown.',
    staleBehavior: 'Live query — always current at load time.',
  },
  {
    name: 'Department Backlog',
    formula:
      'Count of open work orders per department (from v_open_work_orders.department_name). Includes on_hold, in_progress, assigned, pending-start.',
    sourceTables: ['work_orders'],
    sourceViews: ['v_open_work_orders'],
    refreshMechanism: 'Live — computed on Viewer/Department page load.',
    status: 'live',
    pages: ['/maintenance (Viewer)', '/command (Dept Dashboard)', '/reports/maintenance-performance'],
    missingDataBehavior:
      'Departments with 0 open WOs not shown in backlog table. v_open_work_orders filter requires migration 00044 (department_id column).',
    staleBehavior: 'Always current.',
    knownLimitations:
      'work_orders has no scheduled_date column. "Overdue" is defined as open > 14 days from created_at (proxy). This is documented in all UI sub-labels.',
  },
];

// Quick lookup by metric name for Developer Lab health panel.
export function getMetricTruth(name: string): MetricTruth | undefined {
  return ANALYTICS_TRUTH_MAP.find((m) => m.name === name);
}

// Metrics that are safe to show on operational (non-developer) pages.
export const OPERATIONAL_METRICS = ANALYTICS_TRUTH_MAP.filter((m) => m.status !== 'sandbox');

// Sandbox-only metrics must stay in Developer Lab.
export const SANDBOX_METRICS = ANALYTICS_TRUTH_MAP.filter((m) => m.status === 'sandbox');
