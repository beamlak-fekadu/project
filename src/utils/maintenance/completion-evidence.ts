// R2 follow-up (WO-completion truth fix): pure helper that derives a complete
// set of reliability-evidence fields from a work-order row at completion time,
// using whatever explicit input the caller supplied and falling back to the
// work order's own lifecycle timestamps. Lives outside maintenance.actions.ts
// so it is unit-testable without spinning up the 'use server' module.
//
// The output is the canonical shape we insert into / update on
// maintenance_events when a corrective work order completes. Migration 00061's
// trigger then derives the matching downtime_logs row that fn_compute_mtbf
// reads, so MTTR / MTBF / availability move only after this row lands.

import type { Capability } from '@/lib/rbac';

export type DeriveReliabilityEvidenceWorkType =
  | 'corrective'
  | 'preventive'
  | 'inspection'
  | 'calibration'
  | 'installation';

export type DerivedEvidenceSource = 'explicit' | 'derived' | 'mixed';

export interface DeriveReliabilityEvidenceInput {
  /** Work order id — required so the resulting event can be linked. */
  workOrderId: string;
  /** Equipment asset id — required. */
  assetId: string;
  /** Work order created_at (ISO). Used as failure_date fallback. */
  workOrderCreatedAt?: string | null;
  /** Work order started_at (ISO). Used as downtime_start fallback. */
  workOrderStartedAt?: string | null;
  /** Work order completed_at (ISO). Used as downtime_end fallback. */
  workOrderCompletedAt?: string | null;
  /** Work order actual_hours (number). Used as repair_duration fallback. */
  workOrderActualHours?: number | null;
  /** Originating maintenance request created_at (ISO). Best failure_date source. */
  originatingRequestCreatedAt?: string | null;
  /** Work order work_type. Drives event_type and whether we require evidence at all. */
  workType?: DeriveReliabilityEvidenceWorkType | string | null;
  /** Work order action_taken (free text on the WO itself). */
  workOrderActionTaken?: string | null;
  /** Work order closure_notes — secondary action_taken fallback. */
  workOrderClosureNotes?: string | null;
  /** Completion outcome chosen at completion time (resolved / partially_resolved …). */
  completionOutcome?: string | null;
  /** Profile id of the user performing the completion. */
  performedByProfileId: string;

  /** Explicit reliability fields supplied by the caller (may be empty). */
  explicitRepairDurationHours?: number | string | null;
  explicitDowntimeStart?: string | null;
  explicitDowntimeEnd?: string | null;
  explicitFailureDate?: string | null;
  explicitActionTaken?: string | null;
}

export interface DerivedReliabilityEvidence {
  /** Final values to insert/update into maintenance_events. */
  workOrderId: string;
  assetId: string;
  eventType: 'corrective' | 'preventive' | 'inspection';
  failureDate: string | null;
  downtimeStart: string | null;
  downtimeEnd: string | null;
  repairDurationHours: number | null;
  actionTaken: string | null;
  completedBy: string;
  completionDate: string;
  notes: string;
  warnings: string[];
  /** Which fields were derived vs supplied. Lets the action / UI annotate. */
  source: DerivedEvidenceSource;
  derivedFields: string[];
  /**
   * True when the work order is corrective. Corrective completion ALWAYS gets
   * an event; other work types (preventive/inspection/calibration/installation)
   * are evidenced through their own tables (pm_completions etc.) and only get
   * a maintenance_events row when the caller actively supplied evidence.
   */
  isCorrective: boolean;
  /** True when at least one of the explicit fields was supplied by the caller. */
  hasExplicitEvidence: boolean;
}

function toNumberOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function isoOrNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dateOnlyOrNull(v: string | null | undefined): string | null {
  const iso = isoOrNull(v);
  if (!iso) return null;
  // Accept full ISO timestamps or YYYY-MM-DD; normalise to YYYY-MM-DD.
  // We don't reject — Postgres DATE accepts both, but normalising prevents
  // accidental string drift between the action and the DB.
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

function hoursBetweenIso(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const diffHours = (end - start) / 3_600_000;
  // Round to 2 decimal places to avoid noise like 0.029999…
  return Math.round(diffHours * 100) / 100;
}

function normaliseWorkType(
  v: DeriveReliabilityEvidenceWorkType | string | null | undefined,
): 'corrective' | 'preventive' | 'inspection' {
  switch (v) {
    case 'preventive':
      return 'preventive';
    case 'inspection':
      return 'inspection';
    case 'corrective':
    case 'calibration':
    case 'installation':
    default:
      // calibration/installation completion events feed corrective-style
      // history when written; pm_completions and installation_records carry
      // the primary evidence. We log 'corrective' here only when the caller
      // explicitly opted in by supplying reliability fields (handled upstream).
      return 'corrective';
  }
}

function outcomeNarrative(outcome: string | null | undefined): string | null {
  switch (outcome) {
    case 'resolved': return 'Resolved — issue fully fixed.';
    case 'partially_resolved': return 'Partially resolved — some issues remain.';
    case 'not_resolved': return 'Not resolved — equipment still non-functional.';
    case 'awaiting_parts_or_vendor': return 'Awaiting parts or vendor — blocked.';
    default: return null;
  }
}

export function deriveReliabilityEvidence(
  input: DeriveReliabilityEvidenceInput,
): DerivedReliabilityEvidence {
  const derivedFields: string[] = [];
  const workType = normaliseWorkType(input.workType);
  const isCorrective =
    input.workType === 'corrective' ||
    input.workType === undefined ||
    input.workType === null ||
    input.workType === '';

  // ---------- downtime_start ----------
  const warnings: string[] = [];
  const explicitDowntimeStart = isoOrNull(input.explicitDowntimeStart);
  let downtimeStart: string | null = explicitDowntimeStart;
  if (!downtimeStart) {
    downtimeStart =
      isoOrNull(input.workOrderStartedAt) ??
      isoOrNull(input.workOrderCreatedAt);
    if (downtimeStart) derivedFields.push('downtime_start');
  }

  // ---------- downtime_end ----------
  const explicitDowntimeEnd = isoOrNull(input.explicitDowntimeEnd);
  let downtimeEnd: string | null = explicitDowntimeEnd;
  if (!downtimeEnd) {
    downtimeEnd = isoOrNull(input.workOrderCompletedAt);
    if (downtimeEnd) derivedFields.push('downtime_end');
  }

  // Reject inverted ranges — propagate as a null pair rather than poison MTBF.
  if (downtimeStart && downtimeEnd && Date.parse(downtimeEnd) <= Date.parse(downtimeStart)) {
    downtimeStart = null;
    downtimeEnd = null;
    warnings.push('downtime_range_invalid');
  }

  // ---------- repair_duration_hours ----------
  const explicitRepair = toNumberOrNull(input.explicitRepairDurationHours);
  let repairDurationHours: number | null = explicitRepair;
  if (repairDurationHours === null) {
    const fromActual = toNumberOrNull(input.workOrderActualHours ?? null);
    if (fromActual !== null) {
      repairDurationHours = fromActual;
      derivedFields.push('repair_duration_hours');
    } else {
      // Last resort: compute from started_at → completed_at. We use the
      // *original* (un-substituted) timestamps when present so the derived
      // duration matches what the user actually observed.
      const computed = hoursBetweenIso(
        isoOrNull(input.workOrderStartedAt) ?? downtimeStart,
        isoOrNull(input.workOrderCompletedAt) ?? downtimeEnd,
      );
      if (computed !== null) {
        repairDurationHours = computed;
        derivedFields.push('repair_duration_hours');
      }
    }
  }
  if (repairDurationHours === null) {
    warnings.push('repair_duration_hours_unavailable');
  }
  if (!downtimeStart || !downtimeEnd) {
    warnings.push('downtime_range_unavailable');
  }

  // ---------- failure_date ----------
  const explicitFailureDate = dateOnlyOrNull(input.explicitFailureDate);
  let failureDate: string | null = explicitFailureDate;
  if (!failureDate) {
    failureDate =
      dateOnlyOrNull(input.originatingRequestCreatedAt) ??
      dateOnlyOrNull(input.workOrderCreatedAt);
    if (failureDate) derivedFields.push('failure_date');
  }

  // ---------- action_taken ----------
  const explicitActionTaken =
    typeof input.explicitActionTaken === 'string' && input.explicitActionTaken.trim().length > 0
      ? input.explicitActionTaken.trim()
      : null;
  let actionTaken: string | null = explicitActionTaken;
  if (!actionTaken) {
    const fromWo =
      (typeof input.workOrderActionTaken === 'string' && input.workOrderActionTaken.trim().length > 0
        ? input.workOrderActionTaken.trim()
        : null) ??
      (typeof input.workOrderClosureNotes === 'string' && input.workOrderClosureNotes.trim().length > 0
        ? input.workOrderClosureNotes.trim()
        : null) ??
      outcomeNarrative(input.completionOutcome);
    if (fromWo) {
      actionTaken = fromWo;
      derivedFields.push('action_taken');
    }
  }

  const hasExplicitEvidence = Boolean(
    explicitDowntimeStart ||
    explicitDowntimeEnd ||
    explicitRepair !== null ||
    explicitFailureDate ||
    explicitActionTaken,
  );

  const source: DerivedEvidenceSource =
    derivedFields.length === 0
      ? 'explicit'
      : hasExplicitEvidence
        ? 'mixed'
        : 'derived';

  const noteParts: string[] = [
    'Auto-logged from work-order completion (reliability evidence pipeline).',
    source === 'explicit'
      ? 'Source: explicit user input.'
      : source === 'mixed'
        ? `Source: explicit input + derived from work-order timestamps (${derivedFields.join(', ')}).`
        : `Source: derived from work-order timestamps (${derivedFields.join(', ')}).`,
  ];
  const outcomeLine = outcomeNarrative(input.completionOutcome);
  if (outcomeLine && !actionTaken?.includes(outcomeLine)) noteParts.push(outcomeLine);

  return {
    workOrderId: input.workOrderId,
    assetId: input.assetId,
    eventType: workType,
    failureDate,
    downtimeStart,
    downtimeEnd,
    repairDurationHours,
    actionTaken,
    completedBy: input.performedByProfileId,
    completionDate: new Date().toISOString().slice(0, 10),
    notes: noteParts.join(' '),
    warnings,
    source,
    derivedFields,
    isCorrective,
    hasExplicitEvidence,
  };
}

/**
 * For exhaustive matching in callers that need to know "should we even attempt
 * to write an event for this work type?" Corrective: yes, always. Other types:
 * only if the caller supplied explicit reliability evidence.
 */
export function shouldAlwaysWriteCompletionEvent(
  workType: DeriveReliabilityEvidenceWorkType | string | null | undefined,
): boolean {
  return workType === 'corrective' || workType === undefined || workType === null || workType === '';
}

// Sanity: keep this type referenced so the rbac import isn't pruned by lint
// when callers only need the helper.
export const _COMPLETION_EVIDENCE_CAPABILITY: Capability = 'work_order.complete';
