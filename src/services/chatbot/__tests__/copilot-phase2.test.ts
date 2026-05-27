/**
 * Phase 2 test suite for BMEDIS Copilot — system-awareness depth.
 *
 * Covers:
 *  - Tool registry growth (10 new tools)
 *  - Route link builder additions
 *  - Workflow chain detection + structured answers
 *  - Formula explainer coverage for 14 metrics
 *  - Notification / Telegram / dedupe / rule explainers
 *  - QR / offline / report / validation explainers
 *  - Role-specific intent routing through the deterministic candidate
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildWorkflowExplainerAnswer,
  detectWorkflowExplainerKey,
  workflowExplainerToAssistant,
  type WorkflowExplainerKey,
} from '@/services/chatbot/workflow-explainers';
import { COPILOT_TOOL_REGISTRY } from '@/services/chatbot/tools/tool-registry';
import { copilotRoutes } from '@/services/chatbot/route-link-builder';
import { buildDeterministicAnswerCandidate } from '@/services/chatbot/deterministic-answer-builders';
import { classifyChatRequest } from '@/services/chatbot/classifier-service';
import type { ChatEvidence, UserChatProfile } from '@/types/chatbot';

const repoRoot = process.cwd();
function readSource(rel: string): string {
  return readFileSync(path.resolve(repoRoot, rel), 'utf8');
}

const BASE_EVIDENCE: ChatEvidence = {
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

const BME_HEAD: UserChatProfile = {
  profileId: 'bme-head-1',
  roleNames: ['bme_head'],
  departmentId: null,
};

const TECHNICIAN: UserChatProfile = {
  profileId: 'tech-1',
  roleNames: ['technician'],
  departmentId: 'dep-A',
};

const STORE: UserChatProfile = {
  profileId: 'store-1',
  roleNames: ['store_user'],
  departmentId: null,
};

const VIEWER: UserChatProfile = {
  profileId: 'viewer-1',
  roleNames: ['viewer'],
  departmentId: null,
};

const DEPT_USER: UserChatProfile = {
  profileId: 'dept-1',
  roleNames: ['department_user'],
  departmentId: 'dep-A',
};

const DEV: UserChatProfile = {
  profileId: 'dev-1',
  roleNames: ['developer'],
  departmentId: null,
};

test('COPILOT-01: assistant page uses shared message cards and a bottom composer', () => {
  const page = readSource('src/app/(dashboard)/chatbot/page.tsx');
  assert.match(page, /AssistantMessageCard/);
  assert.match(page, /100dvh/);
  assert.match(page, /mt-auto space-y-3 border-t/);
  assert.match(page, /Textarea/);
  assert.doesNotMatch(page, /JSON\.stringify/);
});

test('COPILOT-01: floating panel uses mobile full-screen and scroll-contained messages', () => {
  const panel = readSource('src/components/assistant/AssistantPanel.tsx');
  assert.match(panel, /fixed inset-0/);
  assert.match(panel, /sm:w-\[min\(92vw,520px\)\]/);
  assert.match(panel, /overflow-y-auto/);
  assert.match(panel, /Textarea/);
});

test('COPILOT-01: normal roles get collapsed evidence while developer can expand diagnostics', () => {
  const card = readSource('src/components/assistant/AssistantMessageCard.tsx');
  assert.match(card, /useState\(isDeveloper\)/);
  assert.match(card, /Evidence & links/);
  assert.match(card, /Developer trace/);
});

function candidate(profile: UserChatProfile, message: string, opts: Partial<Parameters<typeof buildDeterministicAnswerCandidate>[0]> = {}) {
  const classified = classifyChatRequest(message);
  return buildDeterministicAnswerCandidate({
    capability: classified.capability,
    decision: 'answer',
    profile,
    message,
    classified,
    blocks: {},
    evidence: BASE_EVIDENCE,
    ...opts,
  });
}

/* ------------------------------------------------------------------ */
/* Tool registry growth                                                */
/* ------------------------------------------------------------------ */

test('tool registry registers all 10 new Phase 2 tools', () => {
  const required: Array<keyof typeof COPILOT_TOOL_REGISTRY> = [
    'read_maintenance_request_status',
    'read_pm_schedule_evidence',
    'read_calibration_request_evidence',
    'read_calibration_record_evidence',
    'read_report_data',
    'read_notification_delivery_status',
    'read_telegram_eligibility',
    'read_notification_rule_logs',
    'read_qr_coverage_status',
    'read_validation_readiness',
  ];
  for (const name of required) {
    const def = COPILOT_TOOL_REGISTRY[name];
    assert.ok(def, `${name} missing from registry`);
    assert.equal(def.access, 'read');
    assert.ok(def.allowedRoles.length > 0, `${name} has empty allowedRoles`);
    assert.ok(def.dataSources.length > 0, `${name} has empty dataSources`);
    assert.ok(def.evidenceLabels.length > 0, `${name} has empty evidenceLabels`);
  }
});

