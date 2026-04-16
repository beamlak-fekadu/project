import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type AssistantContent,
  type ChatContextRefs,
  type ChatDecision,
  type ChatModuleContext,
  type OrchestratorResult,
  type UserChatProfile,
} from '@/types/chatbot';
import { classifyChatRequest } from './classifier-service';
import { loadConversationMemory, persistConversationMemory } from './conversation-memory-service';
import { resolveEntities } from './entity-resolution-service';
import { buildTaskContext } from './task-context-service';
import { evaluateSafetyDecision, STANDARD_RESPONSES } from './safety-service';
import { buildPromptPayload } from './prompt-service';
import { generateAssistantContent } from './llm-service';
import { logCopilotTelemetry } from './telemetry-service';

function buildBlockedAssistantContent(decision: ChatDecision, reason: string): AssistantContent {
  return {
    decision,
    summary: reason,
    likely_causes: [],
    troubleshooting_steps: [],
    maintenance_tips: [],
    required_tools_or_parts: [],
    actions: [],
    insights: [],
    recommendations: [],
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
  const { supabase, sessionId, message, profile, contextRefs, moduleContext } = params;
  const classified = classifyChatRequest(message);
  const initialMemory = await loadConversationMemory(supabase, sessionId);
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
    capability: classified.capability,
    profile,
    contextRefs: {
      equipmentId: contextRefs?.equipmentId ?? resolvedEntities.find((entity) => entity.type === 'equipment')?.id,
      workOrderId: contextRefs?.workOrderId ?? resolvedEntities.find((entity) => entity.type === 'work_order')?.id,
      departmentId: contextRefs?.departmentId ?? resolvedEntities.find((entity) => entity.type === 'department')?.id,
    },
  });
  const safety = evaluateSafetyDecision(message, classified, profile, taskContext.evidence);

  if (safety.blocked) {
    const blockedAssistant = buildBlockedAssistantContent(safety.decision, safety.reason);
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
      evidenceSignals: taskContext.evidence.evidenceSignals,
      metadata: {
        classified,
        policyCategory: safety.policyCategory,
        policyReason: safety.reason,
      },
    });
    await persistConversationMemory(supabase, {
      ...memory,
      focus: classified.capability,
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
  });

  try {
    const providerResult = await generateAssistantContent({
      messages: [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: prompt.userPrompt },
      ],
      requiredDecision: safety.decision,
      intent: classified.intent,
    });

    const finalAssistant: AssistantContent = {
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

    await logCopilotTelemetry(supabase, {
      sessionId,
      query: message,
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: finalAssistant.decision,
      blocked: false,
      fallbackReason: classified.fallbackReason,
      roleNames: profile.roleNames,
      moduleLabel: moduleContext?.moduleLabel,
      evidenceSignals: taskContext.evidence.evidenceSignals,
      metadata: {
        provider: providerResult.provider,
        model: providerResult.model,
        providerMetadata: providerResult.providerMetadata ?? null,
      },
    });
    await persistConversationMemory(supabase, {
      ...memory,
      focus: classified.capability,
      lastEntities: resolvedEntities,
    });

    return {
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: finalAssistant.decision,
      blocked: false,
      fallbackReason: classified.fallbackReason,
      assistant: finalAssistant,
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
    const fallbackAssistant = buildBlockedAssistantContent('check_manual', STANDARD_RESPONSES.checkManual);
    await logCopilotTelemetry(supabase, {
      sessionId,
      query: message,
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: fallbackAssistant.decision,
      blocked: true,
      fallbackReason: 'provider_failure',
      roleNames: profile.roleNames,
      moduleLabel: moduleContext?.moduleLabel,
      evidenceSignals: taskContext.evidence.evidenceSignals,
      metadata: {
        error: error instanceof Error ? error.message : String(error),
      },
    });

    return {
      intent: classified.intent,
      capability: classified.capability,
      confidenceScore: classified.confidence,
      confidenceLabel: classified.confidenceLabel,
      decision: fallbackAssistant.decision,
      blocked: true,
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
