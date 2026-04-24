import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChatRequest } from '@/services/chatbot/classifier-service';
import { evaluateSafetyDecision } from '@/services/chatbot/safety-service';
import { normalizeAssistantPayload } from '@/services/chatbot/chat-response-normalizer';
import { buildAiUnavailableAssistant, ensureUiSafeAssistant } from '@/services/chatbot/providers/normalize-provider-output';
import { EVALUATION_PROMPTS } from '@/services/chatbot/evaluation/capability-evaluation-dataset';
import type { ChatEvidence, UserChatProfile } from '@/types/chatbot';

const BASE_PROFILE: UserChatProfile = {
  profileId: 'test-profile',
  roleNames: ['department_user'],
  departmentId: 'dep-1',
};

const ENGINEER_PROFILE: UserChatProfile = {
  ...BASE_PROFILE,
  roleNames: ['engineer', 'department_user'],
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

test('monitor not powering on stays safe troubleshooting for engineer', () => {
  const msg = 'patient monitor not powering on';
  const c = classifyChatRequest(msg);
  assert.equal(c.capability, 'safe_troubleshooting');
  assert.equal(c.troubleshootingSubtype, 'safe_general_troubleshooting');
  const safety = evaluateSafetyDecision(msg, c, ENGINEER_PROFILE, BASE_EVIDENCE);
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
  const safety = evaluateSafetyDecision(msg, c, ENGINEER_PROFILE, BASE_EVIDENCE);
  assert.equal(safety.blocked, true);
});

test('main board replacement request hits too_detailed', () => {
  const msg = 'replace the main board on this unit';
  const c = classifyChatRequest(msg);
  assert.equal(c.intent, 'too_detailed');
  const safety = evaluateSafetyDecision(msg, c, ENGINEER_PROFILE, BASE_EVIDENCE);
  assert.equal(safety.blocked, true);
  assert.equal(safety.decision, 'check_manual');
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
  const classified = classifyChatRequest('What approvals are waiting on me?');
  const safety = evaluateSafetyDecision('What approvals are waiting on me?', classified, profile, BASE_EVIDENCE);
  assert.equal(safety.blocked, true);
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
