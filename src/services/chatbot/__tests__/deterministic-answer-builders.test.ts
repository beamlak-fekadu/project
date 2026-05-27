import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeterministicAnswerCandidate } from '@/services/chatbot/deterministic-answer-builders';
import { applyResponseUsefulnessGuard } from '@/services/chatbot/response-usefulness-guard';
import type { ChatEvidence, ClassifiedRequest, UserChatProfile } from '@/types/chatbot';

const BME_HEAD: UserChatProfile = {
  profileId: 'bme-head-1',
  roleNames: ['bme_head'],
  departmentId: null,
};

const TECHNICIAN: UserChatProfile = {
  profileId: 'tech-1',
  roleNames: ['technician'],
  departmentId: null,
};

const VIEWER: UserChatProfile = {
  profileId: 'viewer-1',
  roleNames: ['viewer'],
  departmentId: null,
};

const DEVELOPER: UserChatProfile = {
  profileId: 'developer-1',
  roleNames: ['developer'],
  departmentId: null,
};

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

test('equipment page context produces grounded asset summary without asking which asset', () => {
  const out = buildDeterministicAnswerCandidate({
    capability: 'summarize_equipment',
    decision: 'answer',
    profile: TECHNICIAN,
    message: 'summarize this asset',
    contextRefs: { equipmentId: 'asset-1' },
    moduleContext: { route: '/equipment/asset-1', selectedRecordLabel: 'OT-ANE-001 - Anesthesia Machine' },
    blocks: {
      formalToolTrace: {
        results: [
          {
            toolName: 'read_equipment_status',
            data: {
              id: 'asset-1',
              asset_code: 'OT-ANE-001',
              name: 'Anesthesia Machine',
              condition: 'needs_repair',
              status: 'active',
              equipment_categories: { criticality_level: 'critical' },
            },
            evidenceSignals: ['Loaded equipment/QR asset context.'],
            sourceTables: ['equipment_assets'],
            routeLinks: [{ label: 'Open equipment', href: '/equipment/asset-1', type: 'equipment' }],
          },
        ],
      },
    },
    evidence: EMPTY_EVIDENCE,
  });

  assert.ok(out);
  assert.match(out.summary, /OT-ANE-001/);
  assert.equal(out.answer_basis, 'system_data');
  assert.ok(out.evidence_used.some((item) => item.includes('OT-ANE-001')));
});

test('QR page context uses QR asset evidence', () => {
  const out = buildDeterministicAnswerCandidate({
    capability: 'qr_asset_context',
    decision: 'answer',
    profile: TECHNICIAN,
    message: 'what should I know?',
    moduleContext: { route: '/qr/a/qra_test', qrToken: 'qra_test' },
    blocks: {
      formalToolTrace: {
        results: [
          {
            toolName: 'read_qr_asset_context',
            data: {
              id: 'asset-2',
              asset_code: 'ICU-MON-002',
              name: 'Patient Monitor',
              condition: 'functional',
              status: 'active',
              qr_label_status: 'attached',
            },
            evidenceSignals: ['Loaded equipment/QR asset context.'],
            sourceTables: ['equipment_assets'],
          },
          {
            toolName: 'read_qr_scan_evidence',
            data: [{ id: 'scan-1', asset_id: 'asset-2', scan_source: 'web' }],
            evidenceSignals: ['Loaded QR scan evidence.'],
            sourceTables: ['equipment_qr_scans'],
          },
        ],
      },
    },
    evidence: EMPTY_EVIDENCE,
  });

  assert.ok(out);
  assert.match(out.summary, /ICU-MON-002/);
  assert.match(out.summary, /attached/);
  assert.equal(out.answer_basis, 'system_data');
});

test('BME Head priority answer uses real ranked evidence instead of generic filler', () => {
  const out = buildDeterministicAnswerCandidate({
    capability: 'prioritize_tasks',
    decision: 'answer',
    profile: BME_HEAD,
    message: 'What should I prioritize today?',
    blocks: {
      rankedOperationalQueue: [
        { label: 'WO OT-ANE-001 critical anesthesia fault', score: 94 },
        { label: 'Overdue PM ICU ventilators', score: 88 },
      ],
      assignedWorkOrders: [{ id: 'wo-1', priority: 'critical' }],
      overduePm: [{ id: 'pm-1' }],
      recommendationFlags: [{ id: 'flag-1', severity: 'critical' }],
      evidenceUsed: ['Command Center snapshot'],
    },
    evidence: EMPTY_EVIDENCE,
  });

  assert.ok(out);
  assert.match(out.summary, /OT-ANE-001/);
  assert.ok(out.priority_reasoning.length >= 2);
  assert.equal(out.summary.includes('review the dashboard'), false);
});

