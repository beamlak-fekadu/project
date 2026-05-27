import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { orchestrateAssistantResponse } from '@/services/chatbot/assistant-orchestrator';
import { ChatRequestSchema, ChatResponseSchema, type ChatDecision, type UserChatProfile } from '@/types/chatbot';
import { getOwnCopilotUsageSnapshot } from '@/services/chatbot/usage-service';

function debugPolicyLogsEnabled() {
  return (process.env.CHAT_DEBUG_POLICY ?? '').toLowerCase() === 'true';
}

function debugProviderFlowEnabled() {
  return (process.env.CHAT_DEBUG_PROVIDER_FLOW ?? '').toLowerCase() === 'true';
}

function shouldExposeCopilotDebug(profile: UserChatProfile) {
  return (
    process.env.NODE_ENV !== 'production' ||
    debugProviderFlowEnabled() ||
    profile.roleNames.includes('developer')
  );
}

async function getUserChatProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, user: null, profile: null };

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, department_id, full_name, departments(name)')
    .eq('user_id', user.id)
    .single();

  if (!profile) return { supabase, user, profile: null };

  const { data: userRoles } = await supabase
    .from('user_roles')
    .select('roles(name, permissions)')
    .eq('user_id', profile.id);

  const roleNames = (userRoles ?? [])
    .map((row: Record<string, unknown>) => (row.roles as { name?: string } | null)?.name)
    .filter(Boolean) as string[];
  const permissions = (userRoles ?? [])
    .flatMap((row: Record<string, unknown>) => {
      const rolePermissions = (row.roles as { permissions?: unknown } | null)?.permissions;
      return Array.isArray(rolePermissions) ? rolePermissions.filter((item) => typeof item === 'string') : [];
    }) as string[];

  const departmentRow = profile.departments as { name?: string } | null | undefined;
  const chatProfile: UserChatProfile = {
    profileId: profile.id,
    userId: user.id,
    displayName: (profile.full_name as string | undefined) ?? user.email ?? 'User',
    roleNames: roleNames.length ? roleNames : ['viewer'],
    departmentId: profile.department_id as string | null,
    departmentName: typeof departmentRow?.name === 'string' ? departmentRow.name : null,
    permissions,
  };

  return { supabase, user, profile: chatProfile };
}

async function ensureChatSession(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  profileId: string;
  sessionId?: string;
  messagePreview: string;
  contextRefs?: { equipmentId?: string; workOrderId?: string; departmentId?: string };
}) {
  const { supabase, profileId, sessionId, messagePreview, contextRefs } = params;

  if (sessionId) {
    const { data: existing } = await supabase
      .from('chat_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', profileId)
      .maybeSingle();
    if (existing?.id) return existing.id as string;
  }

  const title = messagePreview.slice(0, 80);
  const { data: created, error } = await supabase
    .from('chat_sessions')
    .insert({
      user_id: profileId,
      title,
      asset_id: contextRefs?.equipmentId ?? null,
      work_order_id: contextRefs?.workOrderId ?? null,
      department_id: contextRefs?.departmentId ?? null,
    })
    .select('id')
    .single();

  if (error || !created) {
    throw new Error('Failed to create chat session');
  }

  return created.id as string;
}

async function insertChatMessage(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  decision?: ChatDecision;
  intent?: string;
  answerBasis?: string;
  confidence?: string;
  metadata?: Record<string, unknown>;
}) {
  const { supabase, ...payload } = params;
  const { error } = await supabase.from('chat_messages').insert({
    session_id: payload.sessionId,
    role: payload.role,
    content: payload.content,
    decision: payload.decision ?? null,
    intent: payload.intent ?? null,
    answer_basis: payload.answerBasis ?? null,
    confidence: payload.confidence ?? null,
    metadata: payload.metadata ?? null,
  });

  if (error) {
    console.error('[chatbot] chat_messages insert failed', { error: error.message });
  }
}

function getTopLevelBodyKeys(rawBody: unknown): string[] {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) return [];
  return Object.keys(rawBody as Record<string, unknown>).slice(0, 20);
}

function buildInvalidPayloadResponse(rawBody: unknown) {
  const maybeSessionId =
    rawBody && typeof rawBody === 'object' && typeof (rawBody as { sessionId?: unknown }).sessionId === 'string'
      ? (rawBody as { sessionId?: string }).sessionId
      : undefined;
  const validSessionId =
    maybeSessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(maybeSessionId)
      ? maybeSessionId
      : crypto.randomUUID();

  return ChatResponseSchema.parse({
    sessionId: validSessionId,
    intent: 'assistant_intro',
    capability: 'general_system_fallback',
    decision: 'limited_answer',
    blocked: false,
    confidenceScore: 0,
    fallbackReason: 'insufficient_context',
    assistant: {
      decision: 'limited_answer',
      title: 'Request format issue',
      summary: 'Invalid chat request format. Please refresh and try again.',
      key_findings: [],
      recommended_actions: [],
      priority_reasoning: [],
      likely_causes: [],
      troubleshooting_steps: [],
      maintenance_tips: [],
      required_tools_or_parts: [],
      reason_for_limit: 'Client request payload did not match the /api/chat contract.',
      answer_basis: 'insufficient_data',
      confidence: 'low',
      escalation_required: false,
      actions: ['Refresh the page and retry the message.'],
      insights: [],
      recommendations: ['If this keeps happening, reopen the assistant panel and start a new chat session.'],
      entities_referenced: [],
      follow_up_suggestions: ['hi', 'what can you help me with?', "what's on my to-do?"],
      proactive_signals: [],
      routing_explanation: ['Request failed schema validation at /api/chat.'],
      evidence_used: [],
      links: [],
      limitations: ['Client request payload did not match the /api/chat contract.'],
      data_freshness: undefined,
      source_tables: [],
      action_drafts: [],
    },
  });
}