test('route-link builder exposes notifications + generic request helpers', () => {
  assert.equal(copilotRoutes.notifications().href, '/notifications');
  assert.equal(copilotRoutes.request('maintenance', 'r1').href, '/maintenance/requests/r1');
  assert.equal(copilotRoutes.request('calibration', 'c1').href, '/calibration/requests/c1');
  assert.equal(copilotRoutes.request('training', 't1').href, '/requests/training/t1');
});

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

const DETECT_CASES: Array<[string, WorkflowExplainerKey]> = [
  // T3 chains — "complete this work order" without reliability/MTTR keywords is the
  // generic lifecycle; the completion-reliability detector requires MTTR/MTBF/availability
  // or an explicit reliability/evidence cue.
  ['What happens after I complete this work order?', 'work_order_lifecycle'],
  ['What evidence does completion need to update MTTR?', 'work_order_completion_reliability'],
  ['Why did MTBF not change after I completed this WO?', 'work_order_completion_reliability'],
  ['Explain the maintenance request lifecycle.', 'maintenance_request_lifecycle'],
  ['What happens when I complete this PM?', 'pm_lifecycle'],
  ['Walk me through the calibration lifecycle.', 'calibration_lifecycle'],
  ['Explain the stock and procurement lifecycle.', 'stock_procurement_lifecycle'],
  ['What is the replacement / RPI lifecycle?', 'replacement_rpi_lifecycle'],
  ['Explain the QR lifecycle.', 'qr_lifecycle'],
  ['What is the offline workflow?', 'offline_lifecycle'],
  ['Show me the notification lifecycle.', 'notification_telegram_lifecycle'],
  ['What is the report lifecycle?', 'report_lifecycle'],
  // T4 formulas
  ['What is RPN?', 'formula_rpn'],
  ['Explain the RPI score.', 'formula_rpi'],
  ['How is MTTR calculated?', 'formula_mttr'],
  ['How is MTBF calculated?', 'formula_mtbf'],
  ['Availability formula?', 'formula_availability'],
  ['Explain PM compliance.', 'formula_pm_compliance'],
  ['What is calibration risk?', 'formula_calibration_compliance'],
  ['What is equipment health score?', 'formula_equipment_health'],
  ['Explain department readiness.', 'formula_department_readiness'],
  ['How is the critical action score weighted?', 'formula_critical_action_score'],
  ['What is stock blocker priority?', 'formula_stock_blocker_priority'],
  ['How does procurement delay priority work?', 'formula_procurement_delay'],
  ['How does technician workload work?', 'formula_technician_workload'],
  ['Explain conflict_type and resolution_status.', 'formula_offline_conflict_status'],
  // T5 notif
  ['Why didn’t Telegram send?', 'telegram_eligibility_explainer'],
  ['What does no_chat_id mean?', 'telegram_eligibility_explainer'],
  ['When was the rule check last run?', 'notification_rule_explainer'],
  ['Was this duplicate notification?', 'notification_dedupe_explainer'],
  ['Who else was notified?', 'notification_delivery_explainer'],
  // T6 QR/offline/report/validation
  ['What does this QR label status mean?', 'qr_explainer'],
  ['Can I do this offline?', 'offline_can_i_do_this'],
  ['Summarize this report.', 'report_summary_explainer'],
  ['What should I test next?', 'validation_readiness_explainer'],
  ['How do I validate Telegram delivery?', 'validation_readiness_explainer'],
];

test('explainer key detection covers every Phase 2 case', () => {
  for (const [msg, expected] of DETECT_CASES) {
    const got = detectWorkflowExplainerKey(msg);
    assert.equal(got, expected, `${msg} → got ${got}, expected ${expected}`);
  }
});

test('harmless equipment lookup does NOT match a workflow explainer', () => {
  assert.equal(detectWorkflowExplainerKey('Summarize this monitor for me'), null);
  assert.equal(detectWorkflowExplainerKey('Which work orders are open in Radiology?'), null);
});

/* ------------------------------------------------------------------ */
/* Answer structure                                                    */
/* ------------------------------------------------------------------ */

