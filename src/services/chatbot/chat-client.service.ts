'use client';

import { createClient } from '@/lib/supabase/client';
import type { ChatContextRefs, ChatModuleContext, ChatResponse } from '@/types/chatbot';

export interface ChatSessionListItem {
  id: string;
  title: string;
  created_at: string;
  updated_at?: string;
  last_message_at?: string;
}

export interface PersistedChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  decision: string | null;
  answer_basis: string | null;
  confidence: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface SelectorOption {
  value: string;
  label: string;
}

export async function listChatSessions(limit = 20) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('id, title, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[chatbot] failed to load chat sessions', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }
    return { data: [] as ChatSessionListItem[], error };
  }

  const sessions: ChatSessionListItem[] = (data ?? []).map((row) => ({
    id: row.id as string,
    title: (row.title as string) || 'Untitled session',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string | undefined,
    last_message_at: (row.updated_at as string | null) ?? (row.created_at as string),
  }));

  return { data: sessions, error: null };
}

export async function listChatMessages(sessionId: string) {
  const supabase = createClient();
  return supabase
    .from('chat_messages')
    .select('id, role, content, decision, answer_basis, confidence, created_at, metadata')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
}

export async function deleteChatSession(sessionId: string) {
  const supabase = createClient();
  return supabase
    .from('chat_sessions')
    .delete()
    .eq('id', sessionId);
}

export async function deleteAllChatSessions() {
  const supabase = createClient();
  const { data: sessions, error: listError } = await supabase
    .from('chat_sessions')
    .select('id');

  if (listError) {
    return { error: listError, count: 0 };
  }

  const ids = (sessions ?? []).map((row) => row.id as string).filter(Boolean);
  if (ids.length === 0) {
    return { error: null, count: 0 };
  }

  const { error } = await supabase
    .from('chat_sessions')
    .delete()
    .in('id', ids);

  return { error, count: ids.length };
}

export async function sendChatMessage(payload: {
  message: string;
  sessionId?: string;
  contextRefs?: ChatContextRefs;
  moduleContext?: ChatModuleContext;
}) {
  const preparedPayload = prepareChatRequestPayload(payload);
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preparedPayload),
  });

  const rawText = await response.text();
  const json = (() => {
    try {
      return JSON.parse(rawText) as ChatResponse | { error?: string; message?: string };
    } catch {
      return null;
    }
  })();

  if (!json) {
    throw new Error('The assistant response could not be displayed safely. Please try again.');
  }

  if (!response.ok) {
    const errorMessage = ('error' in json && typeof json.error === 'string' && json.error) || ('message' in json && typeof json.message === 'string' && json.message) || 'Chat request failed';
    throw new Error(errorMessage);
  }

  if (!('sessionId' in json) || typeof json.sessionId !== 'string') {
    throw new Error('Chat response missing session identifier.');
  }

  return json as ChatResponse;
}

function cleanContextRefs(contextRefs?: ChatContextRefs) {
  if (!contextRefs) return undefined;
  const cleaned: ChatContextRefs = {
    equipmentId: contextRefs.equipmentId || undefined,
    workOrderId: contextRefs.workOrderId || undefined,
    departmentId: contextRefs.departmentId || undefined,
    organizationUnitId: contextRefs.organizationUnitId || undefined,
  };
  if (!cleaned.equipmentId && !cleaned.workOrderId && !cleaned.departmentId && !cleaned.organizationUnitId) {
    return undefined;
  }
  return cleaned;
}

function cleanModuleContext(moduleContext?: ChatModuleContext) {
  if (!moduleContext) return undefined;
  const cleaned: ChatModuleContext = {
    moduleLabel: moduleContext.moduleLabel?.trim() || undefined,
    pathname: moduleContext.pathname?.trim() || undefined,
    route: moduleContext.route?.trim() || undefined,
    pageLabel: moduleContext.pageLabel?.trim() || undefined,
    currentFilters: moduleContext.currentFilters,
  };
  if (!cleaned.moduleLabel && !cleaned.pathname && !cleaned.route && !cleaned.pageLabel && !cleaned.currentFilters) {
    return undefined;
  }
  return cleaned;
}

export function prepareChatRequestPayload(payload: {
  message: string;
  sessionId?: string;
  contextRefs?: ChatContextRefs;
  moduleContext?: ChatModuleContext;
}) {
  return {
    message: payload.message.trim(),
    sessionId: payload.sessionId || undefined,
    contextRefs: cleanContextRefs(payload.contextRefs),
    moduleContext: cleanModuleContext(payload.moduleContext),
  };
}

export async function getEquipmentSelectorOptions() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('equipment_assets')
    .select('id, asset_code, name')
    .is('deleted_at', null)
    .order('name', { ascending: true })
    .limit(100);
  if (error) return { data: [] as SelectorOption[], error };

  return {
    data: (data ?? []).map((item) => ({
      value: item.id as string,
      label: `${item.asset_code as string} - ${item.name as string}`,
    })),
    error: null,
  };
}

export async function getWorkOrderSelectorOptions() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('work_orders')
    .select('id, work_order_number')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return { data: [] as SelectorOption[], error };
  return {
    data: (data ?? []).map((item) => ({
      value: item.id as string,
      label: item.work_order_number as string,
    })),
    error: null,
  };
}

export async function getDepartmentSelectorOptions() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('departments')
    .select('id, name, code')
    .order('name', { ascending: true });
  if (error) return { data: [] as SelectorOption[], error };
  return {
    data: (data ?? []).map((item) => ({
      value: item.id as string,
      label: `${item.name as string} (${item.code as string})`,
    })),
    error: null,
  };
}
