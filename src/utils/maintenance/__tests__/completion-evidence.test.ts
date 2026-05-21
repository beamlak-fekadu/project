import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveReliabilityEvidence,
  shouldAlwaysWriteCompletionEvent,
} from '@/utils/maintenance/completion-evidence';

// WO-completion truth fix: the deriver guarantees a complete evidence row for
// every corrective WO, even when the technician supplies nothing. These tests
// lock that contract so a future "small refactor" can't quietly skip the
// maintenance_events writer again.

const BASE = {
  workOrderId: 'wo-1',
  assetId: 'asset-1',
  performedByProfileId: 'profile-1',
  workType: 'corrective' as const,
};

test('explicit values are preserved verbatim', () => {
  const evidence = deriveReliabilityEvidence({
    ...BASE,
    explicitRepairDurationHours: 2.5,
    explicitDowntimeStart: '2026-05-21T13:00:00.000Z',
    explicitDowntimeEnd: '2026-05-21T15:30:00.000Z',
    explicitFailureDate: '2026-05-21',
    explicitActionTaken: 'Replaced PSU; verified output.',
  });
  assert.equal(evidence.repairDurationHours, 2.5);
  assert.equal(evidence.downtimeStart, '2026-05-21T13:00:00.000Z');
  assert.equal(evidence.downtimeEnd, '2026-05-21T15:30:00.000Z');
  assert.equal(evidence.failureDate, '2026-05-21');
  assert.equal(evidence.actionTaken, 'Replaced PSU; verified output.');
  assert.equal(evidence.source, 'explicit');
  assert.deepEqual(evidence.derivedFields, []);
  assert.equal(evidence.hasExplicitEvidence, true);
});

test('missing inputs derive from work-order timestamps (observed bug fixture)', () => {
  // The exact scenario from WO-MPFBL8DK in the production bug report.
  // Started 13:06:44, completed 13:08:42 → ~0.03 hours.
  const evidence = deriveReliabilityEvidence({
    ...BASE,
    workOrderCreatedAt: '2026-05-21T13:00:00.000Z',
    workOrderStartedAt: '2026-05-21T13:06:44.000Z',
    workOrderCompletedAt: '2026-05-21T13:08:42.000Z',
    workOrderActualHours: null,
    completionOutcome: 'resolved',
  });
  assert.equal(evidence.downtimeStart, '2026-05-21T13:06:44.000Z');
  assert.equal(evidence.downtimeEnd, '2026-05-21T13:08:42.000Z');
  // (13:08:42 - 13:06:44) / 3600 ≈ 0.0328 → rounded to 2dp = 0.03
  assert.equal(evidence.repairDurationHours, 0.03);
  assert.equal(evidence.failureDate, '2026-05-21');
  // Derived narrative includes the outcome label.
  assert.match(evidence.actionTaken ?? '', /Resolved/i);
  assert.equal(evidence.source, 'derived');
  assert.ok(evidence.derivedFields.includes('downtime_start'));
  assert.ok(evidence.derivedFields.includes('downtime_end'));
  assert.ok(evidence.derivedFields.includes('repair_duration_hours'));
  assert.ok(evidence.derivedFields.includes('failure_date'));
});

test('actual_hours wins over computed-from-timestamps derivation', () => {
  const evidence = deriveReliabilityEvidence({
    ...BASE,
    workOrderStartedAt: '2026-05-21T13:00:00.000Z',
    workOrderCompletedAt: '2026-05-21T14:00:00.000Z',
    workOrderActualHours: 0.75,
  });
  assert.equal(evidence.repairDurationHours, 0.75);
  assert.ok(evidence.derivedFields.includes('repair_duration_hours'));
});

test('originating request created_at trumps wo.created_at for failure_date', () => {
  const evidence = deriveReliabilityEvidence({
    ...BASE,
    workOrderCreatedAt: '2026-05-21T13:00:00.000Z',
    originatingRequestCreatedAt: '2026-05-19T10:15:00.000Z',
  });
  assert.equal(evidence.failureDate, '2026-05-19');
});

test('inverted downtime range is rejected (cleared, not propagated)', () => {
  const evidence = deriveReliabilityEvidence({
    ...BASE,
    explicitDowntimeStart: '2026-05-21T15:00:00.000Z',
    explicitDowntimeEnd: '2026-05-21T13:00:00.000Z',
  });
  assert.equal(evidence.downtimeStart, null);
  assert.equal(evidence.downtimeEnd, null);
  assert.ok(evidence.warnings.includes('downtime_range_invalid'));
});

