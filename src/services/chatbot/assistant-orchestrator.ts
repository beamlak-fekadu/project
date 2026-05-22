import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type AssistantContent,
  type CapabilityId,
  type ChatContextRefs,
  type ChatDecision,
  type ChatModuleContext,
  type ClassifiedRequest,
  type OrchestratorResult,
  type UserChatProfile,
} from '@/types/chatbot';
import { buildRoutingExplanation, classifyChatRequest } from './classifier-service';
import { buildRollingMemorySummary, loadConversationMemory, persistConversationMemory } from './conversation-memory-service';
import { resolveEntitiesDetailed, type EntityResolutionWarning } from './entity-resolution-service';
import { buildTaskContext } from './task-context-service';
import { evaluateSafetyDecision, STANDARD_RESPONSES } from './safety-service';
import { buildPromptPayload } from './prompt-service';
import { generateAssistantContent } from './llm-service';
import { buildAiUnavailableAssistant, ensureUiSafeAssistant } from './providers/normalize-provider-output';
import { normalizeAssistantResponse } from './assistant-response-pipeline';
import { buildDeterministicStructuredFallback, hasUsableStructuredContext } from './structured-context-fallback';
import { buildDeterministicAnswerCandidate, deterministicAnswerForPrompt } from './deterministic-answer-builders';
import { applyResponseUsefulnessGuard } from './response-usefulness-guard';
import { verifyAssistantClaimsAgainstEvidence } from './claim-verification';
import { resolveDataLineage } from './data-lineage';
import { logCopilotTelemetry } from './telemetry-service';
import { getCapabilityDefinition, normalizeCapabilityId } from './capability-registry';
import { getOwnCopilotUsageSnapshot, logCopilotUsageEvent } from './usage-service';
import { buildActionDraftsFromContext } from './action-draft-service';

function debugProviderFlowEnabled() {
  return (process.env.CHAT_DEBUG_PROVIDER_FLOW ?? '').toLowerCase() === 'true';
}

function deriveAnswerType(assistant: AssistantContent) {
  if (assistant.troubleshooting_steps?.length) return 'troubleshooting';
  if (assistant.priority_reasoning?.length) return 'prioritization';
  if ((assistant.key_findings?.length ?? 0) >= 2 && (assistant.insights?.length ?? 0) >= 2) return 'synthesis';
  return 'general';
}

function defaultIntelligenceMode(capability: CapabilityId) {
  if (capability === 'safe_troubleshooting') return 'troubleshooting' as const;
  if (capability === 'prioritize_tasks') return 'prioritization' as const;
  if (capability === 'summarize_alerts') return 'synthesis' as const;
  if (capability === 'assistant_intro') return 'standard' as const;
  return 'standard' as const;
}

function shouldAttachProactiveSignals(capability: CapabilityId) {
  if (capability === 'assistant_intro') return false;
  if (
    capability === 'general_system_fallback' ||
    capability === 'general_conversation' ||
    capability === 'off_topic_safe' ||
    capability === 'unsafe_or_restricted'
  )
    return false;
  return true;
}

function isGenericPageFollowUp(message: string) {
  return /\b(summari[sz]e this|what should i know|what is happening|what is going on|explain this|use this page|this page|open the evidence|show evidence|make this shorter|shorter for my director)\b/i.test(
    message
  );
}

function derivePageAwareCapability(params: {
  classified: ClassifiedRequest;
  message: string;
  moduleContext?: ChatModuleContext;
  contextRefs?: ChatContextRefs;
}): CapabilityId | null {
  const { classified, message, moduleContext, contextRefs } = params;
  if (classified.capability === 'unsafe_or_restricted') return null;
  if (
    classified.capability === 'copilot_diagnostics' ||
    classified.capability === 'metric_debug' ||
    classified.capability === 'usage_status' ||
    /\b(classif|telemetry|provider|parser|usage|diagnostic|why.*classified)\b/i.test(message)
  ) {
    return null;
  }

  const route = moduleContext?.route ?? moduleContext?.pathname ?? '';
  const selected = moduleContext?.selectedRecordType ?? '';
  const generic = classified.capability === 'general_system_fallback' || isGenericPageFollowUp(message);

  if ((moduleContext?.qrToken || route.startsWith('/qr/a/')) && generic) return 'qr_asset_context';
  if ((moduleContext?.reportType || route.startsWith('/reports')) && generic) return 'report_summary';
  // Work-order entity context takes priority over peripheral offline-sync state.
  // The WO detail page always passes a truthy queueStatus object; checking it
  // before the work-order route would misroute "Summarize this work order" to
  // offline_sync_status because isGenericPageFollowUp matches "summarize this".
  if ((contextRefs?.workOrderId || selected.includes('work_order') || route.includes('/maintenance/work-orders/')) && generic) {
    return 'summarize_work_order';
  }
  // Only activate offline_sync when the user is on that page or has real
  // pending items (failed or conflict), not just any truthy queueStatus object.
  const offlinePending = typeof moduleContext?.queueStatus === 'object' && moduleContext.queueStatus !== null
    ? ((moduleContext.queueStatus as Record<string, number>).failed ?? 0)
      + ((moduleContext.queueStatus as Record<string, number>).conflict ?? 0)
    : 0;
  if ((offlinePending > 0 || route.startsWith('/offline-sync')) && generic) return 'offline_sync_status';
  if (route.startsWith('/maintenance/requests/new') || /\b(help me report|report a problem|problem with this equipment|create.*maintenance request)\b/i.test(message)) {
    return 'general_system_fallback';
  }
  if ((contextRefs?.equipmentId || selected.includes('equipment') || selected.includes('asset') || route.startsWith('/equipment/')) && generic) {
    return 'summarize_equipment';
  }
  if (route.startsWith('/command') && /\b(hospital|equipment|fleet|readiness|summari[sz]e)\b/i.test(message)) return 'summarize_department_readiness';
  if (route.startsWith('/command') && /\b(priorit|urgent|first|today|what should|why)\b/i.test(message)) return 'prioritize_tasks';
  if ((route.startsWith('/spare-parts') || route.startsWith('/logistics')) && /\b(stock|block|part|inventory|logistics|what should|which one|handle first|first|next|summari[sz]e this)\b/i.test(message)) {
    return 'logistics_status';
  }
  if (route.startsWith('/procurement') && /\b(procurement|delivery|order|pipeline|what should|summari[sz]e this)\b/i.test(message)) {
    return 'procurement_status';
  }
  if (route.startsWith('/developer-lab') && /\b(classif|telemetry|provider|parser|usage|diagnostic|why)\b/i.test(message)) {
    return 'copilot_diagnostics';
  }
  return null;
}

