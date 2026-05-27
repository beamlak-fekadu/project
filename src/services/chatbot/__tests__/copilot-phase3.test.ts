/**
 * Phase 3 test suite — follow-up memory, role tone, raw-output guard.
 *
 * Browser-level UI testing is intentionally out of scope (see
 * documents/copilot-manual-validation-checklist.md). These tests exercise
 * the deterministic logic that *backs* the browser experience:
 *
 *  - detectFollowUpKind() classifies short pronoun-y prompts.
 *  - handleFollowUp() returns structured answers that anchor on memory.
 *  - buildDeterministicAnswerCandidate() routes follow-ups before workflow
 *    explainers when memory is present.
 *  - displayableAssistantSummary() strips [object Object] and bare tokens.
 *  - Role tone policy carries the new `tone` field per role.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectFollowUpKind,
  handleFollowUp,
  type FollowUpKind,
  type FollowUpMemoryContext,
} from '@/services/chatbot/follow-up-handlers';
import { buildDeterministicAnswerCandidate } from '@/services/chatbot/deterministic-answer-builders';
import { classifyChatRequest } from '@/services/chatbot/classifier-service';
import { displayableAssistantSummary } from '@/components/assistant/assistant-ui-display';
import { buildCopilotRolePromptPolicy } from '@/services/chatbot/role-prompt-policy';
import type { ChatEvidence, UserChatProfile } from '@/types/chatbot';

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

const VIEWER: UserChatProfile = {
  profileId: 'viewer-1',
  roleNames: ['viewer'],
  departmentId: null,
};

/* ------------------------------------------------------------------ */
/* Detection                                                          */
/* ------------------------------------------------------------------ */

const DETECT_CASES: Array<[string, FollowUpKind]> = [
  ['Why?', 'why'],
  ['why', 'why'],
  ['Why that one?', 'why_that_one'],
  ['Why this one first?', 'why_that_one'],
  ['Explain simply.', 'explain_simply'],
  ['Say this in plain English.', 'explain_simply'],
  ['Where did you get that?', 'where_did_you_get_that'],
  ['What table is this from?', 'where_did_you_get_that'],
  ['What if I ignore it?', 'what_if_i_ignore_it'],
  ['What happens if we do nothing?', 'what_if_i_ignore_it'],
  ['Is that safe?', 'is_that_safe'],
  ['Is it safe to continue?', 'is_that_safe'],
  ['What happens next?', 'what_happens_next'],
  ['What happens after I submit?', 'what_happens_next'],
  ['Can you draft it?', 'can_you_draft_it'],
  ['What should I do next?', 'next_step'],
];

test('detectFollowUpKind classifies short follow-ups correctly', () => {
  for (const [prompt, expected] of DETECT_CASES) {
    const got = detectFollowUpKind(prompt);
    assert.equal(got, expected, `${prompt} → got ${got}, expected ${expected}`);
  }
});

test('detectFollowUpKind ignores long, non-follow-up prompts', () => {
  assert.equal(
    detectFollowUpKind('Which work orders are most urgent across the hospital right now and why?'),
    null,
  );
  assert.equal(
    detectFollowUpKind('Summarize hospital readiness for the management briefing tomorrow.'),
    null,
  );
});

/* ------------------------------------------------------------------ */
/* Handler outputs                                                    */
/* ------------------------------------------------------------------ */

const MEMORY: FollowUpMemoryContext = {
  shortSummary: 'BME Head asked for most urgent action. Answer: WO-001234 in Radiology is highest critical action.',
  activeCapability: 'prioritize_tasks',
  lastEntityLabels: ['WO-001234', 'Radiology'],
  lastTitle: 'Most urgent action',
  lastSummary: 'WO-001234 is the highest critical action because it is corrective + critical urgency.',
  lastEvidenceUsed: ['work_orders: WO-001234 open', 'critical_action_score: 195'],
  lastSourceTables: ['work_orders', 'command-center-data'],
  lastDataMode: 'live',
  lastDataFreshness: 'Live from current BMEDIS records.',
};