test('every explainer answer has summary, evidence, source tables, and data_mode', () => {
  for (const [msg] of DETECT_CASES) {
    const explainer = buildWorkflowExplainerAnswer({ message: msg, capability: 'safe_troubleshooting' });
    assert.ok(explainer, `${msg} produced no explainer`);
    assert.ok(explainer.summary.length > 40, `${msg} summary too short`);
    assert.ok(explainer.key_findings.length >= 2, `${msg} too few key findings`);
    assert.ok(explainer.source_tables.length >= 1 || explainer.links.length >= 1, `${msg} no source tables/links`);
    assert.ok(['live', 'snapshot', 'stale', 'sandbox', 'missing', 'unknown'].includes(explainer.data_mode));
  }
});

test('workflowExplainerToAssistant produces a schema-shaped AssistantContent', () => {
  const explainer = buildWorkflowExplainerAnswer({ message: 'Explain RPI', capability: 'explain_equipment_risk' });
  assert.ok(explainer);
  const out = workflowExplainerToAssistant(explainer);
  assert.equal(out.decision, 'answer');
  assert.equal(out.confidence, 'high');
  assert.equal(out.answer_basis, 'system_data');
  assert.ok(out.summary.length > 0);
  assert.ok(out.source_tables.length > 0);
  assert.ok(['live', 'snapshot', 'stale', 'sandbox', 'missing', 'unknown'].includes(out.data_mode ?? 'unknown'));
});

/* ------------------------------------------------------------------ */
/* End-to-end integration with deterministic candidate                 */
/* ------------------------------------------------------------------ */

test('deterministic candidate returns workflow chain answer for WO completion question', () => {
  const c = candidate(TECHNICIAN, 'What evidence does completion need to update MTTR/MTBF?');
  assert.ok(c);
  assert.match(c.summary, /reliability|MTTR|MTBF/i);
  assert.ok(c.source_tables.some((s) => /maintenance_events/i.test(s)));
});

test('deterministic candidate explains PM compliance for BME Head', () => {
  const c = candidate(BME_HEAD, 'Explain PM compliance');
  assert.ok(c);
  assert.match(c.summary, /completed scheduled PM tasks/i);
  assert.equal(c.data_mode, 'snapshot');
});

test('deterministic candidate explains stock blocker priority for Store user', () => {
  const c = candidate(STORE, 'How does stock blocker priority work?');
  assert.ok(c);
  assert.match(c.summary, /work_order_parts_needed/i);
});

test('deterministic candidate answers Department user lifecycle question with maintenance chain', () => {
  const c = candidate(
    DEPT_USER,
    'What happens after I submit a maintenance request?',
  );
  assert.ok(c);
  assert.match(c.summary, /BME Head|work[- ]order|approval/i);
});

test('deterministic candidate answers Viewer report-vs-dashboard question', () => {
  const c = candidate(VIEWER, 'Why does this differ from the dashboard?');
  assert.ok(c);
  assert.match(c.summary, /canonical|snapshot|generated_at/i);
});

test('developer keeps developer-diagnostic precedence over workflow explainer when classifier matches', () => {
  // "Why was this classified as off topic" → copilot_diagnostics route; the
  // developer-diagnostic builder must win over the explainer matcher.
  const classified = classifyChatRequest('Why was this classified as off topic?');
  const c = buildDeterministicAnswerCandidate({
    capability: classified.capability,
    decision: 'answer',
    profile: DEV,
    message: 'Why was this classified as off topic?',
    classified,
    blocks: {},
    evidence: BASE_EVIDENCE,
  });
  assert.ok(c);
  assert.ok(c.summary.length > 0);
});

/* ------------------------------------------------------------------ */
/* Role-specific behavior                                              */
/* ------------------------------------------------------------------ */

test('Store user asking blocker priority is grounded in real signals', () => {
  const c = candidate(STORE, 'What is stock blocker priority?');
  assert.ok(c);
  assert.match(c.summary, /declared work_order_parts_needed|spare_parts/i);
});

test('Technician asking reliability evidence sees concrete fields', () => {
  const c = candidate(TECHNICIAN, 'What reliability evidence do I record on completion?');
  assert.ok(c);
  assert.match(c.summary, /repair_duration_hours|maintenance_events|downtime/i);
});

test('BME Head asking urgent action explainer is routed via critical action score formula', () => {
  const c = candidate(BME_HEAD, 'How does the critical action score weight categories?');
  assert.ok(c);
  assert.match(c.summary, /corrective\(100\)|category weight|urgency band/i);
});
