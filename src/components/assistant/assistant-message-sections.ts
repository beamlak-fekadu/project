import type { AssistantContent } from '@/types/chatbot';

function asString(value: unknown, max = 200): string {
  if (typeof value === 'string') return value.slice(0, max);
  if (value == null) return '';
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return '';
  }
}

export function safeAssistantList(items: unknown[] | undefined, max = 6): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => asString(item))
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, max);
}

function missingFlagLabel(flag: string) {
  return flag
    .replace(/_missing$/i, '')
    .replace(/_/g, ' ')
    .replace(/\bpm\b/i, 'PM')
    .replace(/\bqr\b/i, 'QR');
}

export function getAssistantVisibleSections(assistant: AssistantContent, capability?: string) {
  const isTroubleshooting = capability === 'safe_troubleshooting';
  const isMaintenanceTips = capability === 'maintenance_tips';
  return {
    recommendedActions: safeAssistantList(assistant.recommended_actions, 6),
    priorityReasoning: safeAssistantList(assistant.priority_reasoning, 6),
    troubleshootingSteps: isTroubleshooting ? safeAssistantList(assistant.troubleshooting_steps, 8) : [],
    likelyCauses: isTroubleshooting ? safeAssistantList(assistant.likely_causes, 6) : [],
    maintenanceTips: isMaintenanceTips ? safeAssistantList(assistant.maintenance_tips, 6) : [],
    requiredToolsParts: isTroubleshooting ? safeAssistantList(assistant.required_tools_or_parts, 6) : [],
    keyFindings: safeAssistantList(assistant.key_findings, 6),
    followUps: safeAssistantList(assistant.follow_up_suggestions, 4),
    limitations: safeAssistantList(assistant.limitations, 4),
    sourceTables: safeAssistantList(assistant.source_tables, 8),
    missingDataNotices: safeAssistantList(
      (assistant as AssistantContent & { missingDataFlags?: string[] }).missingDataFlags,
      6
    ).map((flag) => `Missing ${missingFlagLabel(flag)}.`),
  };
}