test('handleFollowUp("why") returns priority reasoning anchored on memory', () => {
  const r = handleFollowUp({ message: 'Why?', profile: BME_HEAD, memory: MEMORY });
  assert.ok(r);
  assert.equal(r.kind, 'why');
  assert.match(r.answer.title ?? '', /Most urgent action/);
  assert.ok(r.answer.priority_reasoning.length > 0);
  assert.equal(r.answer.source_tables[0], 'work_orders');
});

test('handleFollowUp("explain simply") strips jargon into manager-friendly words', () => {
  const r = handleFollowUp({
    message: 'Explain simply.',
    profile: VIEWER,
    memory: {
      ...MEMORY,
      lastSummary: 'The asset has high RPN and MTBF is short due to MTTR spikes — FMEA flags it.',
    },
  });
  assert.ok(r);
  assert.match(r.answer.summary, /risk priority number|time between failures|time to repair|failure analysis/i);
  assert.doesNotMatch(r.answer.summary, /\bRPN\b/);
});

test('handleFollowUp("where did you get that") cites source tables and evidence', () => {
  const r = handleFollowUp({ message: 'Where did you get that?', profile: BME_HEAD, memory: MEMORY });
  assert.ok(r);
  assert.match(r.answer.summary, /work_orders/);
  assert.match(r.answer.summary, /WO-001234|critical_action_score/);
});

test('handleFollowUp("where did you get that") honestly degrades without source tables', () => {
  const r = handleFollowUp({
    message: 'Where did you get that?',
    profile: BME_HEAD,
    memory: { ...MEMORY, lastSourceTables: [], lastEvidenceUsed: [] },
  });
  assert.ok(r);
  assert.match(r.answer.summary, /did not retrieve fresh BMEDIS evidence|open the relevant record/i);
});

test('handleFollowUp("what if I ignore it") produces capability-aware consequences', () => {
  const r = handleFollowUp({ message: 'What if I ignore it?', profile: BME_HEAD, memory: MEMORY });
  assert.ok(r);
  assert.ok(r.answer.key_findings.length >= 2);
  assert.match(r.answer.summary, /downstream consequences|workflow type/i);
});

test('handleFollowUp("is that safe?") leads with safety + escalate', () => {
  const r = handleFollowUp({ message: 'Is that safe?', profile: TECHNICIAN, memory: MEMORY });
  assert.ok(r);
  assert.ok(r.answer.troubleshooting_steps.length >= 3);
  assert.match(r.answer.summary, /patient and operator|remove the equipment from clinical use/i);
});

test('handleFollowUp("can you draft it?") refuses for Viewer with alternative', () => {
  const r = handleFollowUp({ message: 'Can you draft it?', profile: VIEWER });
  assert.ok(r);
  assert.equal(r.answer.decision, 'refuse');
  assert.match(r.answer.title ?? '', /read-only/i);
  assert.match(r.answer.summary, /cannot create or update|read-only/i);
  assert.ok(r.answer.recommended_actions.length >= 1);
});

test('handleFollowUp("can you draft it?") prompts for record context for mutating roles', () => {
  const r = handleFollowUp({ message: 'Can you draft it?', profile: BME_HEAD });
  assert.ok(r);
  assert.equal(r.answer.decision, 'answer');
  assert.match(r.answer.summary, /which kind of record/i);
});

test('handleFollowUp degrades to clarification when no memory is present', () => {
  const r = handleFollowUp({ message: 'Why?', profile: BME_HEAD, memory: undefined });
  assert.ok(r);
  assert.equal(r.needsClarification, true);
  assert.equal(r.answer.answer_basis, 'insufficient_data');
});

/* ------------------------------------------------------------------ */
/* Orchestrator integration                                           */
/* ------------------------------------------------------------------ */

