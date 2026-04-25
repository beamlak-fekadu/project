import type { AssistantContent, CapabilityId, ChatDecision, ChatEvidence } from '@/types/chatbot';
import { getCapabilityResponseDefaults } from './capability-response-defaults';

const FORMAT_RECOVERY_COPY = 'I generated a response but it could not be displayed reliably. Please try again.';

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]) : [];
}

function hasObject(value: unknown) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function hasUsableStructuredContext(blocks: Record<string, unknown>, evidence: ChatEvidence) {
  if (asRows(blocks.rankedOperationalQueue).length > 0) return true;
  if (asRows(blocks.assignedWorkOrders).length > 0) return true;
  if (asRows(blocks.overduePm).length > 0) return true;
  if (asRows(blocks.recommendationFlags).length > 0) return true;
  if (asRows(blocks.lowStock).length > 0) return true;
  if (asRows(blocks.procurementPipeline).length > 0) return true;
  if (asRows(blocks.trainingRequests).length > 0) return true;
  if (asRows(blocks.disposalPipeline).length > 0) return true;
  if (asRows(blocks.tier1Troubleshooting).length > 0) return true;
  if (hasObject(blocks.workOrder) || hasObject(evidence.workOrder)) return true;
  if (hasObject(blocks.equipment) || hasObject(evidence.equipment)) return true;
  return (evidence.evidenceSignals ?? []).length > 0;
}

function sanitizeDecision(decision: ChatDecision) {
  return decision === 'refuse' || decision === 'escalate' || decision === 'check_manual' ? 'limited_answer' : decision;
}

function baseAssistant(
  capability: CapabilityId,
  decision: ChatDecision,
  summary: string,
  keyFindings: string[],
  actions: string[],
  reasoning: string[]
): AssistantContent {
  const defaults = getCapabilityResponseDefaults(capability);
  return {
    decision: sanitizeDecision(decision),
    title: defaults.title,
    intelligence_mode: defaults.intelligence_mode,
    summary: summary.slice(0, 2000),
    key_findings: keyFindings.slice(0, 6),
    recommended_actions: actions.slice(0, 6),
    priority_reasoning: reasoning.slice(0, 6),
    likely_causes: [],
    troubleshooting_steps: [],
    maintenance_tips: [],
    required_tools_or_parts: [],
    actions: actions.slice(0, 6),
    insights: keyFindings.slice(0, 6),
    recommendations: actions.slice(0, 6),
    escalation_guidance: undefined,
    escalation_recommendation: undefined,
    reason_for_limit: 'Generated from validated system context due to provider formatting recovery.',
    answer_basis: 'system_data',
    confidence: 'medium',
    escalation_required: false,
    entities_referenced: [],
    follow_up_suggestions: defaults.follow_up_suggestions.slice(0, 4),
    proactive_signals: [],
    routing_explanation: [],
  };
}

