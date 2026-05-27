import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChatRequest } from '@/services/chatbot/classifier-service';
import { evaluateSafetyDecision } from '@/services/chatbot/safety-service';
import { buildPromptPayload } from '@/services/chatbot/prompt-service';
import { normalizeAssistantResponse } from '@/services/chatbot/assistant-response-pipeline';
import { normalizeAssistantPayloadForUi } from '@/services/chatbot/chat-response-normalizer';
import { getAssistantVisibleSections } from '@/components/assistant/assistant-message-sections';
import { EVALUATION_PROMPTS } from '@/services/chatbot/evaluation/capability-evaluation-dataset';
import type { ChatEvidence, UserChatProfile } from '@/types/chatbot';

const PROFILE: UserChatProfile = {
  profileId: 'test-profile',
  roleNames: ['technician'],
  departmentId: 'dep-1',
  departmentName: 'Emergency Department',
};

const EVIDENCE: ChatEvidence = {
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

test('asset summary prompt routes to equipment summary, not troubleshooting', () => {
  const classified = classifyChatRequest('Summarize ED-0002');
  assert.equal(classified.intent, 'asset_summary');
  assert.equal(classified.capability, 'summarize_equipment');
  assert.notEqual(classified.capability, 'safe_troubleshooting');
});

test('inventory search prompt routes away from troubleshooting', () => {
  const classified = classifyChatRequest('Which ultrasound units are in the ED?');
  assert.equal(classified.intent, 'inventory_search');
  assert.equal(classified.capability, 'summarize_equipment');
  assert.notEqual(classified.intent, 'troubleshooting');
  assert.notEqual(classified.capability, 'safe_troubleshooting');
});

test('failure history prompt routes to equipment history, not safe troubleshooting', () => {
  const classified = classifyChatRequest('Show failure history for this monitor');
  assert.equal(classified.intent, 'equipment_history');
  assert.equal(classified.capability, 'summarize_equipment');
  assert.notEqual(classified.intent, 'troubleshooting');
});

test('specific work order status routes to summarize_work_order', () => {
  const classified = classifyChatRequest('What is the status of WO-1234?');
  assert.equal(classified.intent, 'work_order_status');
  assert.equal(classified.capability, 'summarize_work_order');
  assert.equal(classified.matchedSignals.includes('specific_work_order_status'), true);
});

test('broad work order attention prompt routes to prioritization', () => {
  const classified = classifyChatRequest('What work orders need attention today?');
  assert.equal(classified.intent, 'work_order_status');
  assert.equal(classified.capability, 'prioritize_tasks');
  assert.equal(classified.matchedSignals.includes('work_order_queue_status'), true);
});

test('safe troubleshooting still routes to safe_troubleshooting and is not blocked', () => {
  const message = 'What should I check first for this patient monitor?';
  const classified = classifyChatRequest(message);
  assert.equal(classified.intent, 'troubleshooting');
  assert.equal(classified.capability, 'safe_troubleshooting');
  assert.equal(classified.troubleshootingSubtype, 'safe_general_troubleshooting');

  const safety = evaluateSafetyDecision(message, classified, PROFILE, EVIDENCE);
  assert.equal(safety.blocked, false);
  assert.equal(safety.decision, 'limited_answer');
});

test('unsafe calibration bypass request still blocks', () => {
  const message = 'How do I bypass the calibration for this analyzer?';
  const classified = classifyChatRequest(message);
  assert.equal(classified.intent, 'unsafe');
  assert.equal(classified.capability, 'unsafe_or_restricted');

  const safety = evaluateSafetyDecision(message, classified, PROFILE, EVIDENCE);
  assert.equal(safety.blocked, true);
  assert.equal(safety.decision, 'escalate');
});

test('hello routes to assistant intro instead of maintenance guidance', () => {
  const classified = classifyChatRequest('Hello');
  assert.equal(classified.intent, 'assistant_intro');
  assert.equal(classified.capability, 'assistant_intro');
});

test('command center summary routes to readiness synthesis, not troubleshooting', () => {
  const classified = classifyChatRequest('Give me a summary of the Command Center');
  assert.equal(classified.intent, 'decision_support');
  assert.equal(classified.capability, 'summarize_department_readiness');
  assert.notEqual(classified.capability, 'safe_troubleshooting');
});

test('report help routes to report_summary instead of analytics or maintenance tips', () => {
  const classified = classifyChatRequest('What reports are available in BMEDIS?');
  assert.equal(classified.intent, 'report_help');
  assert.equal(classified.capability, 'report_summary');
  assert.notEqual(classified.capability, 'maintenance_tips');
  assert.notEqual(classified.capability, 'safe_troubleshooting');
});

test('unknown fallback is neutral general help, not maintenance_tip', () => {
  const classified = classifyChatRequest('Status');
  assert.equal(classified.intent, 'general_conversation');
  assert.equal(classified.capability, 'general_system_fallback');
  assert.equal(classified.matchedSignals.includes('default_general_fallback'), true);
});

test('non-troubleshooting prompt excludes global troubleshooting instructions', () => {
  const classified = classifyChatRequest('Summarize ED-0002');
  const prompt = buildPromptPayload({
    message: 'Summarize ED-0002',
    intent: classified.intent,
    capability: classified.capability,
    confidenceLabel: classified.confidenceLabel,
    confidenceScore: classified.confidence,
    decision: 'limited_answer',
    evidence: EVIDENCE,
    profile: PROFILE,
    responseMode: 'structured',
  });

  assert.doesNotMatch(prompt.systemPrompt, /For troubleshooting, provide safe first-line checks only/i);
  assert.match(prompt.systemPrompt, /Unless the selected capability is safe_troubleshooting/i);
  assert.match(prompt.userPrompt, /keep troubleshooting_steps, likely_causes, required_tools_or_parts, and maintenance_tips empty/i);
});

test('safe troubleshooting prompt keeps scoped safety instruction', () => {
  const classified = classifyChatRequest('What should I check first for this patient monitor?');
  const prompt = buildPromptPayload({
    message: 'What should I check first for this patient monitor?',
    intent: classified.intent,
    capability: classified.capability,
    confidenceLabel: classified.confidenceLabel,
    confidenceScore: classified.confidence,
    decision: 'limited_answer',
    evidence: EVIDENCE,
    profile: PROFILE,
    responseMode: 'structured',
  });

  assert.match(prompt.systemPrompt, /The selected capability is safe_troubleshooting/i);
  assert.match(prompt.systemPrompt, /Never provide internal board-level repair/i);
});

test('normalizer strips irrelevant troubleshooting fields from non-troubleshooting output', () => {
  const normalized = normalizeAssistantResponse({
    rawProviderContent: {
      decision: 'answer',
      title: 'Asset Summary',
      summary: 'ED-0002 is active in the Emergency Department based on current system records.',
      answer_basis: 'system_data',
      confidence: 'high',
      escalation_required: false,
      key_findings: ['Asset status is active.'],
      recommended_actions: ['Review the asset profile.'],
      priority_reasoning: [],
      likely_causes: ['Loose cable'],
      troubleshooting_steps: ['Check power and cables.'],
      maintenance_tips: ['Clean the device weekly.'],
      required_tools_or_parts: ['Multimeter'],
      actions: [],
      insights: [],
      recommendations: [],
      entities_referenced: ['ED-0002'],
      follow_up_suggestions: [],
      proactive_signals: [],
      routing_explanation: [],
      evidence_used: ['equipment_assets'],
      links: [],
      limitations: [],
      missingDataFlags: [],
      source_tables: ['equipment_assets'],
    },
    capability: 'summarize_equipment',
    responseMode: 'structured',
    providerStatus: 'success',
    requiredDecision: 'answer',
  }).assistant;

  assert.deepEqual(normalized.troubleshooting_steps, []);
  assert.deepEqual(normalized.likely_causes, []);
  assert.deepEqual(normalized.maintenance_tips, []);
  assert.deepEqual(normalized.required_tools_or_parts, []);
  assert.equal(normalized.intelligence_mode, undefined);
});

test('normalizer preserves troubleshooting fields for safe_troubleshooting output', () => {
  const normalized = normalizeAssistantResponse({
    rawProviderContent: {
      decision: 'limited_answer',
      title: 'Safe Checks',
      summary: 'Use safe external first-line checks only.',
      answer_basis: 'general_safe_guidance',
      confidence: 'low',
      escalation_required: false,
      key_findings: [],
      recommended_actions: [],
      priority_reasoning: [],
      likely_causes: ['Power source interruption'],
      troubleshooting_steps: ['Confirm the external power source and battery status.'],
      maintenance_tips: [],
      required_tools_or_parts: [],
      actions: [],
      insights: [],
      recommendations: [],
      entities_referenced: [],
      follow_up_suggestions: [],
      proactive_signals: [],
      routing_explanation: [],
      evidence_used: [],
      links: [],
      limitations: [],
      missingDataFlags: [],
      source_tables: [],
    },
    capability: 'safe_troubleshooting',
    responseMode: 'structured',
    providerStatus: 'success',
    requiredDecision: 'limited_answer',
  }).assistant;

  assert.deepEqual(normalized.troubleshooting_steps, ['Confirm the external power source and battery status.']);
  assert.deepEqual(normalized.likely_causes, ['Power source interruption']);
});

test('UI normalization and visible sections are capability-aware', () => {
  const raw = {
    decision: 'answer',
    title: 'Mixed Provider Output',
    summary: 'System data summary.',
    answer_basis: 'system_data',
    confidence: 'high',
    escalation_required: false,
    troubleshooting_steps: ['Check power and cables.'],
    likely_causes: ['Loose cable'],
    required_tools_or_parts: ['Multimeter'],
    maintenance_tips: ['Clean weekly.'],
    missingDataFlags: ['pm_snapshot_missing'],
  };

  const summaryAssistant = normalizeAssistantPayloadForUi(raw, undefined, 'answer', 'summarize_equipment');
  const summarySections = getAssistantVisibleSections(summaryAssistant, 'summarize_equipment');
  assert.deepEqual(summaryAssistant.troubleshooting_steps, []);
  assert.deepEqual(summarySections.troubleshootingSteps, []);
  assert.deepEqual(summarySections.likelyCauses, []);
  assert.deepEqual(summarySections.maintenanceTips, []);
  assert.deepEqual(summarySections.missingDataNotices, ['Missing PM snapshot.']);

  const troubleshootingAssistant = normalizeAssistantPayloadForUi(raw, undefined, 'answer', 'safe_troubleshooting');
  const troubleshootingSections = getAssistantVisibleSections(troubleshootingAssistant, 'safe_troubleshooting');
  assert.deepEqual(troubleshootingSections.troubleshootingSteps, ['Check power and cables.']);
  assert.deepEqual(troubleshootingSections.likelyCauses, ['Loose cable']);
  assert.deepEqual(troubleshootingSections.requiredToolsParts, ['Multimeter']);
  assert.deepEqual(troubleshootingSections.maintenanceTips, []);
});

test('capability evaluation prompts do not drift into troubleshooting for non-troubleshooting seeds', () => {
  const allowedTroubleshootingSeeds = new Set(['safe_troubleshooting', 'unsafe_or_restricted']);
  const failures = EVALUATION_PROMPTS
    .filter((entry) => !allowedTroubleshootingSeeds.has(entry.capability))
    .map((entry) => ({ entry, classified: classifyChatRequest(entry.prompt) }))
    .filter(({ classified }) => classified.capability === 'safe_troubleshooting');

  assert.deepEqual(
    failures.map(({ entry }) => `${entry.id}: ${entry.prompt}`),
    []
  );
});
