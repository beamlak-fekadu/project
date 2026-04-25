import type { AssistantContent } from '@/types/chatbot';

const DISPLAY_REPAIR_SUMMARY = 'I generated a response but it could not be displayed reliably. Please try again.';
const EMPTY_SUMMARY = 'The assistant could not return text. Please retry or escalate via standard channels.';

export function displayableAssistantSummary(summary: string | undefined) {
  const raw = (summary ?? '').trim();
  if (!raw) return EMPTY_SUMMARY;
  if (/^```/.test(raw)) return DISPLAY_REPAIR_SUMMARY;
  if (/^\{[\s\S]*\}$/.test(raw)) return DISPLAY_REPAIR_SUMMARY;
  if (/"summary"\s*:|{"decision"|{"title"/i.test(raw)) return DISPLAY_REPAIR_SUMMARY;
  return raw;
}

export function buildAssistantCopyText(assistant: AssistantContent) {
  const sections = [
    assistant.title ? `Title: ${assistant.title}` : '',
    `Summary: ${displayableAssistantSummary(assistant.summary)}`,
    assistant.key_findings?.length ? `Key findings:\n- ${assistant.key_findings.join('\n- ')}` : '',
    assistant.recommended_actions?.length ? `Recommended actions:\n- ${assistant.recommended_actions.join('\n- ')}` : '',
    assistant.priority_reasoning?.length ? `Priority reasoning:\n- ${assistant.priority_reasoning.join('\n- ')}` : '',
    assistant.likely_causes?.length ? `Likely causes:\n- ${assistant.likely_causes.join('\n- ')}` : '',
    assistant.troubleshooting_steps?.length ? `Troubleshooting steps:\n- ${assistant.troubleshooting_steps.join('\n- ')}` : '',
    assistant.maintenance_tips?.length ? `Maintenance tips:\n- ${assistant.maintenance_tips.join('\n- ')}` : '',
    assistant.required_tools_or_parts?.length ? `Required tools or parts:\n- ${assistant.required_tools_or_parts.join('\n- ')}` : '',
    assistant.escalation_recommendation ? `Escalation recommendation: ${assistant.escalation_recommendation}` : '',
    assistant.intelligence_mode ? `Intelligence mode: ${assistant.intelligence_mode}` : '',
    assistant.proactive_signals?.length ? `Operational signals:\n- ${assistant.proactive_signals.join('\n- ')}` : '',
  ];
  return sections.filter(Boolean).join('\n\n');
}
