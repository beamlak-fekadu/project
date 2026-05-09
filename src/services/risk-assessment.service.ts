import { createClient } from '@/lib/supabase/client';
import type { RiskLevel } from '@/types/database';

export interface RiskDimensionExplanation {
  score: number;
  drivers?: string[];
  [key: string]: unknown;
}

export type SeverityExplanation = RiskDimensionExplanation;
export type OccurrenceExplanation = RiskDimensionExplanation & {
  failure_count_365d?: number;
  age_years?: number;
};
export type DetectabilityExplanation = RiskDimensionExplanation & {
  pm_overdue_days?: number | null;
  calibration_overdue_days?: number | null;
  pm_compliance?: number | null;
};

export interface RiskExplanation {
  severity?: SeverityExplanation;
  occurrence?: OccurrenceExplanation;
  detectability?: DetectabilityExplanation;
  rpn?: number;
  risk_level?: RiskLevel | string;
  computed_at?: string;
  source_version?: string;
  [key: string]: unknown;
}

export interface RiskAssessmentScore {
  id: string;
  asset_id: string;
  severity: number;
  occurrence: number;
  detectability: number;
  rpn: number;
  risk_level: RiskLevel;
  assessed_at: string;
  computed_at?: string | null;
  assignment_method?: 'computed' | 'manual_override' | 'seeded_demo';
  override_reason?: string | null;
  override_at?: string | null;
  explanation?: RiskExplanation | null;
  notes?: string | null;
}

const RISK_SCORE_SELECT = `
  id, asset_id, severity, occurrence, detectability, rpn, risk_level,
  assessed_by, assessed_at, notes, explanation, assignment_method,
  override_reason, override_by, override_at, computed_at, source_version
`;

function firstDriver(dimension?: RiskDimensionExplanation): string | null {
  return dimension?.drivers?.find(Boolean) ?? null;
}

export function explainRiskScore(score: Partial<RiskAssessmentScore> | null): {
  severity: string;
  occurrence: string;
  detectability: string;
  summary: string;
} {
  const explanation = score?.explanation;
  const severity = firstDriver(explanation?.severity) ?? `Severity score ${score?.severity ?? 'not set'}`;
  const occurrence = firstDriver(explanation?.occurrence) ?? `Occurrence score ${score?.occurrence ?? 'not set'}`;
  const detectability = firstDriver(explanation?.detectability) ?? `Detectability score ${score?.detectability ?? 'not set'}`;

  return {
    severity,
    occurrence,
    detectability,
    summary: [severity, occurrence, detectability].filter(Boolean).join(' · '),
  };
}

export async function getRiskScore(assetId: string) {
  const supabase = createClient();
  return supabase
    .from('equipment_risk_scores')
    .select(RISK_SCORE_SELECT)
    .eq('asset_id', assetId)
    .order('assessed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function refreshRiskScore(assetId: string) {
  const supabase = createClient();
  return (supabase.rpc as never as (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'fn_refresh_fmea_risk_score_for_asset',
    { asset_uuid: assetId }
  );
}

export async function refreshAllRiskScores() {
  const supabase = createClient();
  return (supabase.rpc as never as (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'fn_refresh_fmea_risk_scores'
  );
}
