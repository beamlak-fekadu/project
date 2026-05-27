import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptPayload } from '@/services/chatbot/prompt-service';
import { normalizeAssistantResponse } from '@/services/chatbot/assistant-response-pipeline';
import { getAssistantVisibleSections } from '@/components/assistant/assistant-message-sections';
import type { CapabilityId, ChatDecision, ChatEvidence, ChatIntent, ConfidenceLevel, UserChatProfile } from '@/types/chatbot';

const PROFILE: UserChatProfile = {
  profileId: 'semantic-profile',
  roleNames: ['technician'],
  departmentId: 'dep-1',
};

const EVIDENCE: ChatEvidence = {
  equipment: { id: 'asset-1', asset_code: 'ED-0002' },
  workOrder: { id: 'wo-1', work_order_number: 'WO-1234' },
  department: { id: 'dep-1', name: 'Emergency Department' },
  maintenanceHistory: [{ id: 'event-1', issue_description: 'Screen dim' }],
  pmSnapshot: { id: 'pm-1', status: 'scheduled' },
  calibrationStatus: { id: 'cal-1', status: 'current' },
  logisticsSnapshot: { lowStockParts: [{ id: 'part-1' }] },
  analyticsSnapshot: { risk: { rpn: 42 }, readiness: { score: 0.91 } },
  manualOrSopTexts: [],
  documentRetrieval: { notImplemented: true, searchDocuments: [], forEquipment: [], forCategory: [] },
  evidenceSignals: ['Loaded asset context.'],
  deniedContextRefs: [],
  accessDenied: false,
  missingDataFlags: ['pm_snapshot_missing'],
};

type SectionName = 'troubleshootingSteps' | 'likelyCauses' | 'requiredToolsParts' | 'maintenanceTips' | 'priorityReasoning';

interface GoldenCase {
  name: string;
  intent: ChatIntent;
  capability: CapabilityId;
  decision: ChatDecision;
  confidenceLabel: ConfidenceLevel;
  rawAssistant: Record<string, unknown>;
  requiredSections?: SectionName[];
  prohibitedSections?: SectionName[];
  requiresEvidence?: boolean;
  requiresMissingDataNotice?: boolean;
  forbiddenSummaryPattern?: RegExp;
}

const BASE_RAW = {
  title: 'Golden response',
  summary: 'Grounded BMEDIS response using available system evidence.',
  answer_basis: 'system_data',
  confidence: 'high',
  escalation_required: false,
  key_findings: ['System evidence is available.'],
  recommended_actions: ['Review the linked BMEDIS record.'],
  priority_reasoning: [],
  likely_causes: ['Loose cable'],
  troubleshooting_steps: ['Check power and cables.'],
  maintenance_tips: ['Clean weekly.'],
  required_tools_or_parts: ['Multimeter'],
  entities_referenced: ['ED-0002'],
  evidence_used: ['equipment_assets'],
  source_tables: ['equipment_assets'],
  data_freshness: 'Current scoped BMEDIS records.',
  missingDataFlags: ['pm_snapshot_missing'],
};