export async function POST(request: Request) {
  const { supabase, user, profile } = await getUserChatProfile();

  if (!user || !profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawBody = await request.json().catch(() => null);

  if (debugProviderFlowEnabled()) {
    const body = rawBody as { message?: string; sessionId?: string; contextRefs?: unknown } | null;
    const msg = typeof body?.message === 'string' ? body.message : '';
    console.info('[chatbot][provider-flow]', {
      event: 'chat_route_entered',
      bodyKeys: getTopLevelBodyKeys(rawBody),
      userIdPresent: true,
      profileIdPresent: true,
      messageLength: msg.length,
      hasSessionId: Boolean(body?.sessionId),
      hasContextRefs: Boolean(body?.contextRefs),
    });
  }
  const parsed = ChatRequestSchema.safeParse(rawBody);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      code: issue.code,
      message: issue.message,
    }));
    console.warn('[chatbot] request validation failed', {
      bodyKeys: getTopLevelBodyKeys(rawBody),
      issues,
    });
    const fallback = buildInvalidPayloadResponse(rawBody);
    return NextResponse.json(fallback, { status: 200 });
  }

  const { message, sessionId, contextRefs } = parsed.data;
  const moduleContext = parsed.data.moduleContext;

  if (debugPolicyLogsEnabled()) {
    console.info('[chatbot] inbound request', {
      hasContextRefs: Boolean(contextRefs),
      moduleContext: moduleContext ?? null,
    });
  }

  const session = await ensureChatSession({
    supabase,
    profileId: profile.profileId,
    sessionId,
    messagePreview: message,
    contextRefs,
  });

  await insertChatMessage({
    supabase,
    sessionId: session,
    role: 'user',
    content: message,
    intent: undefined,
    metadata: {
      contextRefs: contextRefs ?? null,
      moduleContext: moduleContext ?? null,
    },
  });

  const orchestrated = await orchestrateAssistantResponse({
    supabase,
    sessionId: session,
    message,
    profile,
    contextRefs,
    moduleContext,
  });

  if (debugProviderFlowEnabled()) {
    console.info('[chatbot][provider-flow]', {
      event: 'chat_route_orchestrator_done',
      blocked: orchestrated.blocked,
      fallbackReason: orchestrated.fallbackReason ?? null,
      provider: orchestrated.provider ?? null,
      assistantDecision: orchestrated.assistant.decision,
    });
  }

  if (debugPolicyLogsEnabled()) {
    console.info('[chatbot] orchestrator decision', {
      intent: orchestrated.intent,
      capability: orchestrated.capability,
      confidenceScore: orchestrated.confidenceScore,
      confidenceLabel: orchestrated.confidenceLabel,
      decision: orchestrated.decision,
      blocked: orchestrated.blocked,
      fallbackReason: orchestrated.fallbackReason ?? null,
    });
  }

  await insertChatMessage({
    supabase,
    sessionId: session,
    role: 'assistant',
    content: orchestrated.assistant.summary,
    decision: orchestrated.assistant.decision,
    intent: orchestrated.intent,
    answerBasis: orchestrated.assistant.answer_basis,
    confidence: orchestrated.assistant.confidence,
    metadata: {
      blocked: orchestrated.blocked,
      capability: orchestrated.capability,
      confidenceScore: orchestrated.confidenceScore,
      confidenceLabel: orchestrated.confidenceLabel,
      fallbackReason: orchestrated.fallbackReason ?? null,
      policyReason: orchestrated.policyReason ?? null,
      provider: orchestrated.provider ?? null,
      providerModel: orchestrated.model ?? null,
      providerMetadata: orchestrated.providerMetadata ?? null,
      resolvedEntities: orchestrated.resolvedEntities,
      evidenceSignals: orchestrated.evidence.evidenceSignals,
      evidenceCompleteness: orchestrated.evidence.evidenceCompleteness ?? null,
      assistant: orchestrated.assistant,
    },
  });

  const responsePayload = ChatResponseSchema.parse({
    sessionId: session,
    intent: orchestrated.intent,
    capability: orchestrated.capability,
    decision: orchestrated.assistant.decision,
    blocked: orchestrated.blocked,
    confidenceScore: orchestrated.confidenceScore,
    fallbackReason: orchestrated.fallbackReason,
    assistant: orchestrated.assistant,
    usageStatus: await getOwnCopilotUsageSnapshot(supabase, profile.profileId),
    _debug: shouldExposeCopilotDebug(profile) ? orchestrated.debugMetadata : undefined,
  });

  return NextResponse.json(responsePayload, { status: 200 });
}

export async function GET() {
  const { supabase, user, profile } = await getUserChatProfile();
  if (!user || !profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await getOwnCopilotUsageSnapshot(supabase, profile.profileId), { status: 200 });
}
