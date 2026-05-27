import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatEvidence } from '@/types/chatbot';
import { buildDeterministicStructuredFallback, hasUsableStructuredContext } from '@/services/chatbot/structured-context-fallback';

const EMPTY_EVIDENCE: ChatEvidence = {
  equipment: null,
  workOrder: null,
  department: null,
  maintenanceHistory: [],
  pmSnapshot: null,
  calibrationStatus: null,
  logisticsSnapshot: null,
  analyticsSnapshot: null,
  manualOrSopTexts: [],
  documentRetrieval: { notImplemented: true, searchDocuments: [], forEquipment: [], forCategory: [] },
  evidenceSignals: [],
  deniedContextRefs: [],
  accessDenied: false,
  missingDataFlags: [],
};

test('prioritize_tasks malformed provider output recovers using operational signals', () => {
  const blocks: Record<string, unknown> = {
    rankedOperationalQueue: [
      { label: 'WO-103 critical ventilator check', score: 93 },
      { label: 'Overdue PM infusion pumps ICU', score: 89 },
      { label: 'Flagged monitor with concurrent alerts', score: 86 },
    ],
    overduePm: [{ id: 'pm-1' }, { id: 'pm-2' }, { id: 'pm-3' }],
    recommendationFlags: [{ id: 'f-1' }, { id: 'f-2' }, { id: 'f-3' }, { id: 'f-4' }, { id: 'f-5' }],
    proactiveSignals: ['3 overdue PM plans', '5 high/critical recommendation flags', 'asset has 2 concurrent flags'],
  };
  assert.equal(hasUsableStructuredContext(blocks, EMPTY_EVIDENCE), true);
  const out = buildDeterministicStructuredFallback({
    capability: 'prioritize_tasks',
    decision: 'answer',
    blocks,
    evidence: EMPTY_EVIDENCE,
  });
  assert.equal(out.summary.includes('could not be displayed reliably'), false);
  assert.ok((out.priority_reasoning ?? []).length >= 3);
  assert.ok((out.recommended_actions ?? []).length >= 3);
});

test('my_tasks malformed provider output recovers using task data', () => {
  const blocks: Record<string, unknown> = {
    assignedWorkOrders: [{ id: 'wo-1' }, { id: 'wo-2' }],
    recommendationFlags: [{ id: 'f-1' }],
  };
  const out = buildDeterministicStructuredFallback({
    capability: 'my_tasks',
    decision: 'answer',
    blocks,
    evidence: { ...EMPTY_EVIDENCE, evidenceSignals: ['2 assigned work orders'] },
  });
  assert.equal(out.summary.includes('could not be displayed reliably'), false);
  assert.ok((out.key_findings ?? []).length > 0);
});

test('safe_troubleshooting malformed provider output recovers using checklist', () => {
  const blocks: Record<string, unknown> = {
    tier1Troubleshooting: [
      { check: 'Verify AC power and battery seating.' },
      { check: 'Inspect accessory cables and connectors.' },
      { check: 'Confirm PM/calibration status in system.' },
    ],
  };
  const out = buildDeterministicStructuredFallback({
    capability: 'safe_troubleshooting',
    decision: 'limited_answer',
    blocks,
    evidence: EMPTY_EVIDENCE,
  });
  assert.equal(out.summary.includes('could not be displayed reliably'), false);
  assert.ok((out.troubleshooting_steps ?? []).length >= 3);
});

test('summarize_work_order malformed provider output recovers using work-order context', () => {
  const blocks: Record<string, unknown> = {
    workOrder: { id: 'wo-8', work_order_number: 'WO-0008', status: 'in_progress' },
  };
  const out = buildDeterministicStructuredFallback({
    capability: 'summarize_work_order',
    decision: 'answer',
    blocks,
    evidence: EMPTY_EVIDENCE,
  });
  assert.equal(out.summary.includes('could not be displayed reliably'), false);
  assert.ok(out.summary.includes('WO-0008'));
});
