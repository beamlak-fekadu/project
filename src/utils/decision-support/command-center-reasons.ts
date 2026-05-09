import type { RiskExplanation } from '@/services/risk-assessment.service';

function joinNatural(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function driverStrength(score: number | null | undefined): 'strong' | 'moderate' | 'minor' | null {
  if (score == null) return null;
  if (score >= 0.75) return 'strong';
  if (score >= 0.50) return 'moderate';
  return 'minor';
}

export function formatFmeaExplanation(explanation: RiskExplanation | null | undefined): string {
  if (!explanation) {
    return 'FMEA score computed from clinical impact, failure history, and control evidence.';
  }

  const sScore = explanation.severity?.score ?? 0;
  const oScore = explanation.occurrence?.score ?? 0;
  const dScore = explanation.detectability?.score ?? 0;

  const sDriver = explanation.severity?.drivers?.[0] ?? 'clinical and service impact factors';
  const oDriver = explanation.occurrence?.drivers?.[0] ?? 'historical failure patterns';
  const dDriver = explanation.detectability?.drivers?.[0] ?? 'current inspection and control status';

  const failureCount365 = explanation.occurrence?.failure_count_365d;

  let occurrenceSentence: string;
  if (failureCount365 === 0) {
    occurrenceSentence = `Occurrence ${oScore} — no recorded failures in the last 365 days, but occurrence is elevated due to current condition, age, or risk indicators.`;
  } else {
    const verb = oScore >= 7 ? 'is elevated due to' : 'reflects';
    occurrenceSentence = `Occurrence ${oScore} ${verb} ${oDriver}.`;
  }

  return [
    `Severity ${sScore} reflects ${sDriver}.`,
    occurrenceSentence,
    `Detectability ${dScore} indicates ${dDriver}.`,
  ].join(' ');
}

export function summarizeRiskDrivers(
  explanation: RiskExplanation | null | undefined,
  rpn: number,
  riskLevel: string,
): string {
  const s = explanation?.severity?.score ?? 0;
  const o = explanation?.occurrence?.score ?? 0;
  const d = explanation?.detectability?.score ?? 0;

  const drivers: string[] = [];

  if (s >= 8) drivers.push('high clinical impact');
  else if (s >= 6) drivers.push('moderate clinical impact');

  if (o >= 7) drivers.push('high failure likelihood');
  else if (o >= 5) drivers.push('moderate failure likelihood');

  if (d >= 8) drivers.push('limited failure detection capability');
  else if (d >= 6) drivers.push('moderate detection difficulty');

  if (drivers.length === 0) {
    return `RPN ${rpn} places this equipment in the ${riskLevel} risk band.`;
  }

  return `RPN ${rpn} driven by ${joinNatural(drivers)}.`;
}

export function buildCorrectiveReason(input: {
  flagType?: string | null;
  rpn?: number | null;
  urgency?: string | null;
  departmentName?: string | null;
  condition?: string | null;
  explanation?: RiskExplanation | null;
  repeatFailureCount?: number | null;
}): string {
  const { flagType, rpn, urgency, departmentName, condition, repeatFailureCount } = input;

  const parts: string[] = [];

  if (urgency === 'critical' || urgency === 'high') {
    parts.push(`${urgency} urgency`);
  }

  if (condition === 'non_functional') {
    parts.push('equipment non-functional');
  } else if (condition === 'needs_repair') {
    parts.push('needs repair');
  }

  if (rpn != null && rpn > 200) {
    parts.push(`RPN ${rpn} indicates elevated risk`);
  }

  if (repeatFailureCount != null && repeatFailureCount >= 2) {
    parts.push(`${repeatFailureCount} repeated failures`);
  }

  if (departmentName) {
    parts.push(`${departmentName} department`);
  }

  if (parts.length === 0) {
    return flagType
      ? `Corrective maintenance required due to ${flagType.replace(/_/g, ' ')}.`
      : 'Corrective maintenance required based on current equipment condition and risk indicators.';
  }

  return `Requires attention due to ${joinNatural(parts)}.`;
}

export function buildCalibrationReason(input: {
  daysOverdue?: number | null;
  lastResult?: string | null;
  explanation?: RiskExplanation | null;
}): string {
  const { daysOverdue, lastResult, explanation } = input;

  const parts: string[] = [];

  if (daysOverdue != null && daysOverdue > 0) {
    parts.push(`Calibration overdue by ${daysOverdue} days`);
  } else if (daysOverdue != null && daysOverdue < 0) {
    parts.push(`Calibration due in ${Math.abs(daysOverdue)} days`);
  }

  if (lastResult === 'fail') {
    parts.push('previous calibration failed');
  }

  const dScore = explanation?.detectability?.score;
  if (dScore != null && dScore >= 7) {
    parts.push('high detectability risk');
  }

  if (parts.length === 0) {
    return 'Calibration is due based on schedule or clinical requirements.';
  }

  return parts.join('; ') + '.';
}

export function buildPMReason(input: {
  daysOverdue?: number | null;
  pmcPercentage?: number | null;
  explanation?: RiskExplanation | null;
}): string {
  const { daysOverdue, pmcPercentage, explanation } = input;

  const parts: string[] = [];

  if (daysOverdue != null && daysOverdue > 0) {
    parts.push(`PM overdue by ${daysOverdue} days`);
  }

  if (pmcPercentage != null && pmcPercentage < 70) {
    parts.push(`PM compliance at ${pmcPercentage.toFixed(0)}%`);
  }

  const dScore = explanation?.detectability?.score;
  if (dScore != null && dScore >= 7) {
    parts.push('elevated detectability risk from missed controls');
  }

  if (parts.length === 0) {
    return 'Preventive maintenance is overdue and increasing failure risk.';
  }

  return parts.join('; ') + '.';
}

export function buildStockBlockerReason(input: {
  currentStock?: number | null;
  reorderLevel?: number | null;
  blockedWorkOrders?: number | null;
}): string {
  const { currentStock, reorderLevel, blockedWorkOrders } = input;

  const parts: string[] = [];

  if (currentStock === 0) {
    parts.push('Out of stock');
  } else if (currentStock != null && reorderLevel != null && currentStock < reorderLevel) {
    parts.push(`Stock at ${currentStock} (below reorder level ${reorderLevel})`);
  }

  if (blockedWorkOrders != null && blockedWorkOrders > 0) {
    parts.push(`blocking ${blockedWorkOrders} work order${blockedWorkOrders === 1 ? '' : 's'}`);
  }

  if (parts.length === 0) {
    return 'Stock level is below threshold and may block ongoing repairs.';
  }

  return parts.join('; ') + '.';
}

export function buildInstallationReason(input: {
  daysPending?: number | null;
  status?: string | null;
  departmentName?: string | null;
}): string {
  const { daysPending, status, departmentName } = input;

  const parts: string[] = [];

  if (status && status !== 'commissioned') {
    parts.push('pending commissioning');
  }

  if (daysPending != null && daysPending > 0) {
    parts.push(`${daysPending} days since installation`);
  }

  if (departmentName) {
    parts.push(`${departmentName} department`);
  }

  if (parts.length === 0) {
    return 'Equipment awaiting installation or commissioning.';
  }

  return `Equipment ${joinNatural(parts)}.`;
}

export function buildLifecycleReason(input: {
  rank?: number | null;
  priorityIndex?: number | null;
  ageScore?: number | null;
  failureScore?: number | null;
  availabilityScore?: number | null;
  maintenanceBurdenScore?: number | null;
  sparePartScore?: number | null;
  riskScore?: number | null;
}): string {
  const {
    rank,
    priorityIndex,
    ageScore,
    failureScore,
    availabilityScore,
    maintenanceBurdenScore,
    sparePartScore,
    riskScore,
  } = input;

  const strongDrivers: string[] = [];
  const moderateDrivers: string[] = [];

  const ageStrength = driverStrength(ageScore);
  if (ageStrength === 'strong') strongDrivers.push('advanced age');
  else if (ageStrength === 'moderate') moderateDrivers.push('aging equipment');

  const failureStrength = driverStrength(failureScore);
  if (failureStrength === 'strong') strongDrivers.push('repeated failures');
  else if (failureStrength === 'moderate') moderateDrivers.push('failure history');

  const availabilityStrength = driverStrength(availabilityScore);
  if (availabilityStrength === 'strong') strongDrivers.push('low availability');
  else if (availabilityStrength === 'moderate') moderateDrivers.push('reduced availability');

  const maintenanceStrength = driverStrength(maintenanceBurdenScore);
  if (maintenanceStrength === 'strong') strongDrivers.push('high maintenance burden');
  else if (maintenanceStrength === 'moderate') moderateDrivers.push('elevated maintenance needs');

  const sparePartStrength = driverStrength(sparePartScore);
  if (sparePartStrength === 'strong') strongDrivers.push('poor spare-part support');
  else if (sparePartStrength === 'moderate') moderateDrivers.push('limited spare-part availability');

  const riskStrength = driverStrength(riskScore);
  if (riskStrength === 'strong') strongDrivers.push('high FMEA risk');
  else if (riskStrength === 'moderate') moderateDrivers.push('moderate risk score');

  const allDrivers = [...strongDrivers, ...moderateDrivers];

  if (allDrivers.length === 0) {
    if (priorityIndex != null) {
      return `Replacement candidate with RPI ${priorityIndex.toFixed(2)}.`;
    }
    if (rank != null) {
      return `Replacement candidate ranked #${rank}.`;
    }
    return 'Replacement candidate based on multi-criteria assessment.';
  }

  return `High replacement priority due to ${joinNatural(allDrivers)}.`;
}

export function buildReplacementReason(input: {
  rank?: number | null;
  priorityIndex?: number | null;
  ageScore?: number | null;
  failureScore?: number | null;
  availabilityScore?: number | null;
  maintenanceBurdenScore?: number | null;
  sparePartScore?: number | null;
  riskScore?: number | null;
  costScore?: number | null;
  justification?: string | null;
}): string {
  return buildLifecycleReason(input);
}

export function buildProcurementReason(input: {
  status?: string | null;
  daysDelayed?: number | null;
  linkedEquipmentName?: string | null;
  isLinkedToStockout?: boolean;
}): string {
  const { status, daysDelayed, linkedEquipmentName, isLinkedToStockout } = input;

  const parts: string[] = [];

  if (daysDelayed != null && daysDelayed > 0) {
    parts.push(`delayed by ${daysDelayed} days`);
  }

  if (status && !['received', 'cancelled'].includes(status)) {
    const humanStatus = status.replace(/_/g, ' ');
    parts.push(`status: ${humanStatus}`);
  }

  if (isLinkedToStockout) {
    parts.push('linked to active stockout');
  }

  if (linkedEquipmentName) {
    parts.push(`needed for ${linkedEquipmentName}`);
  }

  if (parts.length === 0) {
    return 'Procurement request pending review or fulfillment.';
  }

  return `Procurement ${joinNatural(parts)}.`;
}

export function buildTrainingReason(input: {
  daysPending?: number | null;
  isNewInstallation?: boolean;
  departmentName?: string | null;
}): string {
  const { daysPending, isNewInstallation, departmentName } = input;

  if (isNewInstallation) {
    const suffix = departmentName ? ` in ${departmentName}` : '';
    return `Newly installed equipment${suffix} requires training before safe use.`;
  }

  if (daysPending != null && daysPending > 7) {
    const suffix = departmentName ? ` for ${departmentName}` : '';
    return `Training pending for ${daysPending} days${suffix}.`;
  }

  if (departmentName) {
    return `Training is pending for ${departmentName} equipment safe use and compliance.`;
  }

  return 'Training is pending for equipment safe use and compliance.';
}
