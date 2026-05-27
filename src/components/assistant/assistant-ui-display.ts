import type { AssistantContent } from '@/types/chatbot';
import { getAssistantVisibleSections } from './assistant-message-sections';

const DISPLAY_REPAIR_SUMMARY =
  "I could not finish formatting a response. Try rephrasing, or open the relevant page (asset, work order, report) and ask again.";
const EMPTY_SUMMARY =
  "I do not have enough context to answer that yet. Open the asset, work order, request, or report you want help with and ask again.";

export function displayableAssistantSummary(summary: string | undefined) {
  const raw = (summary ?? '').trim();
  if (!raw) return EMPTY_SUMMARY;
  if (/^```/.test(raw)) return DISPLAY_REPAIR_SUMMARY;
  if (/^\{[\s\S]*\}$/.test(raw)) return DISPLAY_REPAIR_SUMMARY;
  if (/"summary"\s*:|{"decision"|{"title"/i.test(raw)) return DISPLAY_REPAIR_SUMMARY;
  // Defensive client-side guard for [object Object] and bare "undefined"/"null"
  // tokens that can sneak into provider text fields.
  const cleaned = raw
    .replace(/\[object Object\]/g, '')
    .replace(/\bundefined\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return EMPTY_SUMMARY;
  return cleaned;
}

export function buildAssistantCopyText(assistant: AssistantContent, capability?: string) {
  const sectionsForCapability = getAssistantVisibleSections(assistant, capability);
  const sections = [
    assistant.title ? `Title: ${assistant.title}` : '',
    `Summary: ${displayableAssistantSummary(assistant.summary)}`,
    sectionsForCapability.keyFindings.length ? `Key findings:\n- ${sectionsForCapability.keyFindings.join('\n- ')}` : '',
    sectionsForCapability.recommendedActions.length ? `Recommended actions:\n- ${sectionsForCapability.recommendedActions.join('\n- ')}` : '',
    sectionsForCapability.priorityReasoning.length ? `Priority reasoning:\n- ${sectionsForCapability.priorityReasoning.join('\n- ')}` : '',
    sectionsForCapability.likelyCauses.length ? `Likely causes:\n- ${sectionsForCapability.likelyCauses.join('\n- ')}` : '',
    sectionsForCapability.troubleshootingSteps.length ? `Troubleshooting steps:\n- ${sectionsForCapability.troubleshootingSteps.join('\n- ')}` : '',
    sectionsForCapability.maintenanceTips.length ? `Maintenance tips:\n- ${sectionsForCapability.maintenanceTips.join('\n- ')}` : '',
    sectionsForCapability.requiredToolsParts.length ? `Required tools or parts:\n- ${sectionsForCapability.requiredToolsParts.join('\n- ')}` : '',
    assistant.evidence_used?.length ? `Evidence used:\n- ${assistant.evidence_used.join('\n- ')}` : '',
    sectionsForCapability.missingDataNotices.length ? `Missing data:\n- ${sectionsForCapability.missingDataNotices.join('\n- ')}` : '',
    assistant.links?.length ? `Links:\n- ${assistant.links.map((link) => `${link.label}: ${link.href}`).join('\n- ')}` : '',
    sectionsForCapability.limitations.length ? `Limitations:\n- ${sectionsForCapability.limitations.join('\n- ')}` : '',
    assistant.source_tables?.length ? `Source tables: ${assistant.source_tables.join(', ')}` : '',
    assistant.data_freshness ? `Data freshness: ${assistant.data_freshness}` : '',
    assistant.escalation_recommendation ? `Escalation recommendation: ${assistant.escalation_recommendation}` : '',
    assistant.intelligence_mode ? `Intelligence mode: ${assistant.intelligence_mode}` : '',
    assistant.proactive_signals?.length ? `Operational signals:\n- ${assistant.proactive_signals.join('\n- ')}` : '',
  ];
  return sections.filter(Boolean).join('\n\n');
}
