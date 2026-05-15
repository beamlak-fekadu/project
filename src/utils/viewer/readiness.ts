// Viewer-only readiness/risk classification helpers.
//
// These rules are documented thresholds, not generated interpretations.
// Used by the Viewer Command Center "Service Readiness" panel and Department
// breakdown views. Each function takes pre-computed counts from existing
// canonical fetchers and returns a transparent classification.

export type DeptRiskLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface DeptReadinessSignals {
  // readiness_score in 0–100 (computed by v_department_readiness as
  // functional essential / total essential * 100)
  readinessScore: number | null;
  // essential equipment that is not currently functional/available
  essentialUnavailable: number;
  // open work orders with critical/high priority for this department
  criticalOpenWork: number;
  // overdue PM count for this department
  overduePm: number;
  // overdue calibration count for this department
  overdueCalibration: number;
}

// Rule (documented, no generated narrative):
//   high   -> essentialUnavailable > 0 OR criticalOpenWork > 0
//   medium -> readinessScore < 80 OR overduePm + overdueCalibration >= 3
//   low    -> readinessScore >= 80 AND no critical signals
//   unknown -> readinessScore is null AND no other signals available
export function classifyDeptRisk(signals: DeptReadinessSignals): DeptRiskLevel {
  const { readinessScore, essentialUnavailable, criticalOpenWork, overduePm, overdueCalibration } = signals;

  if (essentialUnavailable > 0 || criticalOpenWork > 0) return 'high';

  const overdueCompliance = overduePm + overdueCalibration;
  const lowReadiness = typeof readinessScore === 'number' && readinessScore < 80;

  if (lowReadiness || overdueCompliance >= 3) return 'medium';

  if (readinessScore === null && overdueCompliance === 0) return 'unknown';

  return 'low';
}

export function deptRiskBadgeClass(level: DeptRiskLevel): string {
  switch (level) {
    case 'high':
      return 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
    case 'medium':
      return 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
    case 'low':
      return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
    default:
      return 'bg-zinc-500/20 text-zinc-300 border border-zinc-500/40';
  }
}

export function deptRiskLabel(level: DeptRiskLevel): string {
  switch (level) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    default:
      return 'Unknown';
  }
}
