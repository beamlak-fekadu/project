import type { RecommendationFlagType } from '@/types/database';

type AlertExplanationInput = {
  assetName?: string | null;
  flagType: RecommendationFlagType | string;
  details?: Record<string, unknown> | null;
};

type TriageExplanationInput = {
  flagType?: string | null;
  rationale?: string[] | null;
  fallbackRecommendation?: string | null;
};

type ReplacementExplanationInput = {
  age_score?: number | null;
  failure_score?: number | null;
  availability_score?: number | null;
  maintenance_burden_score?: number | null;
  spare_part_score?: number | null;
  risk_score?: number | null;
  cost_score?: number | null;
};

function getNumber(details: Record<string, unknown> | null | undefined, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = details?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function getString(details: Record<string, unknown> | null | undefined, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = details?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function getStringArray(details: Record<string, unknown> | null | undefined, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = details?.[key];
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
  }
  return [];
}

function joinNatural(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function labelForFlagType(flagType: string): string {
  switch (flagType) {
    case 'urgent_maintenance':
      return 'extended non-functional time';
    case 'recurring_failure':
      return 'recurring failures';
    case 'replacement_candidate':
      return 'replacement priority';
    case 'part_shortage':
      return 'spare-parts shortage';
    case 'overdue_pm':
      return 'overdue preventive maintenance';
    case 'calibrate_soon':
      return 'overdue calibration';
    case 'prioritize_pm':
      return 'low PM compliance';
    case 'monitor_closely':
      return 'emerging reliability concerns';
    case 'low_availability':
      return 'low availability';
    case 'high_risk':
      return 'elevated risk score';
    case 'warranty_expiring':
      return 'warranty horizon';
    case 'contract_expiring':
      return 'service-contract horizon';
    default:
      return flagType.replace(/_/g, ' ');
  }
}

function parseRationaleEntries(rationale: string[] | null | undefined): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const entry of rationale ?? []) {
    const separator = entry.includes('=') ? '=' : entry.includes(':') ? ':' : null;
    if (!separator) continue;
    const [rawKey, ...rest] = entry.split(separator);
    const key = rawKey.trim();
    const value = rest.join(separator).trim();
    if (key && value) parsed[key] = value;
  }
  return parsed;
}

export function generateAlertSummary({ assetName, flagType, details }: AlertExplanationInput): string {
  const subject = assetName?.trim() || 'Asset';

  switch (flagType) {
    case 'urgent_maintenance': {
      const days = getNumber(details, 'days_non_functional');
      const sparePart = getString(details, 'spare_part');
      const stock = getNumber(details, 'stock', 'current_stock');
      const parts = [
        days != null ? `${days} days non-functional` : null,
        sparePart ? `waiting on ${sparePart}` : null,
        stock != null ? `stock at ${stock}` : null,
      ].filter(Boolean) as string[];
      return `${subject}: ${joinNatural(parts.length > 0 ? parts : ['urgent maintenance conditions detected'])}.`;
    }
    case 'recurring_failure': {
      const failureCount = getNumber(details, 'failure_count');
      const periodMonths = getNumber(details, 'period_months');
      const parts = [
        failureCount != null ? `${failureCount} corrective failures` : null,
        periodMonths != null ? `across ${periodMonths} months` : null,
      ].filter(Boolean) as string[];
      return `${subject}: ${joinNatural(parts.length > 0 ? parts : ['recurring failure pattern detected'])}.`;
    }
    case 'low_availability': {
      const availability = getNumber(details, 'availability');
      const downtime = getNumber(details, 'downtime_hours');
      const parts = [
        availability != null ? `${(availability * 100).toFixed(1)}% availability` : null,
        downtime != null ? `${downtime.toFixed(1)} downtime hours` : null,
      ].filter(Boolean) as string[];
      return `${subject}: ${joinNatural(parts.length > 0 ? parts : ['availability below target'])}.`;
    }
    case 'high_risk': {
      const rpn = getNumber(details, 'rpn');
      return `${subject}: ${rpn != null ? `RPN ${rpn}` : 'high risk score'} requires review.`;
    }
    case 'replacement_candidate': {
      const rank = getNumber(details, 'rpi_rank');
      const score = getNumber(details, 'rpi_score');
      const parts = [
        rank != null ? `replacement rank #${rank}` : null,
        score != null ? `RPI ${score.toFixed(3)}` : null,
      ].filter(Boolean) as string[];
      return `${subject}: ${joinNatural(parts.length > 0 ? parts : ['replacement review threshold reached'])}.`;
    }
    case 'overdue_pm': {
      const days = getNumber(details, 'days_overdue');
      const scheduled = getString(details, 'scheduled_date');
      const parts = [
        days != null ? `${days} days overdue` : null,
        scheduled ? `scheduled for ${scheduled}` : null,
      ].filter(Boolean) as string[];
      return `${subject}: ${joinNatural(parts.length > 0 ? parts : ['preventive maintenance is overdue'])}.`;
    }
    case 'prioritize_pm': {
      const pmc = getNumber(details, 'pmc_percentage');
      const completed = getNumber(details, 'completed');
      const scheduled = getNumber(details, 'scheduled');
      const parts = [
        pmc != null ? `${pmc.toFixed(1)}% PM compliance` : null,
        completed != null && scheduled != null ? `${completed}/${scheduled} completed` : null,
      ].filter(Boolean) as string[];
      return `${subject}: ${joinNatural(parts.length > 0 ? parts : ['PM adherence needs attention'])}.`;
    }
    case 'calibrate_soon': {
      const due = getString(details, 'next_due');
      const calibrationType = getString(details, 'calibration_type');
      const parts = [
        calibrationType ? calibrationType : null,
        due ? `due ${due}` : null,
      ].filter(Boolean) as string[];
      return `${subject}: ${joinNatural(parts.length > 0 ? parts : ['calibration timing needs review'])}.`;
    }
    case 'part_shortage': {
      const partCode = getString(details, 'part_code');
      const stock = getNumber(details, 'current_stock');
      const parts = getStringArray(details, 'parts');
      const fragments = [
        partCode ? `part ${partCode}` : null,
        parts.length > 0 ? `needed parts ${parts.join(', ')}` : null,
        stock != null ? `stock at ${stock}` : null,
      ].filter(Boolean) as string[];
      return `${subject}: ${joinNatural(fragments.length > 0 ? fragments : ['spare-part support is constrained'])}.`;
    }
    case 'warranty_expiring':
    case 'contract_expiring': {
      const days = getNumber(details, 'days_remaining');
      return `${subject}: ${days != null ? `${days} days remaining on ${flagType === 'warranty_expiring' ? 'warranty' : 'service contract'}` : labelForFlagType(flagType)}.`;
    }
    case 'monitor_closely': {
      const failureCount = getNumber(details, 'failure_count');
      const ageYears = getNumber(details, 'age_years');
      const fragments = [
        failureCount != null ? `${failureCount} recent failures` : null,
        ageYears != null ? `${ageYears} years in service` : null,
      ].filter(Boolean) as string[];
      return `${subject}: ${joinNatural(fragments.length > 0 ? fragments : ['monitor for further degradation'])}.`;
    }
    default:
      return `${subject}: ${labelForFlagType(flagType)}.`;
  }
}

