import {
  type AssistantContent,
  type ChatLlmProvider,
  type ChatIntent,
  type LlmGenerateParams,
  type LlmProviderResult,
} from '@/types/chatbot';

const STUB_MODEL = 'stub-deterministic-v1';

const INTENT_SUMMARIES: Record<ChatIntent, string> = {
  maintenance_tip: 'Use preventive maintenance fundamentals and recent system history to reduce repeat failures.',
  troubleshooting: 'Start with safe first-line checks and escalate if risks or unknowns remain.',
  work_order_help: 'Convert observed issues into concise, actionable work-order language for technician handoff.',
  equipment_lookup: 'Explain current equipment status and operational implications from available system records.',
  analytics_explanation: 'Explain risk, reliability, and priority metrics in plain operational terms for decisions.',
  calibration_or_logistics: 'Provide safe calibration/logistics guidance using available status and stock context.',
  too_detailed: 'This request appears too detailed for unsupported model-specific guidance.',
  unsafe: 'This request appears unsafe and requires escalation.',
  out_of_scope: 'This request is outside medical equipment management scope.',
};

function buildStubAssistant(params: LlmGenerateParams): AssistantContent {
  const summary = INTENT_SUMMARIES[params.intent];

  return {
    decision: params.requiredDecision,
    summary,
    likely_causes: [
      'Recent maintenance patterns may indicate recurring operational factors.',
      'Context quality and documentation coverage may be limiting certainty.',
    ],
    troubleshooting_steps: [
      'Verify current status, alarms, and last intervention records.',
      'Perform safe first-line checks only; avoid unsupported deep repair actions.',
      'Escalate to biomedical engineer/vendor if risk remains high or evidence is incomplete.',
    ],
    maintenance_tips: [
      'Use consistent PM checklist completion and closure-note quality controls.',
      'Track repeat issues per asset and schedule targeted preventive actions.',
    ],
    required_tools_or_parts: ['Basic inspection tools', 'Approved replacement consumables per SOP/manual'],
    actions: ['Review current assignments and update work-order notes.', 'Escalate if first-line checks fail or risk remains high.'],
    insights: ['Stub mode provides deterministic response scaffolding.', 'Use provider telemetry for production tuning.'],
    recommendations: ['Confirm grounded data availability before deeper guidance.', 'Use capability-level evaluation prompts during validation.'],
    reason_for_limit: params.requiredDecision === 'limited_answer'
      ? 'Stub mode: constrained guidance only in provider-agnostic development state.'
      : undefined,
    answer_basis: params.requiredDecision === 'limited_answer' ? 'general_safe_guidance' : 'system_data',
    confidence: params.requiredDecision === 'limited_answer' ? 'medium' : 'low',
    escalation_required: params.requiredDecision === 'limited_answer' && params.intent === 'troubleshooting',
    escalation_recommendation: params.intent === 'troubleshooting'
      ? 'If first-line checks do not resolve the issue, escalate to qualified biomedical engineer/vendor.'
      : undefined,
    escalation_guidance: params.intent === 'troubleshooting'
      ? 'Escalate immediately if patient safety or critical operations are impacted.'
      : undefined,
  };
}

export const stubProvider: ChatLlmProvider = {
  name: 'stub',
  async generate(params: LlmGenerateParams): Promise<LlmProviderResult> {
    return {
      assistant: buildStubAssistant(params),
      provider: 'stub',
      model: STUB_MODEL,
    };
  },
};