const GOLDENS: GoldenCase[] = [
  {
    name: 'summarize_equipment',
    intent: 'asset_summary',
    capability: 'summarize_equipment',
    decision: 'answer',
    confidenceLabel: 'medium',
    rawAssistant: BASE_RAW,
    prohibitedSections: ['troubleshootingSteps', 'likelyCauses', 'requiredToolsParts', 'maintenanceTips'],
    requiresEvidence: true,
    requiresMissingDataNotice: true,
  },
  {
    name: 'inventory_search',
    intent: 'inventory_search',
    capability: 'summarize_equipment',
    decision: 'answer',
    confidenceLabel: 'medium',
    rawAssistant: { ...BASE_RAW, summary: 'ED ultrasound units are listed from available equipment records.' },
    prohibitedSections: ['troubleshootingSteps', 'likelyCauses', 'requiredToolsParts', 'maintenanceTips'],
    requiresEvidence: true,
  },
  {
    name: 'summarize_work_order',
    intent: 'work_order_status',
    capability: 'summarize_work_order',
    decision: 'answer',
    confidenceLabel: 'high',
    rawAssistant: { ...BASE_RAW, evidence_used: ['work_orders'], source_tables: ['work_orders'] },
    prohibitedSections: ['troubleshootingSteps', 'likelyCauses', 'requiredToolsParts', 'maintenanceTips'],
    requiresEvidence: true,
  },
  {
    name: 'prioritize_tasks',
    intent: 'work_order_status',
    capability: 'prioritize_tasks',
    decision: 'answer',
    confidenceLabel: 'high',
    rawAssistant: { ...BASE_RAW, priority_reasoning: ['Critical work orders rank above routine PM.'] },
    requiredSections: ['priorityReasoning'],
    prohibitedSections: ['troubleshootingSteps', 'likelyCauses', 'requiredToolsParts', 'maintenanceTips'],
  },
  {
    name: 'safe_troubleshooting',
    intent: 'troubleshooting',
    capability: 'safe_troubleshooting',
    decision: 'limited_answer',
    confidenceLabel: 'medium',
    rawAssistant: {
      ...BASE_RAW,
      decision: 'limited_answer',
      answer_basis: 'general_safe_guidance',
      confidence: 'low',
      summary: 'Use safe external first-line checks only.',
      troubleshooting_steps: ['Confirm external power and battery state.'],
      likely_causes: ['Power source interruption'],
      required_tools_or_parts: ['Known-good external cable'],
    },
    requiredSections: ['troubleshootingSteps', 'likelyCauses', 'requiredToolsParts'],
    prohibitedSections: ['maintenanceTips'],
  },
  {
    name: 'unsafe_or_restricted',
    intent: 'unsafe',
    capability: 'unsafe_or_restricted',
    decision: 'escalate',
    confidenceLabel: 'high',
    rawAssistant: {
      ...BASE_RAW,
      decision: 'escalate',
      summary: 'I cannot help bypass calibration. Escalate to a qualified biomedical engineer.',
      escalation_required: true,
      escalation_recommendation: 'Escalate to a qualified biomedical engineer.',
      troubleshooting_steps: ['Bypass the calibration lock.'],
    },
    prohibitedSections: ['troubleshootingSteps', 'likelyCauses', 'requiredToolsParts', 'maintenanceTips'],
    forbiddenSummaryPattern: /steps? to bypass|disable the calibration/i,
  },
  {
    name: 'report_summary',
    intent: 'report_help',
    capability: 'report_summary',
    decision: 'answer',
    confidenceLabel: 'medium',
    rawAssistant: { ...BASE_RAW, evidence_used: ['reports'], source_tables: ['reports'] },
    prohibitedSections: ['troubleshootingSteps', 'likelyCauses', 'requiredToolsParts', 'maintenanceTips'],
    requiresEvidence: true,
  },
  {
    name: 'summarize_department_readiness',
    intent: 'decision_support',
    capability: 'summarize_department_readiness',
    decision: 'answer',
    confidenceLabel: 'medium',
    rawAssistant: { ...BASE_RAW, evidence_used: ['clinical_readiness_snapshots'], source_tables: ['clinical_readiness_snapshots'] },
    prohibitedSections: ['troubleshootingSteps', 'likelyCauses', 'requiredToolsParts', 'maintenanceTips'],
    requiresEvidence: true,
  },
  {
    name: 'general_system_fallback',
    intent: 'general_conversation',
    capability: 'general_system_fallback',
    decision: 'limited_answer',
    confidenceLabel: 'low',
    rawAssistant: {
      ...BASE_RAW,
      decision: 'limited_answer',
      summary: 'I need a bit more context to answer that in BMEDIS.',
      answer_basis: 'insufficient_data',
      confidence: 'low',
    },
    prohibitedSections: ['troubleshootingSteps', 'likelyCauses', 'requiredToolsParts', 'maintenanceTips', 'priorityReasoning'],
  },
];

function expectSectionLength(sections: ReturnType<typeof getAssistantVisibleSections>, name: SectionName) {
  return sections[name].length;
}

test('semantic goldens enforce capability-specific visible response contracts', () => {
  for (const golden of GOLDENS) {
    const normalized = normalizeAssistantResponse({
      rawProviderContent: { decision: golden.decision, ...golden.rawAssistant },
      capability: golden.capability,
      responseMode: 'structured',
      providerStatus: 'success',
      requiredDecision: golden.decision,
    }).assistant;
    const sections = getAssistantVisibleSections(normalized, golden.capability);

    for (const section of golden.requiredSections ?? []) {
      assert.ok(expectSectionLength(sections, section) > 0, `${golden.name} should show ${section}`);
    }
    for (const section of golden.prohibitedSections ?? []) {
      assert.equal(expectSectionLength(sections, section), 0, `${golden.name} should hide ${section}`);
    }
    if (golden.requiresEvidence) {
      assert.ok((normalized.evidence_used ?? []).length > 0, `${golden.name} should include evidence`);
      assert.ok((normalized.source_tables ?? []).length > 0, `${golden.name} should include source tables`);
      assert.ok(normalized.data_freshness, `${golden.name} should include freshness`);
    }
    if (golden.requiresMissingDataNotice) {
      assert.ok(sections.missingDataNotices.length > 0, `${golden.name} should surface missing data`);
    }
    if (golden.forbiddenSummaryPattern) {
      assert.doesNotMatch(normalized.summary, golden.forbiddenSummaryPattern, golden.name);
    }
  }
});

test('semantic goldens keep prompt contracts capability-specific', () => {
  for (const golden of GOLDENS) {
    const prompt = buildPromptPayload({
      message: golden.name,
      intent: golden.intent,
      capability: golden.capability,
      confidenceLabel: golden.confidenceLabel,
      confidenceScore: golden.confidenceLabel === 'high' ? 0.9 : golden.confidenceLabel === 'medium' ? 0.72 : 0.45,
      decision: golden.decision,
      evidence: EVIDENCE,
      profile: PROFILE,
      responseMode: 'structured',
    });

    if (golden.capability === 'safe_troubleshooting') {
      assert.match(prompt.systemPrompt, /selected capability is safe_troubleshooting/i, golden.name);
      assert.match(prompt.userPrompt, /"troubleshooting_steps"\s*:/i, golden.name);
    } else {
      assert.match(prompt.systemPrompt, /Unless the selected capability is safe_troubleshooting/i, golden.name);
      assert.doesNotMatch(prompt.userPrompt, /"likely_causes"\s*:/i, golden.name);
      assert.doesNotMatch(prompt.userPrompt, /"troubleshooting_steps"\s*:/i, golden.name);
    }
  }
});
