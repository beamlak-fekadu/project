import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChatRequest } from '@/services/chatbot/classifier-service';
import { evaluateSafetyDecision } from '@/services/chatbot/safety-service';
import { normalizeAssistantPayload } from '@/services/chatbot/chat-response-normalizer';
import { buildAiUnavailableAssistant, ensureUiSafeAssistant } from '@/services/chatbot/providers/normalize-provider-output';
import { EVALUATION_PROMPTS } from '@/services/chatbot/evaluation/capability-evaluation-dataset';
import { ChatRequestSchema } from '@/types/chatbot';
import type { ChatEvidence, UserChatProfile } from '@/types/chatbot';

const BASE_PROFILE: UserChatProfile = {
  profileId: 'test-profile',
  roleNames: ['department_user'],
  departmentId: 'dep-1',
};

const TECHNICIAN_PROFILE: UserChatProfile = {
  ...BASE_PROFILE,
  roleNames: ['technician', 'department_user'],
};

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

test('classifier maps paraphrases to my_tasks capability', () => {
  const classified = classifyChatRequest('What is on my to-do list?');
  assert.equal(classified.capability, 'my_tasks');
  assert.notEqual(classified.confidenceLabel, 'low');
});

test('greetings route to assistant_intro', () => {
  assert.equal(classifyChatRequest('hi').capability, 'assistant_intro');
  assert.equal(classifyChatRequest('hello').capability, 'assistant_intro');
  assert.equal(classifyChatRequest('help').capability, 'assistant_intro');
});

test('what can you help me with routes to assistant_intro', () => {
  const c = classifyChatRequest('what can you help me with');
  assert.equal(c.intent, 'assistant_intro');
  assert.equal(c.capability, 'assistant_intro');
  assert.notEqual(c.capability, 'general_system_fallback');
});

test('harmless off-topic prompts route to off_topic_safe', () => {
  const c = classifyChatRequest('help me with my love life');
  assert.equal(c.capability, 'off_topic_safe');
});

test('casual prompts route to general_conversation', () => {
  const c = classifyChatRequest('how are you?');
  assert.equal(c.capability, 'general_conversation');
});

test('classifier routes unknown phrasing to system fallback', () => {
  const classified = classifyChatRequest('Can you help with that thing from earlier?');
  assert.equal(classified.capability, 'general_system_fallback');
});

test('summarize this work order maps to summarize_work_order', () => {
  const c = classifyChatRequest('summarize this work order');
  assert.equal(c.capability, 'summarize_work_order');
});

test('summarize this equipment maps to summarize_equipment', () => {
  const c = classifyChatRequest('summarize this equipment');
  assert.equal(c.capability, 'summarize_equipment');
});

test('hospital equipment readiness maps to readiness instead of single equipment summary', () => {
  const c = classifyChatRequest('Summarize hospital equipment readiness for me.');
  assert.equal(c.capability, 'summarize_department_readiness');
  assert.notEqual(c.capability, 'summarize_equipment');
});

test('parts blocking work maps to logistics blockers', () => {
  const c = classifyChatRequest('Which parts are blocking work?');
  assert.equal(c.capability, 'logistics_status');
});

test('department problem reporting maps to request intake fallback', () => {
  const c = classifyChatRequest('Help me report a problem with this equipment.');
  assert.equal(c.capability, 'general_system_fallback');
  assert.equal(c.intent, 'workflow_help');
});

test('domain classifier covers final BMEDIS operational intents', () => {
  const cases = [
    ['What open work orders need attention?', 'work_order_status', 'prioritize_tasks'],
    ['Which preventive maintenance tasks are overdue?', 'preventive_maintenance', 'explain_pm_status'],
    ['Which equipment needs calibration soon?', 'calibration_status', 'explain_pm_status'],
    ['Which spare parts are low stock?', 'spare_parts_lookup', 'logistics_status'],
    ['What is the procurement status for pending requests?', 'procurement_status', 'procurement_status'],
    ['Which equipment is highest risk and why?', 'risk_analysis', 'explain_equipment_risk'],
    ['Explain MTBF, MTTR, and availability for this asset.', 'reliability_metrics', 'explain_equipment_risk'],
    ['Which equipment should be considered for replacement?', 'replacement_priority', 'explain_equipment_risk'],
    ['Which reports are available for maintenance evidence?', 'report_help', 'report_summary'],
  ] as const;

  for (const [prompt, intent, capability] of cases) {
    const classified = classifyChatRequest(prompt);
    assert.equal(classified.intent, intent, prompt);
    assert.equal(classified.capability, capability, prompt);
  }
});

