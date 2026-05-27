import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssistantContent, ChatEvidence, ChatMessageRole, MemorySnapshot, ResolvedEntity } from '@/types/chatbot';

const MEMORY_TURN_LIMIT = 10;
const RECENT_TURN_SUMMARY_LIMIT = 6;

function inferFocusFromText(text: string) {
  const normalized = text.toLowerCase();
  if (normalized.includes('work order') || normalized.includes('wo-')) return 'work_order';
  if (normalized.includes('risk') || normalized.includes('rpn')) return 'risk';
  if (normalized.includes('pm') || normalized.includes('preventive maintenance')) return 'pm';
  if (normalized.includes('approval')) return 'approvals';
  if (normalized.includes('stock') || normalized.includes('parts') || normalized.includes('logistics')) return 'logistics';
  if (normalized.includes('bypass') || normalized.includes('safety') || normalized.includes('escalat')) return 'safety';
  if (/\b(hello|hi|hey|get started|what can you do)\b/.test(normalized) && normalized.length < 64) return 'onboarding';
  return 'operations';
}

export function buildRollingMemorySummary(
  prev: string,
  params: { userMessage: string; assistant?: AssistantContent | null; blockedSummary?: string }
) {
  if (params.blockedSummary) {
    return `${prev.slice(0, 400)} | Last note: ${params.blockedSummary.slice(0, 280)}`.slice(0, 900);
  }
  const assistant = params.assistant;
  const slice = assistant?.key_findings?.slice(0, 3).join(' · ') ?? assistant?.summary?.slice(0, 320) ?? '';
  if (!slice.trim()) return prev.slice(0, 900);
  return `Last focus: ${slice} | You asked: ${params.userMessage.slice(0, 160)} | Track for follow-up: equipment/wo/department from prior turns.`.slice(
    0,
    900
  );
}

function summarizeTurns(turns: Array<{ role: ChatMessageRole; content: string }>) {
  if (!turns.length) return 'No prior conversation context.';
  const sample = turns
    .slice(-RECENT_TURN_SUMMARY_LIMIT)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join(' | ');
  return sample.slice(0, 800);
}

function entityConfidence(entities: ResolvedEntity[]) {
  if (!entities.length) return 0;
  return Math.max(...entities.map((entity) => entity.confidence ?? 0.5));
}

function deriveMemoryConfidence(params: {
  entities: ResolvedEntity[];
  activeCapability?: MemorySnapshot['activeCapability'];
  ageTurns: number;
  evidenceCompleteness?: ChatEvidence['evidenceCompleteness'];
}): NonNullable<MemorySnapshot['memoryConfidence']> {
  const entityScore = entityConfidence(params.entities);
  const completenessScore = params.evidenceCompleteness?.score ?? 0.4;
  if (params.activeCapability && entityScore >= 0.8 && params.ageTurns <= 4 && completenessScore >= 0.6) return 'high';
  if (params.activeCapability && entityScore >= 0.55 && params.ageTurns <= 8) return 'medium';
  return 'low';
}