function withPageAwareCapability(params: {
  classified: ClassifiedRequest;
  capability: CapabilityId;
  moduleContext?: ChatModuleContext;
  contextRefs?: ChatContextRefs;
  message: string;
}): ClassifiedRequest {
  const pageAware = derivePageAwareCapability(params);
  if (!pageAware || pageAware === params.capability) return { ...params.classified, capability: params.capability };
  return {
    ...params.classified,
    capability: pageAware,
    confidence: Math.max(params.classified.confidence, 0.78),
    confidenceLabel: params.classified.confidenceLabel === 'low' ? 'medium' : params.classified.confidenceLabel,
    fallbackReason: undefined,
    reasons: [...params.classified.reasons, `Page context selected ${pageAware}.`],
    matchedSignals: [...params.classified.matchedSignals, 'page_context_capability'],
    candidates: [
      { capability: pageAware, confidence: Math.max(params.classified.confidence, 0.78), reasons: ['Current page/entity context.'] },
      ...params.classified.candidates,
    ],
  };
}

export function shouldUseProvider(params: { capability: CapabilityId; message: string; responseMode: 'local' | 'text' | 'structured' }) {
  if (params.capability === 'assistant_intro' || params.capability === 'unsafe_or_restricted') return false;
  if (
    params.capability === 'copilot_diagnostics' &&
    !/\b(gemini smoke test|run gemini|test gemini)\b/i.test(params.message)
  ) {
    return false;
  }
  if (params.responseMode === 'local') return false;
  return true;
}

export function buildDeterministicAssistantIntro(): AssistantContent {
  return {
    decision: 'answer',
    title: 'BMEDIS Copilot',
    summary:
      "Hello, I’m your BMEDIS biomedical equipment management copilot. I can help you understand tasks, work orders, equipment status, preventive maintenance, calibration, logistics, notifications, decision support, and safe first-line troubleshooting.",
    actions: [
      'Review and prioritize your tasks',
      'Summarize work orders and equipment history',
      'Explain PM, calibration, and equipment risk concerns',
      'Summarize stock, procurement, and logistics issues',
      'Provide safe first-line troubleshooting guidance',
    ],
    insights: [],
    recommendations: [],
    key_findings: [],
    recommended_actions: [],
    troubleshooting_steps: [],
    priority_reasoning: [],
    likely_causes: [],
    maintenance_tips: [],
    required_tools_or_parts: [],
    escalation_guidance: undefined,
    answer_basis: 'system_capabilities',
    confidence: 'high',
    intelligence_mode: 'standard',
    entities_referenced: [],
    follow_up_suggestions: [
      'What is on my to-do list?',
      'Summarize open work orders',
      'What notifications need attention?',
      'What should I check first if this monitor is not powering on?',
    ],
    proactive_signals: [],
    routing_explanation: [],
    evidence_used: [],
    links: [],
    limitations: [],
    data_freshness: undefined,
    source_tables: [],
    action_drafts: [],
    escalation_required: false,
  };
}

