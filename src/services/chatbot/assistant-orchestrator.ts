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
import { resolveEntities } from './entity-resolution-service';
import { buildTaskContext } from './task-context-service';
import { evaluateSafetyDecision, STANDARD_RESPONSES } from './safety-service';
import { buildPromptPayload } from './prompt-service';
import { generateAssistantContent } from './llm-service';
import { buildAiUnavailableAssistant, ensureUiSafeAssistant } from './providers/normalize-provider-output';
import { logCopilotTelemetry } from './telemetry-service';
import { getCapabilityDefinition, normalizeCapabilityId } from './capability-registry';

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
  if (capability === 'alerts_and_escalations') return 'synthesis' as const;
  if (capability === 'assistant_intro') return 'standard' as const;
  return 'standard' as const;
}

function shouldAttachProactiveSignals(capability: CapabilityId) {
  if (capability === 'assistant_intro') return false;
  if (capability === 'general_system_fallback' || capability === 'general_fallback') return false;
  return true;
}

export function shouldUseProvider(params: { capability: CapabilityId; message: string }) {
  if (params.capability === 'assistant_intro') return false;
  if (params.capability === 'general_system_fallback') {
    if (
      /\b(hi|hello|hey|help|what can you help|what can you do|introduce yourself|how can you help)\b/i.test(
        params.message
      )
    ) {
      return false;
    }
  }
  return true;
}

export function buildDeterministicAssistantIntro(): AssistantContent {
  return {
    decision: 'answer',
    title: 'BMERMS Assistant',
    summary:
      "Hello, I’m your BMERMS biomedical equipment management copilot. I can help you understand tasks, work orders, equipment status, preventive maintenance, calibration, logistics, alerts, decision support, and safe first-line troubleshooting.",
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
      'What alerts need attention?',
      'What should I check first if this monitor is not powering on?',
    ],
    proactive_signals: [],
    routing_explanation: [],
    escalation_required: false,
  };
}

function enrichAssistantPayload(params: {
  assistant: AssistantContent;
  blocks: Record<string, unknown>;
  classified: ClassifiedRequest;
  capability: CapabilityId;
}): AssistantContent {
  const { assistant, blocks, classified, capability } = params;
  const fromBlocks =
    shouldAttachProactiveSignals(capability) && Array.isArray(blocks.proactiveSignals)
      ? (blocks.proactiveSignals as string[])
      : [];
  const mergedProactive = [...new Set([...fromBlocks, ...(assistant.proactive_signals ?? [])])].slice(0, 5);
  const routing = buildRoutingExplanation(classified);
  const routingEcho =
    capability === 'assistant_intro' ? [] : assistant.routing_explanation?.length ? assistant.routing_explanation : routing;
  return {
    ...assistant,
    proactive_signals: mergedProactive,
    routing_explanation: routingEcho.slice(0, 8),
    intelligence_mode: assistant.intelligence_mode ?? defaultIntelligenceMode(capability),
  };
}

function buildBlockedAssistantContent(decision: ChatDecision, reason: string): AssistantContent {
  return {
    decision,
    title: decision === 'refuse' ? 'Request outside safe scope' : 'Limited operational guidance',
    summary: reason,
    key_findings: [],
    recommended_actions: [],
    priority_reasoning: [],
    likely_causes: [],
    troubleshooting_steps: [],
    maintenance_tips: [],
    required_tools_or_parts: [],
    actions: [],
    insights: [],
    recommendations: [],
    entities_referenced: [],
    follow_up_suggestions: [],
    proactive_signals: [],
    routing_explanation: [],
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
  const capability = normalizeCapabilityId(rawClassified.capability);
  const classified = { ...rawClassified, capability };
  const capabilityDef = getCapabilityDefinition(capability);
  const resolvedEntities = await resolveEntities({
    supabase,
    message,
    contextRefs,
    moduleContext,
    memory: initialMemory,
    profile,
  });
  const memory = await loadConversationMemory(supabase, sessionId, resolvedEntities);
  const taskContext = await buildTaskContext({
    supabase,
    capability,
    profile,
    message,
    moduleContext,
    classified,
    contextRefs: {
      equipmentId: contextRefs?.equipmentId ?? resolvedEntities.find((entity) => entity.type === 'equipment')?.id,
      workOrderId: contextRefs?.workOrderId ?? resolvedEntities.find((entity) => entity.type === 'work_order')?.id,
      departmentId: contextRefs?.departmentId ?? resolvedEntities.find((entity) => entity.type === 'department')?.id,
    },
  });
  const safety = evaluateSafetyDecision(message, classified, profile, taskContext.evidence);

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
    const blockedAssistant = buildBlockedAssistantContent(safety.decision, safety.reason);
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

  if (!shouldUseProvider({ capability, message })) {
    const localAssistant = ensureUiSafeAssistant(buildDeterministicAssistantIntro(), safety.decision);
    await logCopilotTelemetry(supabase, {
      sessionId,
      query: message,
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: localAssistant.decision,
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
        assistant: localAssistant,
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
      decision: localAssistant.decision,
      blocked: false,
      fallbackReason: classified.fallbackReason,
      assistant: localAssistant,
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
    contextBlocks: taskContext.blocks,
    memory,
    resolvedEntities,
    safetyMode: classified.fallbackReason ? 'fallback' : 'normal',
    classified,
    moduleContext,
    profile,
  });

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
    });

    const safeAssistant = ensureUiSafeAssistant(finalAssistant, safety.decision);
    const responseFallbackReason = providerFallback ? 'provider_failure' : classified.fallbackReason;

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
      parsingRecoveryUsed:
        providerFallback ||
        Boolean((providerResult.providerMetadata?.parser as { usedFallback?: boolean } | undefined)?.usedFallback),
      classifierCandidates: classified.candidates,
      resolvedEntities,
      latencyMs: Date.now() - startedAt,
      metadata: {
        provider: providerResult.provider,
        model: providerResult.model,
        providerMetadata: providerResult.providerMetadata ?? null,
        capabilityDefinition: capabilityDef,
        troubleshootingSubtype: classified.troubleshootingSubtype,
        intelligenceMode: safeAssistant.intelligence_mode,
        answerType: deriveAnswerType(safeAssistant),
        emptyModelContent: (providerResult.providerMetadata as { emptyModelContent?: boolean } | undefined)
          ?.emptyModelContent,
        providerFallback,
        toolTrace: taskContext.blocks.toolTrace,
      },
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
      providerMetadata: providerResult.providerMetadata,
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
    const fallbackAssistant = ensureUiSafeAssistant(buildAiUnavailableAssistant(safety.decision), safety.decision);
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
