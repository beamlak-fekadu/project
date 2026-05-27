import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceCompleteness, type EvidenceRequirementKey } from '@/services/chatbot/context-service';
import type { ChatEvidence } from '@/types/chatbot';

const emptyRetrieval: ChatEvidence['documentRetrieval'] = {
  notImplemented: false,
  searchDocuments: [],
  forEquipment: [],
  forCategory: [],
};

function evidence(overrides: Partial<{
  equipment: Record<string, unknown> | null;
  workOrder: Record<string, unknown> | null;
  department: Record<string, unknown> | null;
  maintenanceHistory: Record<string, unknown>[];
  openWorkOrders: Record<string, unknown>[];
  maintenanceRequests: Record<string, unknown>[];
  pmSnapshot: Record<string, unknown> | null;
  calibrationStatus: Record<string, unknown> | null;
  logisticsSnapshot: Record<string, unknown> | null;
  analyticsSnapshot: Record<string, unknown> | null;
  manualOrSopTexts: string[];
}> = {}) {
  return {
    equipment: null,
    workOrder: null,
    department: null,
    maintenanceHistory: [],
    openWorkOrders: [],
    maintenanceRequests: [],
    pmSnapshot: null,
    calibrationStatus: null,
    logisticsSnapshot: null,
    analyticsSnapshot: null,
    manualOrSopTexts: [],
    ...overrides,
  };
}

function completeness(params: {
  expected: EvidenceRequirementKey[];
  optional?: EvidenceRequirementKey[];
  evidence: ReturnType<typeof evidence>;
  missingDataFlags?: string[];
  deniedContextRefs?: Array<'equipment' | 'work_order' | 'department'>;
}) {
  return buildEvidenceCompleteness({
    expected: new Set(params.expected),
    optional: new Set(params.optional ?? []),
    missingDataFlags: params.missingDataFlags ?? [],
    deniedContextRefs: params.deniedContextRefs ?? [],
    contextRefs: { equipmentId: '11111111-1111-4111-8111-111111111111' },
    documentRetrieval: emptyRetrieval,
    evidence: params.evidence,
  });
}

test('equipment summary completeness is partial when asset exists but supporting evidence is missing', () => {
  const result = completeness({
    expected: ['equipment'],
    optional: ['maintenanceHistory', 'openWorkOrders', 'pmSnapshot', 'calibrationStatus', 'analyticsSnapshot'],
    evidence: evidence({ equipment: { id: 'asset-1', asset_code: 'ED-0002' } }),
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.requiredMissing.length, 0);
  assert.ok(result.optionalMissing.includes('pmSnapshot'));
  assert.ok(result.score > 0.65 && result.score < 1);
});

test('work-order status completeness is insufficient when required work order is missing', () => {
  const result = completeness({
    expected: ['workOrder'],
    evidence: evidence(),
    missingDataFlags: ['work_order_record_missing'],
  });

  assert.equal(result.status, 'insufficient');
  assert.deepEqual(result.requiredMissing, ['workOrder']);
});

test('denied context marks completeness denied when no required evidence is visible', () => {
  const result = completeness({
    expected: ['equipment'],
    evidence: evidence(),
    deniedContextRefs: ['equipment'],
  });

  assert.equal(result.status, 'denied');
});
