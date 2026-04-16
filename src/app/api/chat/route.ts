import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { orchestrateAssistantResponse } from '@/services/chatbot/assistant-orchestrator';
import { ChatRequestSchema, ChatResponseSchema, type ChatDecision, type UserChatProfile } from '@/types/chatbot';

function debugPolicyLogsEnabled() {
  return (process.env.CHAT_DEBUG_POLICY ?? '').toLowerCase() === 'true';
}

async function getUserChatProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, user: null, profile: null };

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, department_id')
    .eq('user_id', user.id)
    .single();

  if (!profile) return { supabase, user, profile: null };

  const { data: userRoles } = await supabase
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', profile.id);

  const roleNames = (userRoles ?? [])
    .map((row: Record<string, unknown>) => (row.roles as { name?: string } | null)?.name)
    .filter(Boolean) as string[];

  const chatProfile: UserChatProfile = {
    profileId: profile.id,
    roleNames: roleNames.length ? roleNames : ['viewer'],
    departmentId: profile.department_id as string | null,
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
      equipment_id: contextRefs?.equipmentId ?? null,
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

export async function POST(request: Request) {
  const { supabase, user, profile } = await getUserChatProfile();

  if (!user || !profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload', details: parsed.error.flatten() }, { status: 400 });
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
  });

  return NextResponse.json(responsePayload, { status: 200 });
}