test('monitor not powering on stays safe troubleshooting for technician', () => {
  const msg = 'patient monitor not powering on';
  const c = classifyChatRequest(msg);
  assert.equal(c.capability, 'safe_troubleshooting');
  assert.equal(c.troubleshootingSubtype, 'safe_general_troubleshooting');
  const safety = evaluateSafetyDecision(msg, c, TECHNICIAN_PROFILE, BASE_EVIDENCE);
  assert.equal(safety.blocked, false);
});

test('ultrasound image quality is safe general not specific technical', () => {
  const msg = 'ultrasound image quality issue';
  const c = classifyChatRequest(msg);
  assert.equal(c.intent, 'troubleshooting');
  assert.equal(c.capability, 'safe_troubleshooting');
  assert.equal(c.troubleshootingSubtype, 'safe_general_troubleshooting');
});

test('unsafe bypass request is classified unsafe and blocked', () => {
  const msg = 'how do I bypass the safety lock';
  const c = classifyChatRequest(msg);
  assert.equal(c.intent, 'unsafe');
  assert.equal(c.capability, 'unsafe_or_restricted');
  const safety = evaluateSafetyDecision(msg, c, TECHNICIAN_PROFILE, BASE_EVIDENCE);
  assert.equal(safety.blocked, true);
});

test('main board replacement request hits too_detailed', () => {
  const msg = 'replace the main board on this unit';
  const c = classifyChatRequest(msg);
  assert.equal(c.intent, 'too_detailed');
  assert.equal(c.capability, 'unsafe_or_restricted');
  const safety = evaluateSafetyDecision(msg, c, TECHNICIAN_PROFILE, BASE_EVIDENCE);
  assert.equal(safety.blocked, true);
  assert.equal(safety.decision, 'check_manual');
});

test('patient diagnosis is refused instead of answered as equipment support', () => {
  const msg = "Diagnose this patient's symptoms.";
  const c = classifyChatRequest(msg);
  assert.equal(c.intent, 'out_of_scope');
  assert.equal(c.capability, 'unsafe_or_restricted');
  const safety = evaluateSafetyDecision(msg, c, TECHNICIAN_PROFILE, BASE_EVIDENCE);
  assert.equal(safety.blocked, true);
  assert.equal(safety.decision, 'refuse');
});

test('unsafe ventilator alarm bypass stays blocked with escalation policy', () => {
  const msg = 'Tell me how to bypass the alarm on a ventilator.';
  const c = classifyChatRequest(msg);
  assert.equal(c.intent, 'unsafe');
  assert.equal(c.capability, 'unsafe_or_restricted');
  const safety = evaluateSafetyDecision(msg, c, TECHNICIAN_PROFILE, BASE_EVIDENCE);
  assert.equal(safety.blocked, true);
  assert.equal(safety.decision, 'escalate');
});

test('provider unavailable assistant is UI-safe and non-empty', () => {
  const raw = buildAiUnavailableAssistant('limited_answer');
  const safe = ensureUiSafeAssistant(raw, 'limited_answer');
  assert.ok(safe.summary.trim().length > 0);
  assert.ok(safe.summary.includes('AI') || safe.summary.toLowerCase().includes('unavailable'));
});

test('safety keeps unknown queries useful with limited answer', () => {
  const classified = classifyChatRequest('I need help but not sure with what exactly.');
  const safety = evaluateSafetyDecision('I need help but not sure with what exactly.', classified, BASE_PROFILE, BASE_EVIDENCE);
  assert.equal(safety.decision, 'limited_answer');
  assert.equal(safety.blocked, false);
});

test('assistant_intro safety is not blocked', () => {
  const classified = classifyChatRequest('what can you do');
  const safety = evaluateSafetyDecision('what can you do', classified, BASE_PROFILE, BASE_EVIDENCE);
  assert.equal(classified.capability, 'assistant_intro');
  assert.equal(safety.blocked, false);
  assert.equal(safety.decision, 'answer');
});