function enrichAssistantPayload(params: {
  assistant: AssistantContent;
  blocks: Record<string, unknown>;
  classified: ClassifiedRequest;
  capability: CapabilityId;
  evidence?: import('@/types/chatbot').ChatEvidence;
  moduleContext?: ChatModuleContext;
}): AssistantContent {
  const { assistant, blocks, classified, capability, evidence, moduleContext } = params;
  const fromBlocks =
    shouldAttachProactiveSignals(capability) && Array.isArray(blocks.proactiveSignals)
      ? (blocks.proactiveSignals as string[])
      : [];
  const mergedProactive = [...new Set([...fromBlocks, ...(assistant.proactive_signals ?? [])])].slice(0, 3);
  const evidenceUsed = Array.isArray(blocks.evidenceUsed) ? (blocks.evidenceUsed as string[]) : [];
  const sourceTables = Array.isArray(blocks.sourceTables) ? (blocks.sourceTables as string[]) : [];
  const routeLinks = Array.isArray(blocks.routeLinks)
    ? (blocks.routeLinks as Array<{ label?: unknown; href?: unknown; type?: unknown }>)
        .map((link) => ({
          label: String(link.label ?? '').slice(0, 120),
          href: String(link.href ?? '').slice(0, 250),
          type: link.type ? String(link.type).slice(0, 60) : undefined,
        }))
        .filter((link) => link.label && link.href.startsWith('/'))
    : [];
  const warnings = Array.isArray(blocks.toolWarnings) ? (blocks.toolWarnings as string[]) : [];
  const routing = buildRoutingExplanation(classified);
  const routingEcho =
    capability === 'assistant_intro' ? [] : assistant.routing_explanation?.length ? assistant.routing_explanation : routing;
  const sandboxOverride =
    Boolean(blocks?.sandboxSimulation) ||
    /developer-lab/.test(moduleContext?.route ?? moduleContext?.pathname ?? '') &&
      /sensitivity|sandbox|simulation/.test(
        (moduleContext?.pageLabel ?? '') + ' ' + (moduleContext?.activeTab ?? '')
      );
  const explicitMode = assistant.data_mode;
  const lineage = resolveDataLineage({
    capability,
    evidence,
    sandboxOverride,
    explicitMode,
    ageLabel: assistant.data_age_label,
  });
  return {
    ...assistant,
    proactive_signals: mergedProactive,
    routing_explanation: routingEcho.slice(0, 8),
    evidence_used: [...new Set([...(assistant.evidence_used ?? []), ...evidenceUsed])].slice(0, 12),
    links: [...(assistant.links ?? []), ...routeLinks].slice(0, 10),
    limitations: [...new Set([...(assistant.limitations ?? []), ...warnings])].slice(0, 8),
    source_tables: [...new Set([...(assistant.source_tables ?? []), ...sourceTables])].slice(0, 12),
    data_freshness: assistant.data_freshness ?? lineage.data_freshness,
    data_mode: lineage.data_mode,
    data_age_label: assistant.data_age_label ?? lineage.data_age_label,
    intelligence_mode: assistant.intelligence_mode ?? defaultIntelligenceMode(capability),
  };
}

function enforceOffTopicRedirect(assistant: AssistantContent, capability: CapabilityId): AssistantContent {
  if (capability !== 'general_conversation' && capability !== 'off_topic_safe') return assistant;
  const redirect = 'I can also help with BMEDIS tasks, work orders, equipment summaries, notifications, and safe troubleshooting.';
  const summary = assistant.summary.includes('BMEDIS') ? assistant.summary : `${assistant.summary.trim()} ${redirect}`.trim();
  return {
    ...assistant,
    summary: summary.slice(0, 2000),
    title: capability === 'off_topic_safe' ? 'General Guidance' : 'General Conversation',
    follow_up_suggestions: ['What is on my to-do list?', 'What should I prioritize today?', 'Summarize this work order'],
    answer_basis: 'model_output',
    confidence: 'medium',
  };
}

function buildBlockedAssistantContent(
  decision: ChatDecision,
  reason: string,
  extras?: { policyAlternative?: string; safeChecks?: string[]; policyTags?: string[] }
): AssistantContent {
  const unsafeEscalation = decision === 'escalate';
  const specificTechnical = decision === 'check_manual';
  const outOfScopeRefusal = decision === 'refuse';
  const defaultSafeChecks = [
    'Confirm power source, plug, cable, battery, and accessories externally.',
    'Inspect for visible damage, overheating, blocked ventilation, cleaning issues, and displayed messages.',
    'Check current asset history, PM/calibration status, and open work/request records.',
    'Remove from clinical use and escalate if alarms, safety features, internal repair, or calibration are involved.',
  ];
  const safeChecks = extras?.safeChecks && extras.safeChecks.length > 0 ? extras.safeChecks : defaultSafeChecks;
  const tags = extras?.policyTags ?? [];
  const isInjection = tags.some((tag) => tag.startsWith('injection:'));
  const titleForInjection = 'Request follows a restricted pattern';
  const summaryUnsafe = `I cannot guide internal repair, alarm bypass, service mode, or unsupported manufacturer-specific steps. ${reason}${extras?.policyAlternative ? ' ' + extras.policyAlternative : ' Here are safe first-line checks you can do without opening the equipment.'}`;
  const summaryInjection = `${reason}${extras?.policyAlternative ? ' ' + extras.policyAlternative : ''}`.trim();
  const summaryRefuseDefault = `${reason}${extras?.policyAlternative ? ' ' + extras.policyAlternative : ''}`.trim();
  return {
    decision,
    title: isInjection
      ? titleForInjection
      : decision === 'refuse'
        ? 'Request outside safe scope'
        : 'Limited operational guidance',
    summary: isInjection
      ? summaryInjection || reason
      : unsafeEscalation || specificTechnical
        ? summaryUnsafe
        : outOfScopeRefusal
          ? summaryRefuseDefault || reason
          : reason,
    key_findings: [],
    recommended_actions: isInjection
      ? ['Ask the question using your real BMEDIS role.', extras?.policyAlternative ?? 'Tell me the BMEDIS task or evidence you need; I will route it correctly.'].filter(Boolean)
      : unsafeEscalation || specificTechnical
        ? ['Use only safe external checks.', 'Escalate to a qualified biomedical engineer or vendor when the issue persists or affects safety.']
        : outOfScopeRefusal
          ? ['Use this assistant for biomedical equipment inventory, maintenance, PM, calibration, logistics, reports, and decision-support questions.', 'For patient symptoms or treatment decisions, involve the appropriate licensed clinical staff.']
          : [],
    priority_reasoning: [],
    likely_causes: [],
    troubleshooting_steps: isInjection ? [] : unsafeEscalation || specificTechnical ? safeChecks : [],
    maintenance_tips: [],
    required_tools_or_parts: [],
    actions: unsafeEscalation || specificTechnical ? ['Escalate safely'] : outOfScopeRefusal ? ['Ask a BMEDIS equipment-management question'] : [],
    insights: [],
    recommendations: [],
    entities_referenced: [],
    follow_up_suggestions: [],
    proactive_signals: [],
    routing_explanation: [],
    evidence_used: [],
    links: [],
    limitations: [],
    data_freshness: undefined,
    source_tables: [],
    action_drafts: [],
    intelligence_mode: 'standard',
    escalation_recommendation: decision === 'escalate' ? STANDARD_RESPONSES.escalate : undefined,
    escalation_guidance: decision === 'escalate' ? STANDARD_RESPONSES.escalate : undefined,
    reason_for_limit: reason,
    answer_basis: 'insufficient_data',
    confidence: 'low',
    escalation_required: decision === 'escalate',
  };
}

