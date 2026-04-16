import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChatRequest } from '@/services/chatbot/classifier-service';
import { evaluateSafetyDecision } from '@/services/chatbot/safety-service';
import { normalizeAssistantPayload } from '@/services/chatbot/chat-response-normalizer';
import { EVALUATION_PROMPTS } from '@/services/chatbot/evaluation/capability-evaluation-dataset';
import type { ChatEvidence, UserChatProfile } from '@/types/chatbot';

const BASE_PROFILE: UserChatProfile = {
  profileId: 'test-profile',
  roleNames: ['department_user'],
  departmentId: 'dep-1',
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
  evidenceSignals: [],
  deniedContextRefs: [],
  accessDenied: false,
};

test('classifier maps paraphrases to my_tasks capability', () => {
  const classified = classifyChatRequest('What is on my to-do list?');
  assert.equal(classified.capability, 'my_tasks');
  assert.notEqual(classified.confidenceLabel, 'low');
});

test('classifier routes unknown phrasing to general fallback', () => {
  const classified = classifyChatRequest('Can you help with that thing from earlier?');
  assert.equal(classified.capability, 'general_fallback');
});

test('safety keeps unknown queries useful with limited answer', () => {
  const classified = classifyChatRequest('I need help but not sure with what exactly.');
  const safety = evaluateSafetyDecision('I need help but not sure with what exactly.', classified, BASE_PROFILE, BASE_EVIDENCE);
  assert.equal(safety.decision, 'limited_answer');
  assert.equal(safety.blocked, false);
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