export function buildDeterministicStructuredFallback(params: {
  capability: CapabilityId;
  decision: ChatDecision;
  blocks: Record<string, unknown>;
  evidence: ChatEvidence;
}): AssistantContent {
  const { capability, decision, blocks, evidence } = params;
  const queue = asRows(blocks.rankedOperationalQueue).slice(0, 3);
  const overduePm = asRows(blocks.overduePm);
  const flags = asRows(blocks.recommendationFlags);
  const workOrders = asRows(blocks.assignedWorkOrders);
  const lowStock = asRows(blocks.lowStock);
  const procurement = asRows(blocks.procurementPipeline);
  const proactiveSignals = Array.isArray(blocks.proactiveSignals)
    ? (blocks.proactiveSignals as unknown[]).map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];

  if (capability === 'prioritize_tasks') {
    const topPriorities = queue.map((item, idx) => {
      const label = String(item.label ?? `Priority item ${idx + 1}`);
      const score = typeof item.score === 'number' ? ` (score ${item.score})` : '';
      return `${idx + 1}. ${label}${score}`;
    });
    const findings = [
      overduePm.length ? `${overduePm.length} overdue PM plan(s) require attention.` : '',
      flags.length ? `${flags.length} high/critical recommendation flag(s) are still open.` : '',
      proactiveSignals[0] ?? '',
    ].filter(Boolean);
    const actions = [
      topPriorities[0] ? `Address ${topPriorities[0].replace(/^\d+\.\s*/, '')} first.` : '',
      topPriorities[1] ? `Next, resolve ${topPriorities[1].replace(/^\d+\.\s*/, '')}.` : '',
      topPriorities[2] ? `Then follow up on ${topPriorities[2].replace(/^\d+\.\s*/, '')}.` : '',
      lowStock.length ? 'Coordinate with logistics for low-stock blockers affecting urgent jobs.' : '',
      procurement.length ? 'Escalate delayed procurement items tied to critical maintenance.' : '',
    ].filter(Boolean);
    return {
      ...baseAssistant(
        capability,
        decision,
        'Based on current operational signals, your highest priorities are overdue PM plans, unacknowledged high/critical recommendation flags, and assets with concurrent alerts.',
        findings.length ? findings : ['Operational queue was used to derive top priorities.'],
        actions.length ? actions : ['Review the ranked operational queue and address highest-score items first.'],
        topPriorities.length ? topPriorities : ['Prioritization used ranked operational queue and active risk signals.']
      ),
      proactive_signals: proactiveSignals.slice(0, 3),
    };
  }

  if (capability === 'safe_troubleshooting') {
    const checks = asRows(blocks.tier1Troubleshooting).map((row) => String(row.check ?? row.step ?? '')).filter(Boolean);
    return {
      ...baseAssistant(
        capability,
        decision,
        'Using available service context, here are safe first-line checks before escalation.',
        checks.slice(0, 4),
        checks.slice(0, 5),
        ['Checks are limited to non-invasive, first-line troubleshooting steps.']
      ),
      troubleshooting_steps: checks.slice(0, 6),
    };
  }

  if (capability === 'summarize_work_order') {
    const wo = (blocks.workOrder as Record<string, unknown> | null) ?? evidence.workOrder;
    const woNumber = String(wo?.work_order_number ?? wo?.id ?? 'this work order');
    const status = String(wo?.status ?? 'status unavailable');
    const findings = [workOrders.length ? `${workOrders.length} related work order(s) are in scope.` : '', `Current status: ${status}.`].filter(
      Boolean
    );
    return baseAssistant(
      capability,
      decision,
      `Here is a deterministic summary for ${woNumber} based on retrieved system context.`,
      findings.length ? findings : ['Work order context was retrieved successfully.'],
      ['Review status and assignee updates.', 'Confirm blockers, parts, and next required action.', 'Document progress and closure criteria.'],
      ['Summary generated directly from retrieved work-order context.']
    );
  }

  const genericFindings = [
    (evidence.evidenceSignals ?? [])[0] ?? '',
    workOrders.length ? `${workOrders.length} work order record(s) were retrieved.` : '',
    overduePm.length ? `${overduePm.length} overdue PM signal(s) were retrieved.` : '',
    flags.length ? `${flags.length} recommendation flag(s) were retrieved.` : '',
  ].filter(Boolean);
  const genericActions = [
    'Review the highest-risk or highest-urgency items first.',
    'Confirm ownership and next action for each open signal.',
    lowStock.length || procurement.length ? 'Resolve logistics/procurement blockers affecting service delivery.' : '',
  ].filter(Boolean);

  return baseAssistant(
    capability,
    decision,
    genericFindings.length
      ? 'I generated this response directly from retrieved system context because the provider response format was not reliable.'
      : FORMAT_RECOVERY_COPY,
    genericFindings.length ? genericFindings : ['No structured context details were available to summarize.'],
    genericActions.length ? genericActions : ['Retry after refreshing context.'],
    ['Deterministic fallback used retrieved context blocks to avoid dropping useful system data.']
  );
}