test('buildDeterministicAnswerCandidate threads follow-up memory and answers "Why?"', () => {
  const classified = classifyChatRequest('Why?');
  const c = buildDeterministicAnswerCandidate({
    capability: classified.capability,
    decision: 'answer',
    profile: BME_HEAD,
    message: 'Why?',
    classified,
    blocks: {},
    evidence: BASE_EVIDENCE,
    followUpMemory: MEMORY,
  });
  assert.ok(c, 'should return a follow-up answer');
  assert.match(c.title ?? '', /Most urgent action|Why/);
});

test('Follow-up handler routes BEFORE workflow explainer for "explain simply"', () => {
  const classified = classifyChatRequest('Explain simply.');
  const c = buildDeterministicAnswerCandidate({
    capability: classified.capability,
    decision: 'answer',
    profile: BME_HEAD,
    message: 'Explain simply.',
    classified,
    blocks: {},
    evidence: BASE_EVIDENCE,
    followUpMemory: { ...MEMORY, lastSummary: 'MTBF is short due to MTTR.' },
  });
  assert.ok(c);
  assert.match(c.summary, /time between failures|time to repair/i);
});

/* ------------------------------------------------------------------ */
/* Raw-output guard (UI side)                                          */
/* ------------------------------------------------------------------ */

test('displayableAssistantSummary strips [object Object]', () => {
  const cleaned = displayableAssistantSummary('A useful answer [object Object] continues.');
  assert.equal(cleaned.includes('[object Object]'), false);
});

test('displayableAssistantSummary returns repair text for raw JSON-looking summary', () => {
  const repair = displayableAssistantSummary('{"summary":"raw json","decision":"answer"}');
  assert.match(repair, /could not finish formatting|open the relevant page/i);
});

test('displayableAssistantSummary returns empty fallback when nothing remains after sanitization', () => {
  const repair = displayableAssistantSummary('[object Object] [object Object]');
  assert.match(repair, /do not have enough context|open the asset/i);
});

test('displayableAssistantSummary preserves a normal answer untouched', () => {
  const out = displayableAssistantSummary('WO-001234 is the highest critical action.');
  assert.equal(out, 'WO-001234 is the highest critical action.');
});

/* ------------------------------------------------------------------ */
/* Role tone                                                          */
/* ------------------------------------------------------------------ */

test('role-prompt-policy carries a tone field for every role', () => {
  for (const role of ['developer', 'bme_head', 'technician', 'store_user', 'department_head', 'department_user', 'viewer'] as const) {
    const policy = buildCopilotRolePromptPolicy({
      profileId: 'p',
      roleNames: [role],
      departmentId: null,
    });
    assert.ok((policy as unknown as { tone?: string }).tone, `${role} missing tone`);
    const tone = (policy as unknown as { tone: string }).tone;
    assert.match(tone, /Tone:/, `${role} tone missing leading label`);
  }
});

test('viewer tone is plain-language and translates jargon', () => {
  const policy = buildCopilotRolePromptPolicy({ profileId: 'v', roleNames: ['viewer'], departmentId: null });
  const tone = (policy as unknown as { tone: string }).tone;
  assert.match(tone, /plain language|no jargon|risk priority|time between failures/i);
});

test('bme_head tone leads with single urgent action and avoids developer traces', () => {
  const policy = buildCopilotRolePromptPolicy({ profileId: 'b', roleNames: ['bme_head'], departmentId: null });
  const tone = (policy as unknown as { tone: string }).tone;
  assert.match(tone, /most urgent action|clinical engineer|operational advisor/i);
});

test('technician tone is action-first second-person with safe-checks-first rule', () => {
  const policy = buildCopilotRolePromptPolicy({ profileId: 't', roleNames: ['technician'], departmentId: null });
  const tone = (policy as unknown as { tone: string }).tone;
  assert.match(tone, /second-person|external|non-invasive|escalate/i);
});