export async function loadConversationMemory(
  supabase: SupabaseClient,
  sessionId: string,
  fallbackEntities: ResolvedEntity[] = []
): Promise<MemorySnapshot> {
  const { data: messages } = await supabase
    .from('chat_messages')
    .select('role, content, metadata, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(MEMORY_TURN_LIMIT);

  const rawTurns = ((messages ?? []) as Array<{ role: ChatMessageRole; content: string; metadata?: Record<string, unknown> | null; created_at?: string | null }>)
    .reverse()
    .map((row) => ({
      role: row.role,
      content: row.content,
      metadata: row.metadata ?? null,
      created_at: row.created_at ?? null,
    }));
  const recentTurns = rawTurns.map((row) => ({ role: row.role, content: row.content }));
  const lastAssistantIndex = rawTurns.map((turn, index) => ({ turn, index })).reverse().find(({ turn }) => turn.role === 'assistant');
  const lastAssistantMetadata = lastAssistantIndex?.turn.metadata ?? null;
  const lastAssistant = lastAssistantMetadata && typeof lastAssistantMetadata === 'object' ? lastAssistantMetadata : {};
  const lastAssistantPayload = (lastAssistant as { assistant?: unknown }).assistant as AssistantContent | undefined;
  const metadataEntities = Array.isArray((lastAssistant as { resolvedEntities?: unknown }).resolvedEntities)
    ? ((lastAssistant as { resolvedEntities: ResolvedEntity[] }).resolvedEntities)
    : [];
  const memoryAgeTurns = lastAssistantIndex ? rawTurns.length - 1 - lastAssistantIndex.index : rawTurns.length;

  const shortSummary = summarizeTurns(recentTurns);
  const focusSeed = recentTurns.length ? recentTurns[recentTurns.length - 1].content : '';
  const focus = inferFocusFromText(focusSeed);

  let memoryRow:
    | { summary_text?: string; focus?: string; last_entities?: unknown; thread_intent?: string; active_capability?: string }
    | null = null;
  try {
    const { data } = await supabase
      .from('chat_session_memory')
      .select('summary_text, focus, last_entities, thread_intent, active_capability')
      .eq('session_id', sessionId)
      .maybeSingle()
      .throwOnError();
    memoryRow = data;
  } catch {
    memoryRow = null;
  }

  const persistedEntities = Array.isArray(memoryRow?.last_entities)
    ? (memoryRow.last_entities as ResolvedEntity[])
    : [];
  const lastEntities = persistedEntities.length ? persistedEntities : metadataEntities.length ? metadataEntities : fallbackEntities;
  const activeCapability =
    (memoryRow?.active_capability as MemorySnapshot['activeCapability']) ??
    ((lastAssistant as { capability?: MemorySnapshot['activeCapability'] }).capability);
  const threadIntent =
    (memoryRow?.thread_intent as MemorySnapshot['threadIntent']) ??
    ((lastAssistant as { intent?: MemorySnapshot['threadIntent'] }).intent);
  const lastEvidenceCompleteness = (lastAssistant as { evidenceCompleteness?: ChatEvidence['evidenceCompleteness'] }).evidenceCompleteness;
  const memoryConfidence = deriveMemoryConfidence({
    entities: lastEntities,
    activeCapability,
    ageTurns: memoryAgeTurns,
    evidenceCompleteness: lastEvidenceCompleteness,
  });

  return {
    sessionId,
    shortSummary: typeof memoryRow?.summary_text === 'string' && memoryRow.summary_text.trim() ? memoryRow.summary_text : shortSummary,
    focus: typeof memoryRow?.focus === 'string' && memoryRow.focus.trim() ? memoryRow.focus : focus,
    threadIntent,
    activeCapability,
    recentTurns,
    lastEntities,
    lastEvidenceUsed: lastAssistantPayload?.evidence_used,
    lastSourceTables: lastAssistantPayload?.source_tables,
    lastDataFreshness: lastAssistantPayload?.data_freshness,
    lastDataMode: lastAssistantPayload?.data_mode,
    lastAnswerBasis: lastAssistantPayload?.answer_basis,
    lastEvidenceCompleteness,
    memoryConfidence,
    memoryAgeTurns,
    lastTurnAt: lastAssistantIndex?.turn.created_at ?? undefined,
  };
}

export async function persistConversationMemory(
  supabase: SupabaseClient,
  snapshot: MemorySnapshot
) {
  try {
    await supabase
      .from('chat_session_memory')
      .upsert({
        session_id: snapshot.sessionId,
        summary_text: snapshot.shortSummary,
        focus: snapshot.focus,
        thread_intent: snapshot.threadIntent ?? null,
        active_capability: snapshot.activeCapability ?? null,
        last_entities: snapshot.lastEntities,
        updated_at: new Date().toISOString(),
      })
      .throwOnError();
  } catch {
    // Swallow errors to preserve chat continuity even if memory table is unavailable.
  }
}