test('BME Head priority answer uses Command Center Critical Action Score rows', () => {
  const out = buildDeterministicAnswerCandidate({
    capability: 'prioritize_tasks',
    decision: 'answer',
    profile: BME_HEAD,
    message: 'What is the most urgent action right now?',
    moduleContext: { route: '/command', pageLabel: 'Command Center' },
    blocks: {
      formalToolTrace: {
        results: [
          {
            toolName: 'read_command_center_snapshot',
            data: {
              criticalActions: [
                {
                  title: 'Ward Nebulizer #2',
                  category: 'needs_request',
                  score: 262,
                  urgency: 'critical',
                  departmentName: 'Inpatient Ward',
                  reason: 'non functional with RPN 324 and no open corrective request',
                  scoreBreakdown: ['Base 100', 'Condition non functional', 'RPN 324'],
                  primaryAction: 'Create Request',
                },
              ],
            },
            evidenceSignals: ['Loaded Command Center Critical Action Score rows.'],
            sourceTables: ['work_order_parts_needed', 'v_calibration_due', 'v_overdue_pm'],
          },
        ],
      },
    },
    evidence: EMPTY_EVIDENCE,
  });

  assert.ok(out);
  assert.match(out.summary, /Ward Nebulizer #2/);
  assert.match(out.summary, /Critical Action Score/);
  assert.match(out.priority_reasoning.join(' '), /RPN 324/);
});

test('technician priority answer focuses assigned work instead of hospital triage', () => {
  const out = buildDeterministicAnswerCandidate({
    capability: 'prioritize_tasks',
    decision: 'answer',
    profile: TECHNICIAN,
    message: 'What should I work on first?',
    blocks: {
      assignedWorkOrders: [
        {
          id: 'wo-9',
          work_order_number: 'WO-2026-009',
          status: 'assigned',
          priority: 'critical',
          equipment_assets: { asset_code: 'ICU-VEN-002', name: 'ICU Ventilator #2' },
        },
      ],
      rankedOperationalQueue: [{ label: 'Hospital triage item', score: 250 }],
    },
    evidence: EMPTY_EVIDENCE,
  });

  assert.ok(out);
  assert.match(out.summary, /WO-2026-009/);
  assert.match(out.summary, /ICU-VEN-002/);
  assert.doesNotMatch(out.summary, /Hospital triage item/);
});

test('technician reliability evidence answer names required metric fields', () => {
  const out = buildDeterministicAnswerCandidate({
    capability: 'explain_equipment_risk',
    decision: 'answer',
    profile: TECHNICIAN,
    message: 'What evidence do I need to record so reliability metrics update?',
    blocks: {
      formalToolTrace: {
        results: [
          {
            toolName: 'read_current_page_context',
            data: { route: '/maintenance/work-orders' },
            evidenceSignals: ['Loaded registered page context.'],
            sourceTables: ['moduleContext'],
          },
        ],
      },
    },
    evidence: EMPTY_EVIDENCE,
  });

  assert.ok(out);
  assert.match(out.summary, /repair_duration_hours/);
  assert.match(out.summary, /downtime_start/);
  assert.match(out.summary, /downtime_end/);
  assert.match(out.summary, /failure_date/);
  assert.ok(out.source_tables.includes('maintenance_events'));
});

test('store blocker answer cites work_order_parts_needed declared blockers', () => {
  const out = buildDeterministicAnswerCandidate({
    capability: 'logistics_status',
    decision: 'answer',
    profile: { profileId: 'store-1', roleNames: ['store_user'], departmentId: null },
    message: 'Which parts are blocking work?',
    moduleContext: { route: '/spare-parts', pageLabel: 'Spare Parts' },
    blocks: {
      formalToolTrace: {
        results: [
          {
            toolName: 'read_stock_blockers',
            data: [
              {
                blocker_source: 'work_order_parts_needed',
                part_code: 'SP-MOT-SUC',
                name: 'Suction Motor Assembly',
                current_stock: 0,
                reorder_level: 2,
                linked_work_order_number: 'WO-2026-014',
                linked_asset_code: 'OR-SUC-002',
                linked_asset_name: 'OR Suction Unit #2',
              },
            ],
            evidenceSignals: ['Loaded 1 declared work_order_parts_needed blocker(s).'],
            sourceTables: ['work_order_parts_needed', 'spare_parts'],
          },
        ],
      },
    },
    evidence: EMPTY_EVIDENCE,
  });

  assert.ok(out);
  assert.match(out.summary, /work_order_parts_needed/);
  assert.match(out.summary, /Suction Motor Assembly/);
  assert.match(out.summary, /WO-2026-014/);
  assert.ok(out.source_tables.includes('work_order_parts_needed'));
});

test('department user report prompt gives request intake guidance', () => {
  const out = buildDeterministicAnswerCandidate({
    capability: 'general_system_fallback',
    decision: 'answer',
    profile: { profileId: 'dept-user-1', roleNames: ['department_user'], departmentId: 'dep-icu', departmentName: 'ICU' },
    message: 'Help me report a problem with this equipment.',
    moduleContext: { route: '/maintenance/requests/new', selectedRecordLabel: 'ICU Ventilator #2' },
    blocks: {},
    evidence: EMPTY_EVIDENCE,
  });

  assert.ok(out);
  assert.match(out.summary, /department-scoped maintenance request/);
  assert.match(out.key_findings.join(' '), /observed symptom/);
  assert.match(out.recommended_actions.join(' '), /assignment/);
});

test('viewer zero metric answer explains source and freshness without developer trace', () => {
  const out = buildDeterministicAnswerCandidate({
    capability: 'metric_debug',
    decision: 'limited_answer',
    profile: VIEWER,
    message: 'Why is this metric zero?',
    moduleContext: { route: '/command', pageLabel: 'Command Center' },
    blocks: { sourceTables: ['clinical_readiness_snapshots'] },
    evidence: EMPTY_EVIDENCE,
  });

  assert.ok(out);
  assert.match(out.summary, /source produced zero/);
  assert.match(out.key_findings.join(' '), /raw developer traces are hidden/);
  assert.deepEqual(out.action_drafts, []);
});

test('technician troubleshooting stays safe and refuses bypass-style depth', () => {
  const out = buildDeterministicAnswerCandidate({
    capability: 'safe_troubleshooting',
    decision: 'limited_answer',
    profile: TECHNICIAN,
    message: 'What should I check before escalation?',
    blocks: {},
    evidence: EMPTY_EVIDENCE,
  });

  assert.ok(out);
  assert.match(out.summary, /safe first-line checks/i);
  assert.ok(out.troubleshooting_steps.some((item) => /power/i.test(item)));
  assert.equal(out.troubleshooting_steps.some((item) => /service mode|firmware flash|bypass/i.test(item)), false);
});

test('viewer priority answer is executive style and never includes action drafts', () => {
  const out = buildDeterministicAnswerCandidate({
    capability: 'prioritize_tasks',
    decision: 'answer',
    profile: VIEWER,
    message: 'What should I prioritize today?',
    blocks: {
      rankedOperationalQueue: [{ label: 'WO NICU-INF-002 pump downtime', score: 91 }],
      assignedWorkOrders: [{ id: 'wo-2', priority: 'high' }],
    },
    evidence: EMPTY_EVIDENCE,
  });

  assert.ok(out);
  assert.match(out.summary, /management concern/);
  assert.deepEqual(out.action_drafts, []);
});

test('usefulness guard replaces generic provider text when evidence exists', () => {
  const deterministic = buildDeterministicAnswerCandidate({
    capability: 'prioritize_tasks',
    decision: 'answer',
    profile: BME_HEAD,
    message: 'What should I prioritize today?',
    blocks: {
      rankedOperationalQueue: [{ label: 'WO OT-ANE-001 critical anesthesia fault', score: 94 }],
      evidenceUsed: ['Command Center snapshot'],
    },
    evidence: EMPTY_EVIDENCE,
  });
  assert.ok(deterministic);

  const guarded = applyResponseUsefulnessGuard({
    capability: 'prioritize_tasks',
    deterministic,
    evidenceAvailable: true,
    assistant: {
      ...deterministic,
      summary: 'You should review the dashboard and check critical equipment.',
      evidence_used: [],
      links: [],
      answer_basis: 'model_output',
      confidence: 'medium',
    },
  });

  assert.match(guarded.summary, /OT-ANE-001/);
  assert.equal(guarded.answer_basis, 'system_data');
});

test('usefulness guard replaces display-repair metadata when deterministic evidence exists', () => {
  const deterministic = buildDeterministicAnswerCandidate({
    capability: 'prioritize_tasks',
    decision: 'answer',
    profile: BME_HEAD,
    message: 'why that one first?',
    blocks: {
      rankedOperationalQueue: [{ label: 'Triage queue: Schedule diagnostic for recurring failures', score: 183.8 }],
      evidenceUsed: ['Command Center snapshot'],
    },
    evidence: EMPTY_EVIDENCE,
  });
  assert.ok(deterministic);

  const guarded = applyResponseUsefulnessGuard({
    capability: 'prioritize_tasks',
    deterministic,
    evidenceAvailable: true,
    assistant: {
      ...deterministic,
      summary: 'I cleaned up internal metadata before showing this response. Try rephrasing if the answer feels incomplete.',
      evidence_used: [],
      links: [],
      answer_basis: 'model_output',
      confidence: 'medium',
    },
  });

  assert.match(guarded.summary, /Schedule diagnostic/);
  assert.equal(guarded.answer_basis, 'system_data');
});

test('usefulness guard replaces truncated markdown provider output', () => {
  const deterministic = buildDeterministicAnswerCandidate({
    capability: 'logistics_status',
    decision: 'answer',
    profile: { profileId: 'store-1', roleNames: ['store_user'], departmentId: null },
    message: 'Which parts are blocking work?',
    blocks: {
      formalToolTrace: {
        results: [
          {
            toolName: 'read_stock_blockers',
            data: [
              {
                blocker_source: 'work_order_parts_needed',
                part_code: 'SP-MOT-SUC',
                name: 'Suction Motor Assembly',
                current_stock: 0,
                reorder_level: 2,
              },
            ],
            evidenceSignals: ['Loaded 1 declared work_order_parts_needed blocker(s).'],
            sourceTables: ['work_order_parts_needed'],
          },
        ],
      },
    },
    evidence: EMPTY_EVIDENCE,
  });
  assert.ok(deterministic);

  const guarded = applyResponseUsefulnessGuard({
    capability: 'logistics_status',
    deterministic,
    evidenceAvailable: true,
    assistant: {
      ...deterministic,
      summary: 'Based on current records: 1. **Suction Motor Assembly',
      evidence_used: [],
      links: [],
      answer_basis: 'model_output',
      confidence: 'medium',
    },
  });

  assert.match(guarded.summary, /work_order_parts_needed/);
  assert.equal(guarded.answer_basis, 'system_data');
});

test('developer diagnostic builder explains classifier metadata', () => {
  const classified: ClassifiedRequest = {
    intent: 'analytics_explanation',
    capability: 'copilot_diagnostics',
    reasons: ['Matched 1 keyword signal.'],
    troubleshootingSubtype: 'none',
    specificity: 'general',
    matchedSignals: ['copilot_diagnostics'],
    confidence: 0.93,
    confidenceLabel: 'high',
    ambiguous: false,
    candidates: [{ capability: 'copilot_diagnostics', confidence: 0.93, reasons: ['Matched classified phrasing.'] }],
  };

  const out = buildDeterministicAnswerCandidate({
    capability: 'copilot_diagnostics',
    decision: 'answer',
    profile: DEVELOPER,
    message: 'Why was my last prompt classified this way?',
    classified,
    blocks: {},
    evidence: EMPTY_EVIDENCE,
  });

  assert.ok(out);
  assert.match(out.summary, /copilot_diagnostics/);
  assert.ok(out.key_findings.some((item) => item.includes('Classifier confidence')));
  assert.ok(out.routing_explanation?.some((item) => item.includes('Top candidates')));
});