interface OrchestrateParams {
  supabase: SupabaseClient;
  sessionId: string;
  message: string;
  profile: UserChatProfile;
  contextRefs?: ChatContextRefs;
  moduleContext?: ChatModuleContext;
}

export async function orchestrateAssistantResponse(params: OrchestrateParams): Promise<OrchestratorResult> {
  const startedAt = Date.now();
  const { supabase, sessionId, message, profile, contextRefs, moduleContext } = params;
  const initialMemory = await loadConversationMemory(supabase, sessionId);
  const rawClassified = classifyChatRequest(message, {
    activeCapability: initialMemory.activeCapability,
    threadIntent: initialMemory.threadIntent,
  });
  const rawCapability = normalizeCapabilityId(rawClassified.capability);
  const classified = withPageAwareCapability({
    classified: rawClassified,
    capability: rawCapability,
    moduleContext,
    contextRefs,
    message,
  });
  const capability = normalizeCapabilityId(classified.capability);
  const effectiveClassified = { ...classified, capability };
  const capabilityDef = getCapabilityDefinition(capability);
  const resolution = await resolveEntitiesDetailed({
    supabase,
    message,
    contextRefs,
    moduleContext,
    memory: initialMemory,
    profile,
  });
  const resolvedEntities = resolution.resolved;
  const entityWarnings: EntityResolutionWarning[] = resolution.warnings;
  const memory = await loadConversationMemory(supabase, sessionId, resolvedEntities);
  const taskContext = await buildTaskContext({
    supabase,
    capability,
    profile,
    message,
    moduleContext,
    classified: effectiveClassified,
    contextRefs: {
      equipmentId: contextRefs?.equipmentId ?? resolvedEntities.find((entity) => entity.type === 'equipment')?.id,
      workOrderId: contextRefs?.workOrderId ?? resolvedEntities.find((entity) => entity.type === 'work_order')?.id,
      departmentId: contextRefs?.departmentId ?? resolvedEntities.find((entity) => entity.type === 'department')?.id,
    },
  });
  const safety = evaluateSafetyDecision(message, effectiveClassified, profile, taskContext.evidence);

  if (debugProviderFlowEnabled()) {
    console.info('[chatbot][provider-flow]', {
      event: 'orchestrator_after_safety',
      capability: classified.capability,
      intent: classified.intent,
      safetyBlocked: safety.blocked,
      safetyDecision: safety.decision,
    });
  }

  if (safety.blocked) {
    if (debugProviderFlowEnabled()) {
      console.info('[chatbot][provider-flow]', {
        event: 'provider_skipped',
        reason: 'safety_blocked',
        decision: safety.decision,
      });
    }
    const blockedAssistant = buildBlockedAssistantContent(safety.decision, safety.reason, {
      policyAlternative: safety.policyAlternative,
      safeChecks: safety.safeChecks,
      policyTags: safety.policyTags,
    });
    const blockedSummary = blockedAssistant.summary;
    await logCopilotTelemetry(supabase, {
      sessionId,
      query: message,
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: safety.decision,
      blocked: true,
      fallbackReason: classified.fallbackReason,
      roleNames: profile.roleNames,
      moduleLabel: moduleContext?.moduleLabel,
      route: moduleContext?.route ?? moduleContext?.pathname,
      evidenceSignals: taskContext.evidence.evidenceSignals,
      groundedBy: taskContext.evidence.evidenceSignals.length ? 'live_data' : 'general_fallback',
      classifierCandidates: classified.candidates,
      resolvedEntities,
      latencyMs: Date.now() - startedAt,
      metadata: {
        classified,
        capabilityDefinition: capabilityDef,
        policyCategory: safety.policyCategory,
        policyReason: safety.reason,
        troubleshootingSubtype: classified.troubleshootingSubtype,
        intelligenceMode: 'standard',
        answerType: 'blocked',
        toolTrace: taskContext.blocks.toolTrace,
      },
    });
    await persistConversationMemory(supabase, {
      ...memory,
      shortSummary: buildRollingMemorySummary(memory.shortSummary, {
        userMessage: message,
        blockedSummary: blockedSummary,
      }),
      focus: capability,
      activeCapability: capability,
      threadIntent: classified.intent,
      lastEntities: resolvedEntities,
    });

    return {
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: safety.decision,
      blocked: true,
      fallbackReason: classified.fallbackReason,
      assistant: blockedAssistant,
      evidence: taskContext.evidence,
      classified,
      memory,
      resolvedEntities,
      policyReason: safety.reason,
    };
  }

  // Build a lightweight follow-up memory context from the persisted memory
  // snapshot. Phase 3 follow-up handlers ("why?", "explain simply",
  // "where did you get that?", "what if I ignore it?", "is that safe?",
  // "what happens next?") use it to anchor on the previous turn rather than
  // treating each short prompt as a fresh question. Evidence / source-tables
  // are not currently persisted across turns, so the handler degrades
  // honestly when they are absent.
  const lastAssistantTurn = [...(memory.recentTurns ?? [])].reverse().find((turn) => turn.role === 'assistant');
  const lastAssistantContent = lastAssistantTurn?.content ?? '';
  const followUpMemory = {
    shortSummary: memory.shortSummary,
    activeCapability: memory.activeCapability,
    lastEntityLabels: (memory.lastEntities ?? []).map((e) => e.label).filter(Boolean),
    lastSummary: lastAssistantContent || undefined,
    lastTitle: undefined,
    lastEvidenceUsed: undefined,
    lastSourceTables: undefined,
    lastDataFreshness: undefined,
    lastDataMode: undefined,
    hadActionDraft: false,
  };

  const deterministicCandidate = buildDeterministicAnswerCandidate({
    capability,
    decision: safety.decision,
    profile,
    message,
    classified: effectiveClassified,
    contextRefs,
    moduleContext,
    blocks: taskContext.blocks,
    evidence: taskContext.evidence,
    followUpMemory,
  });
  const promptContextBlocks = deterministicCandidate
    ? {
        ...taskContext.blocks,
        deterministicAnswerDraft: deterministicAnswerForPrompt(deterministicCandidate),
      }
    : taskContext.blocks;

  if (!shouldUseProvider({ capability, message, responseMode: capabilityDef.responseMode })) {
    const localAssistant = ensureUiSafeAssistant(buildDeterministicAssistantIntro(), safety.decision);
    const localResponse =
      capability === 'assistant_intro'
        ? localAssistant
        : deterministicCandidate
          ? ensureUiSafeAssistant(deterministicCandidate, safety.decision)
        : ensureUiSafeAssistant(
            {
              ...localAssistant,
              decision: safety.decision === 'refuse' || safety.decision === 'escalate' ? 'limited_answer' : safety.decision,
              title: capability === 'unsafe_or_restricted' ? 'Safety Restriction' : localAssistant.title,
              summary:
                capability === 'unsafe_or_restricted'
                  ? safety.reason
                  : "I can help with BMEDIS operations like tasks, work orders, equipment summaries, notifications, and safe troubleshooting.",
              answer_basis: capability === 'unsafe_or_restricted' ? 'insufficient_data' : 'system_capabilities',
              confidence: capability === 'unsafe_or_restricted' ? 'low' : 'high',
            },
            safety.decision
          );
    await logCopilotTelemetry(supabase, {
      sessionId,
      query: message,
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: localResponse.decision,
      blocked: false,
      fallbackReason: classified.fallbackReason,
      roleNames: profile.roleNames,
      moduleLabel: moduleContext?.moduleLabel,
      route: moduleContext?.route ?? moduleContext?.pathname,
      evidenceSignals: taskContext.evidence.evidenceSignals,
      groundedBy: 'general_fallback',
      classifierCandidates: classified.candidates,
      resolvedEntities,
      latencyMs: Date.now() - startedAt,
      metadata: {
        providerSkipped: true,
        skipReason: 'local_deterministic_assistant_intro',
        capabilityDefinition: capabilityDef,
      },
    });
    await persistConversationMemory(supabase, {
      ...memory,
      shortSummary: buildRollingMemorySummary(memory.shortSummary, {
        userMessage: message,
        assistant: localResponse,
      }),
      focus: capability,
      activeCapability: capability,
      threadIntent: classified.intent,
      lastEntities: resolvedEntities,
    });
    return {
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: localResponse.decision,
      blocked: false,
      fallbackReason: classified.fallbackReason,
      assistant: localResponse,
      evidence: taskContext.evidence,
      classified,
      memory,
      resolvedEntities,
      provider: undefined,
      model: undefined,
      providerMetadata: { providerSkipped: true, skipReason: 'local_deterministic_assistant_intro' },
      policyReason: safety.reason,
    };
  }

  const prompt = buildPromptPayload({
    message,
    intent: classified.intent,
    capability: classified.capability,
    confidenceLabel: classified.confidenceLabel,
    confidenceScore: classified.confidence,
    decision: safety.decision,
    evidence: taskContext.evidence,
    contextBlocks: promptContextBlocks,
    memory,
    resolvedEntities,
    safetyMode: classified.fallbackReason ? 'fallback' : 'normal',
    classified,
    moduleContext,
    profile,
    responseMode: capabilityDef.responseMode,
  });

  const usageBeforeProvider = await getOwnCopilotUsageSnapshot(supabase, profile.profileId);
  if (usageBeforeProvider.hardLimited) {
    const limitedAssistant = ensureUiSafeAssistant(
      deterministicCandidate
        ? {
            ...deterministicCandidate,
            decision: 'limited_answer',
            limitations: [
              ...(deterministicCandidate.limitations ?? []),
              'Gemini was not called because the configured app usage limit is active.',
            ],
            reason_for_limit: usageBeforeProvider.warning ?? 'Configured copilot hard limit is enabled.',
          }
        : {
            ...buildAiUnavailableAssistant('limited_answer'),
            title: 'AI usage limit reached',
            summary: 'AI usage for today has reached the configured app limit. System data was not sent to Gemini.',
            reason_for_limit: usageBeforeProvider.warning ?? 'Configured copilot hard limit is enabled.',
            answer_basis: 'insufficient_data',
            confidence: 'low',
          },
      'limited_answer'
    );
    return {
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: 'limited_answer',
      blocked: false,
      fallbackReason: 'insufficient_context',
      assistant: limitedAssistant,
      evidence: taskContext.evidence,
      classified,
      memory,
      resolvedEntities,
      provider: undefined,
      model: undefined,
      providerMetadata: { usageHardLimited: true, usageBeforeProvider },
      policyReason: usageBeforeProvider.warning ?? 'Configured copilot hard limit is enabled.',
    };
  }

  try {
    if (debugProviderFlowEnabled()) {
      console.info('[chatbot][provider-flow]', {
        event: 'provider_call_start',
        provider: 'gemini',
        systemPromptChars: prompt.systemPrompt.length,
        userPromptChars: prompt.userPrompt.length,
      });
    }

    const providerResult = await generateAssistantContent({
      messages: [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: prompt.userPrompt },
      ],
      requiredDecision: safety.decision,
      intent: classified.intent,
      responseMode: capabilityDef.responseMode,
      capability,
    });

    if (debugProviderFlowEnabled()) {
      const parser = providerResult.providerMetadata?.parser as { usedFallback?: boolean } | undefined;
      console.info('[chatbot][provider-flow]', {
        event: 'provider_call_completed',
        model: providerResult.model,
        parserUsedFallback: Boolean(parser?.usedFallback),
        emptyModelContent: (providerResult.providerMetadata as { emptyModelContent?: boolean } | undefined)
          ?.emptyModelContent,
        assistantSummaryChars: providerResult.assistant.summary?.length ?? 0,
      });
    }

    const providerFallback = Boolean(
      (providerResult.providerMetadata as { providerFallback?: boolean } | undefined)?.providerFallback
    );
    if (providerFallback) {
      console.warn('[chatbot][provider-flow]', {
        event: 'provider_fallback_assistant_used',
        fallbackCopy: 'ai_unavailable',
        model: providerResult.model,
      });
    }

    const parser = providerResult.providerMetadata?.parser as
      | { usedFallback?: boolean; parserStrategy?: string; parserRecoveryUsed?: boolean; parserFailureReason?: string | null }
      | undefined;
    const parserRecoveryUsed =
      Boolean(parser?.parserRecoveryUsed) || Boolean(parser?.usedFallback) || parser?.parserStrategy === 'format_recovery';
    const contextBlocksAvailable = hasUsableStructuredContext(taskContext.blocks, taskContext.evidence);
    const toolTraceAvailable = Array.isArray(taskContext.blocks.toolTrace) && taskContext.blocks.toolTrace.length > 0;
    let deterministicContextFallbackUsed = false;

    const mergedAssistant = {
      ...providerResult.assistant,
      answer_basis: providerResult.assistant.answer_basis ?? safety.answerBasis,
      confidence: providerResult.assistant.confidence ?? safety.confidence,
      escalation_required: providerResult.assistant.escalation_required || safety.escalationRequired,
      escalation_guidance:
        providerResult.assistant.escalation_guidance ??
        providerResult.assistant.escalation_recommendation ??
        (providerResult.assistant.escalation_required ? STANDARD_RESPONSES.escalate : undefined),
      actions: providerResult.assistant.actions ?? [],
      insights: providerResult.assistant.insights ?? [],
      recommendations: providerResult.assistant.recommendations ?? [],
    };

    const finalAssistant = enrichAssistantPayload({
      assistant: mergedAssistant,
      blocks: taskContext.blocks,
      classified,
      capability,
      evidence: taskContext.evidence,
      moduleContext,
    });
    let scopedAssistant = enforceOffTopicRedirect(finalAssistant, capability);
    if (capabilityDef.responseMode === 'structured' && contextBlocksAvailable && (parserRecoveryUsed || providerFallback)) {
      scopedAssistant =
        deterministicCandidate ??
        buildDeterministicStructuredFallback({
          capability,
          decision: safety.decision,
          blocks: taskContext.blocks,
          evidence: taskContext.evidence,
        });
      deterministicContextFallbackUsed = true;
    }

    const effectiveProviderStatus = providerFallback && !deterministicContextFallbackUsed ? 'failure' : 'success';
    const enhancedProviderMetadata = {
      ...(providerResult.providerMetadata ?? {}),
      parserRecoveryUsed,
      deterministicContextFallbackUsed,
      contextBlocksAvailable,
      toolTraceAvailable,
    };

    const normalizedAssistant = normalizeAssistantResponse({
      rawProviderContent: scopedAssistant,
      capability,
      responseMode: capabilityDef.responseMode,
      providerStatus: effectiveProviderStatus,
      requiredDecision: safety.decision,
      fallbackReason: providerFallback ? 'provider_failure' : classified.fallbackReason,
    }).assistant;
    const guardedAssistant = applyResponseUsefulnessGuard({
      assistant: normalizedAssistant,
      deterministic: deterministicCandidate,
      capability,
      evidenceAvailable: contextBlocksAvailable || Boolean(deterministicCandidate?.evidence_used.length),
      providerFallback,
      parserRecoveryUsed,
    });
    const verifiedAssistant = verifyAssistantClaimsAgainstEvidence({
      assistant: guardedAssistant,
      deterministic: deterministicCandidate,
      evidence: taskContext.evidence,
      contextBlocks: taskContext.blocks,
      profile,
    });
    const claimVerifiedAssistant = verifiedAssistant.assistant;
    const entityWarningLimitations = entityWarnings.length
      ? Array.from(
          new Set(
            entityWarnings
              .map((w) => w.detail ?? null)
              .filter((d): d is string => Boolean(d))
          )
        )
      : [];
    const claimWithEntityWarnings: AssistantContent =
      entityWarningLimitations.length === 0
        ? claimVerifiedAssistant
        : {
            ...claimVerifiedAssistant,
            limitations: Array.from(
              new Set([...(claimVerifiedAssistant.limitations ?? []), ...entityWarningLimitations])
            ).slice(0, 8),
          };
    const formalTrace = taskContext.blocks.formalToolTrace as { selectedTools?: unknown } | undefined;
    const selectedFormalTools = Array.isArray(formalTrace?.selectedTools)
      ? (formalTrace.selectedTools as unknown[]).map((tool) => String(tool)).filter(Boolean).slice(0, 8)
      : [];
    const developerDebugRouting = profile.roleNames.includes('developer')
      ? [
          `Provider: ${providerResult.provider}${providerResult.model ? ` (${providerResult.model})` : ''}`,
          `Parser recovery: ${parserRecoveryUsed ? 'yes' : 'no'}`,
          `Provider fallback: ${providerFallback ? 'yes' : 'no'}`,
          selectedFormalTools.length ? `Tools: ${selectedFormalTools.join(', ')}` : '',
        ].filter(Boolean)
      : [];
    const actionDrafts = buildActionDraftsFromContext({
      profile,
      capability,
      message,
      moduleContext,
      contextRefs: {
        equipmentId: contextRefs?.equipmentId ?? resolvedEntities.find((entity) => entity.type === 'equipment')?.id,
        workOrderId: contextRefs?.workOrderId ?? resolvedEntities.find((entity) => entity.type === 'work_order')?.id,
        departmentId: contextRefs?.departmentId ?? resolvedEntities.find((entity) => entity.type === 'department')?.id,
      },
      evidenceSignals: taskContext.evidence.evidenceSignals,
    });
    const claimDebugLines =
      verifiedAssistant.unsupportedClaims.length > 0 && profile.roleNames.includes('developer')
        ? [`Claim verification removed: ${verifiedAssistant.unsupportedClaims.slice(0, 6).join(', ')}`]
        : [];
    const safeAssistant: AssistantContent = ensureUiSafeAssistant(
      {
        ...claimWithEntityWarnings,
        routing_explanation: [
          ...(claimWithEntityWarnings.routing_explanation ?? []),
          ...developerDebugRouting,
          ...claimDebugLines,
        ].slice(0, 12),
        action_drafts: actionDrafts,
      },
      safety.decision
    );
    const responseFallbackReason = providerFallback && !deterministicContextFallbackUsed ? 'provider_failure' : classified.fallbackReason;

    await logCopilotTelemetry(supabase, {
      sessionId,
      query: message,
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: safeAssistant.decision,
      blocked: false,
      fallbackReason: responseFallbackReason,
      roleNames: profile.roleNames,
      moduleLabel: moduleContext?.moduleLabel,
      route: moduleContext?.route ?? moduleContext?.pathname,
      evidenceSignals: taskContext.evidence.evidenceSignals,
      groundedBy: taskContext.evidence.evidenceSignals.length ? 'live_data' : 'general_fallback',
      parsingRecoveryUsed: parserRecoveryUsed,
      classifierCandidates: classified.candidates,
      resolvedEntities,
      latencyMs: Date.now() - startedAt,
      metadata: {
        provider: providerResult.provider,
        model: providerResult.model,
        providerMetadata: enhancedProviderMetadata,
        capabilityDefinition: capabilityDef,
        troubleshootingSubtype: classified.troubleshootingSubtype,
        intelligenceMode: safeAssistant.intelligence_mode,
        answerType: deriveAnswerType(safeAssistant),
        emptyModelContent: (providerResult.providerMetadata as { emptyModelContent?: boolean } | undefined)
          ?.emptyModelContent,
        providerFallback,
        parserRecoveryUsed,
        deterministicContextFallbackUsed,
        contextBlocksAvailable,
        toolTraceAvailable,
        toolTrace: taskContext.blocks.toolTrace,
      },
    });
    await logCopilotUsageEvent({
      supabase,
      profile,
      sessionId,
      provider: providerResult.provider,
      model: providerResult.model,
      capability,
      route: moduleContext?.route ?? moduleContext?.pathname ?? null,
      promptChars: prompt.systemPrompt.length + prompt.userPrompt.length,
      completionChars: providerResult.assistant.summary?.length ?? 0,
      providerStatus: providerFallback ? (deterministicContextFallbackUsed ? 'fallback' : 'failure') : 'success',
      fallbackReason: responseFallbackReason ?? null,
      latencyMs: Date.now() - startedAt,
      providerMetadata: enhancedProviderMetadata,
    });
    await persistConversationMemory(supabase, {
      ...memory,
      shortSummary: buildRollingMemorySummary(memory.shortSummary, {
        userMessage: message,
        assistant: safeAssistant,
      }),
      focus: capability,
      activeCapability: capability,
      threadIntent: classified.intent,
      lastEntities: resolvedEntities,
    });

    return {
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: safeAssistant.decision,
      blocked: false,
      fallbackReason: responseFallbackReason,
      assistant: safeAssistant,
      evidence: taskContext.evidence,
      classified,
      memory,
      resolvedEntities,
      provider: providerResult.provider,
      model: providerResult.model,
      providerMetadata: enhancedProviderMetadata,
      policyReason: safety.reason,
    };
  } catch (error) {
    if (debugProviderFlowEnabled()) {
      console.info('[chatbot][provider-flow]', {
        event: 'provider_call_failed',
        errorType: error instanceof Error ? error.name : 'unknown',
        errorMessagePreview: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      });
    }
    console.error('[chatbot][provider-flow]', {
      event: 'orchestrator_provider_fallback',
      fallbackCopy: 'ai_unavailable',
      errorPreview: (error instanceof Error ? error.message : String(error)).slice(0, 200),
    });
    const fallbackAssistant = ensureUiSafeAssistant(
      deterministicCandidate
        ? {
            ...deterministicCandidate,
            decision: safety.decision === 'answer' ? 'limited_answer' : safety.decision,
            limitations: [
              ...(deterministicCandidate.limitations ?? []),
              'Gemini did not complete; this answer used available BMEDIS system context instead.',
            ],
            reason_for_limit: 'Provider call did not complete; deterministic system-data fallback used.',
          }
        : buildAiUnavailableAssistant(safety.decision),
      safety.decision
    );
    await logCopilotTelemetry(supabase, {
      sessionId,
      query: message,
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: fallbackAssistant.decision,
      blocked: false,
      fallbackReason: 'provider_failure',
      roleNames: profile.roleNames,
      moduleLabel: moduleContext?.moduleLabel,
      route: moduleContext?.route ?? moduleContext?.pathname,
      evidenceSignals: taskContext.evidence.evidenceSignals,
      groundedBy: 'general_fallback',
      classifierCandidates: classified.candidates,
      resolvedEntities,
      latencyMs: Date.now() - startedAt,
      metadata: {
        error: error instanceof Error ? error.message : String(error),
        capabilityDefinition: capabilityDef,
        troubleshootingSubtype: classified.troubleshootingSubtype,
        answerType: 'provider_error',
        orchestratorFallback: true,
      },
    });
    await logCopilotUsageEvent({
      supabase,
      profile,
      sessionId,
      provider: 'gemini',
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
      capability,
      route: moduleContext?.route ?? moduleContext?.pathname ?? null,
      promptChars: prompt.systemPrompt.length + prompt.userPrompt.length,
      completionChars: fallbackAssistant.summary.length,
      providerStatus: 'failure',
      fallbackReason: 'provider_failure',
      latencyMs: Date.now() - startedAt,
      providerMetadata: { orchestratorFallback: true, error: error instanceof Error ? error.message : String(error) },
    });

    await persistConversationMemory(supabase, {
      ...memory,
      shortSummary: buildRollingMemorySummary(memory.shortSummary, {
        userMessage: message,
        assistant: fallbackAssistant,
      }),
      focus: capability,
      activeCapability: capability,
      threadIntent: classified.intent,
      lastEntities: resolvedEntities,
    });

    return {
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: fallbackAssistant.decision,
      blocked: false,
      fallbackReason: 'provider_failure',
      assistant: fallbackAssistant,
      evidence: taskContext.evidence,
      classified,
      memory,
      resolvedEntities,
      policyReason: error instanceof Error ? error.message : String(error),
    };
  }
}