export function generateTriageReason({ flagType, rationale, fallbackRecommendation }: TriageExplanationInput): string {
  const parsed = parseRationaleEntries(rationale);
  const resolvedFlagType = flagType || parsed.top_flag || null;
  const drivers = [
    resolvedFlagType && resolvedFlagType !== 'none' ? labelForFlagType(resolvedFlagType) : null,
    parsed.rpn && parsed.rpn !== '120' ? `RPN ${parsed.rpn}` : null,
    parsed.pmc ? `PM compliance ${parsed.pmc}%` : null,
    parsed.replacement_rank && parsed.replacement_rank !== '999' ? `replacement rank #${parsed.replacement_rank}` : null,
    parsed.open_flags && parsed.open_flags !== '0' ? `${parsed.open_flags} open flags` : null,
  ].filter(Boolean) as string[];

  if (drivers.length > 0) {
    return `Driven by ${joinNatural(drivers)}.`;
  }

  return fallbackRecommendation?.trim() || 'Generated from current triage signals.';
}

export function generateReplacementDriver(input: ReplacementExplanationInput): string {
  const criteria = [
    { label: 'maintenance burden', value: input.maintenance_burden_score ?? null },
    { label: 'availability impact', value: input.availability_score ?? null },
    { label: 'risk pressure', value: input.risk_score ?? null },
    { label: 'age pressure', value: input.age_score ?? null },
    { label: 'failure history', value: input.failure_score ?? null },
    { label: 'spare-part constraint', value: input.spare_part_score ?? null },
    { label: 'cost pressure', value: input.cost_score ?? null },
  ].filter((item) => typeof item.value === 'number') as Array<{ label: string; value: number }>;

  const topDrivers = criteria
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .filter((item) => item.value > 0);

  if (topDrivers.length === 0) {
    return 'Drivers not yet computed.';
  }

  return `Highest drivers: ${joinNatural(topDrivers.map((item) => `${item.label} ${item.value.toFixed(2)}`))}.`;
}

export function generateEscalationSummary(reason: string, severity: string, forwardedTo?: string | null): string {
  const fragments = [
    severity ? `${severity} severity` : null,
    reason ? reason.trim() : null,
    forwardedTo ? `forward to ${forwardedTo}` : null,
  ].filter(Boolean) as string[];
  return joinNatural(fragments);
}