test('mixed source: explicit duration + derived downtime', () => {
  const evidence = deriveReliabilityEvidence({
    ...BASE,
    workOrderStartedAt: '2026-05-21T13:00:00.000Z',
    workOrderCompletedAt: '2026-05-21T14:30:00.000Z',
    explicitRepairDurationHours: 1.0,
  });
  assert.equal(evidence.repairDurationHours, 1.0);
  assert.equal(evidence.downtimeStart, '2026-05-21T13:00:00.000Z');
  assert.equal(evidence.source, 'mixed');
  assert.equal(evidence.hasExplicitEvidence, true);
});

test('event_type maps corrective/preventive/inspection straight, anything else → corrective', () => {
  for (const [input, expected] of [
    ['corrective', 'corrective'],
    ['preventive', 'preventive'],
    ['inspection', 'inspection'],
    ['calibration', 'corrective'],
    ['installation', 'corrective'],
    ['unknown_type', 'corrective'],
    [null, 'corrective'],
    [undefined, 'corrective'],
  ] as const) {
    const e = deriveReliabilityEvidence({ ...BASE, workType: input as never });
    assert.equal(e.eventType, expected, `workType=${String(input)} should map to ${expected}`);
  }
});

test('outcome narrative is appended to notes only when not already in action_taken', () => {
  const e1 = deriveReliabilityEvidence({
    ...BASE,
    completionOutcome: 'resolved',
    explicitActionTaken: 'Resolved — issue fully fixed.',
  });
  // Already mentions resolved → narrative should not be duplicated.
  const occurrences = (e1.notes.match(/Resolved/g) ?? []).length;
  assert.ok(occurrences <= 1);

  const e2 = deriveReliabilityEvidence({
    ...BASE,
    completionOutcome: 'resolved',
    workOrderStartedAt: '2026-05-21T13:00:00.000Z',
    workOrderCompletedAt: '2026-05-21T13:30:00.000Z',
  });
  // No explicit action_taken → outcome label is the derived action.
  assert.match(e2.actionTaken ?? '', /Resolved/);
});

test('shouldAlwaysWriteCompletionEvent: corrective and unknown types yes, others no', () => {
  assert.equal(shouldAlwaysWriteCompletionEvent('corrective'), true);
  assert.equal(shouldAlwaysWriteCompletionEvent(null), true);
  assert.equal(shouldAlwaysWriteCompletionEvent(undefined), true);
  assert.equal(shouldAlwaysWriteCompletionEvent(''), true);
  assert.equal(shouldAlwaysWriteCompletionEvent('preventive'), false);
  assert.equal(shouldAlwaysWriteCompletionEvent('inspection'), false);
  assert.equal(shouldAlwaysWriteCompletionEvent('calibration'), false);
  assert.equal(shouldAlwaysWriteCompletionEvent('installation'), false);
});

test('zero-and-negative inputs are sanitised', () => {
  const e = deriveReliabilityEvidence({
    ...BASE,
    explicitRepairDurationHours: -5,
    workOrderActualHours: 0,
  });
  // -5 is rejected → falls through to workOrderActualHours (0). 0 is a valid
  // non-negative number, so it should be kept.
  assert.equal(e.repairDurationHours, 0);
});

test('missing completion timestamp does not invent downtime end or duration', () => {
  const e = deriveReliabilityEvidence({
    ...BASE,
    workOrderStartedAt: '2020-01-01T00:00:00.000Z',
    // No completed_at and no explicit end.
  });
  assert.equal(e.downtimeStart, '2020-01-01T00:00:00.000Z');
  assert.equal(e.downtimeEnd, null);
  assert.equal(e.repairDurationHours, null);
  assert.ok(e.warnings.includes('downtime_range_unavailable'));
  assert.ok(e.warnings.includes('repair_duration_hours_unavailable'));
});

test('action_taken falls back to wo.action_taken then wo.closure_notes then outcome', () => {
  // 1. wo.action_taken wins
  const e1 = deriveReliabilityEvidence({
    ...BASE,
    workOrderActionTaken: 'Tightened cable.',
    workOrderClosureNotes: 'Closure note here.',
    completionOutcome: 'resolved',
  });
  assert.equal(e1.actionTaken, 'Tightened cable.');

  // 2. closure_notes when action_taken missing
  const e2 = deriveReliabilityEvidence({
    ...BASE,
    workOrderClosureNotes: 'Closure note here.',
    completionOutcome: 'resolved',
  });
  assert.equal(e2.actionTaken, 'Closure note here.');

  // 3. outcome narrative when nothing else
  const e3 = deriveReliabilityEvidence({
    ...BASE,
    completionOutcome: 'not_resolved',
  });
  assert.match(e3.actionTaken ?? '', /Not resolved/);
});

test('completionDate is always today (YYYY-MM-DD)', () => {
  const e = deriveReliabilityEvidence({ ...BASE });
  assert.match(e.completionDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(e.completionDate, new Date().toISOString().slice(0, 10));
});