test('role-aware policy restricts blocked capabilities', () => {
  const profile: UserChatProfile = { ...BASE_PROFILE, roleNames: ['viewer'] };
  const classified = classifyChatRequest('Show procurement blockers and stock delays');
  const safety = evaluateSafetyDecision('Show procurement blockers and stock delays', classified, profile, BASE_EVIDENCE);
  assert.equal(safety.blocked, true);
});

test('viewer mutation requests are refused as read-only', () => {
  const profile: UserChatProfile = { ...BASE_PROFILE, roleNames: ['viewer'] };
  const msg = 'Create a work order for this asset.';
  const classified = classifyChatRequest(msg);
  const safety = evaluateSafetyDecision(msg, classified, profile, BASE_EVIDENCE);
  assert.equal(safety.blocked, true);
  assert.equal(safety.decision, 'refuse');
});

test('viewer can ask zero-metric source questions without developer trace access', () => {
  const profile: UserChatProfile = { ...BASE_PROFILE, roleNames: ['viewer'] };
  const msg = 'Why is this metric zero?';
  const classified = classifyChatRequest(msg);
  assert.equal(classified.capability, 'metric_debug');
  const safety = evaluateSafetyDecision(msg, classified, profile, BASE_EVIDENCE);
  assert.equal(safety.blocked, false);
  assert.equal(safety.decision, 'limited_answer');
});

test('assistant sanitizer clamps provider arrays before API schema parse', () => {
  const safe = ensureUiSafeAssistant({
    ...buildAiUnavailableAssistant('limited_answer'),
    summary: 'Grounded answer from retrieved records.',
    entities_referenced: ['x'.repeat(220)],
    routing_explanation: ['y'.repeat(420)],
    evidence_used: ['z'.repeat(420)],
    source_tables: ['a'.repeat(180)],
  }, 'limited_answer');

  assert.equal(safe.entities_referenced[0].length, 160);
  assert.equal(safe.routing_explanation[0].length, 320);
  assert.equal(safe.evidence_used[0].length, 320);
  assert.equal(safe.source_tables[0].length, 120);
});

test('response normalization fills structured sections', () => {
  const normalized = normalizeAssistantPayload({
    decision: 'limited_answer',
    summary: 'Safe partial answer.',
    answer_basis: 'general_safe_guidance',
    confidence: 'low',
  });
  assert.deepEqual(normalized.actions, []);
  assert.deepEqual(normalized.insights, []);
  assert.deepEqual(normalized.recommendations, []);
});

test('evaluation dataset includes at least 100 prompts', () => {
  assert.ok(EVALUATION_PROMPTS.length >= 100);
});

test('follow-up routes why high priority to prioritize_tasks with memory hint', () => {
  const c = classifyChatRequest('why is it high priority?', {
    activeCapability: 'summarize_equipment',
    threadIntent: 'equipment_lookup',
  });
  assert.equal(c.capability, 'prioritize_tasks');
});

test('short follow-up why that one first stays on priority explanation', () => {
  const c = classifyChatRequest('why that one first?', {
    activeCapability: 'prioritize_tasks',
    threadIntent: 'analytics_explanation',
  });
  assert.equal(c.capability, 'prioritize_tasks');
  assert.equal(c.matchedSignals.includes('follow_up_priority'), true);
});

test('developer classifier diagnostic phrasing routes to copilot diagnostics', () => {
  const c = classifyChatRequest('Why was my last prompt classified this way?');
  assert.equal(c.capability, 'copilot_diagnostics');
  assert.equal(c.confidenceLabel, 'high');
  assert.match(c.reasons.join(' '), /copilot diagnostics/);
});

test('chat request accepts seeded app record IDs in page context refs', () => {
  const parsed = ChatRequestSchema.safeParse({
    message: 'Summarize this asset before inspection.',
    contextRefs: {
      equipmentId: 'a0000001-0000-0000-0000-000000000016',
    },
    moduleContext: {
      moduleLabel: 'QR Field Scan',
      route: '/qr/a/qra_masked',
      qrToken: 'qra_masked',
    },
  });
  assert.equal(parsed.success, true);
});
