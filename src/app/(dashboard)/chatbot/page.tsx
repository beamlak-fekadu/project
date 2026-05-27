'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Bot, MessageSquareText, Plus, Send, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import {
  getDepartmentSelectorOptions,
  deleteAllChatSessions,
  deleteChatSession,
  getEquipmentSelectorOptions,
  getWorkOrderSelectorOptions,
  listChatMessages,
  listChatSessions,
  sendChatMessage,
  type ChatSessionListItem,
  type PersistedChatMessage,
  type SelectorOption,
} from '@/services/chatbot/chat-client.service';
import type { AssistantContent, ChatContextRefs } from '@/types/chatbot';
import { normalizeAssistantPayloadForUi } from '@/services/chatbot/chat-response-normalizer';
import { buildAiUnavailableAssistant } from '@/services/chatbot/providers/normalize-provider-output';
import { CHATBOT_NAME, ASSISTANT_NAME } from '@/constants';
import { AssistantMessageCard } from '@/components/assistant/AssistantMessageCard';
import type { AssistantUiMessage } from '@/components/assistant/AssistantProvider';

type UIMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  assistant?: AssistantContent;
  intent?: string;
  capability?: string;
  fallbackReason?: string;
};

const QUICK_PROMPTS = [
  'Generate PM tips for infusion pumps in ICU.',
  'Troubleshoot this equipment safely before escalation.',
  'Summarize this work order into concise technician notes.',
  'Why is this equipment currently high risk?',
  'Show overdue PM concerns and likely operational impact.',
];

function mapPersistedMessage(row: PersistedChatMessage): UIMessage {
  const capability = typeof row.metadata?.capability === 'string' ? row.metadata.capability : undefined;
  const assistant = row.role === 'assistant'
    ? normalizeAssistantPayloadForUi(row.metadata?.assistant, row.content, undefined, capability)
    : undefined;

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    assistant,
    intent: row.intent ?? undefined,
    capability,
    fallbackReason: typeof row.metadata?.fallbackReason === 'string' ? row.metadata.fallbackReason : undefined,
  };
}

export default function ChatbotPage() {
  const { toast } = useToast();
  const pathname = usePathname();
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [clearingAllSessions, setClearingAllSessions] = useState(false);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);

  const [equipmentOptions, setEquipmentOptions] = useState<SelectorOption[]>([]);
  const [workOrderOptions, setWorkOrderOptions] = useState<SelectorOption[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<SelectorOption[]>([]);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState('');
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState('');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [input, setInput] = useState('');
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  const contextRefs = useMemo<ChatContextRefs | undefined>(() => {
    if (!selectedEquipmentId && !selectedWorkOrderId && !selectedDepartmentId) return undefined;
    return {
      equipmentId: selectedEquipmentId || undefined,
      workOrderId: selectedWorkOrderId || undefined,
      departmentId: selectedDepartmentId || undefined,
    };
  }, [selectedDepartmentId, selectedEquipmentId, selectedWorkOrderId]);

  const loadSessionsAndSelectors = useCallback(async () => {
      setLoadingSessions(true);
      setSessionLoadError(null);
      const [sessionRes, equipmentRes, workOrderRes, departmentRes] = await Promise.all([
        listChatSessions(),
        getEquipmentSelectorOptions(),
        getWorkOrderSelectorOptions(),
        getDepartmentSelectorOptions(),
      ]);

      if (sessionRes.error) {
        setSessionLoadError('Unable to load chat sessions');
        if (process.env.NODE_ENV !== 'production') {
          console.error('[chatbot] Unable to load chat sessions', sessionRes.error);
        }
      } else {
        const nextSessions = (sessionRes.data ?? []) as ChatSessionListItem[];
        setSessions(nextSessions);
        if (nextSessions.length > 0) setActiveSessionId(nextSessions[0].id);
        if (nextSessions.length === 0) setActiveSessionId(undefined);
      }

      setEquipmentOptions(equipmentRes.data);
      setWorkOrderOptions(workOrderRes.data);
      setDepartmentOptions(departmentRes.data);
      setLoadingSessions(false);
  }, []);

  useEffect(() => {
    async function bootstrap() {
      await loadSessionsAndSelectors();
    }
    void bootstrap();
  }, [loadSessionsAndSelectors]);

  useEffect(() => {
    async function loadMessages(sessionId: string) {
      setLoadingMessages(true);
      const { data, error } = await listChatMessages(sessionId);
      if (error) {
        toast('error', 'Unable to load chat history');
        setLoadingMessages(false);
        return;
      }
      const mapped = ((data ?? []) as PersistedChatMessage[]).map(mapPersistedMessage);
      setMessages(mapped);
      setLoadingMessages(false);
    }

    if (activeSessionId) {
      void loadMessages(activeSessionId);
    } else {
      setMessages([]);
    }
  }, [activeSessionId, toast]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const userMessage: UIMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSending(true);

    try {
      const payload = await sendChatMessage({
        message: trimmed,
        sessionId: activeSessionId,
        contextRefs,
        moduleContext: {
          moduleLabel: CHATBOT_NAME,
          pathname,
          route: pathname,
          pageLabel: CHATBOT_NAME,
        },
      });

      setActiveSessionId(payload.sessionId);

      const assistantNormalized = normalizeAssistantPayloadForUi(payload.assistant, undefined, undefined, payload.capability);
      const assistantMessage: UIMessage = {
        id: `local-assistant-${Date.now()}`,
        role: 'assistant',
        content: assistantNormalized.summary,
        createdAt: new Date().toISOString(),
        assistant: assistantNormalized,
        intent: payload.intent,
        capability: payload.capability,
        fallbackReason: payload.fallbackReason,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      const sessionsRes = await listChatSessions();
      if (!sessionsRes.error) {
        setSessions((sessionsRes.data ?? []) as ChatSessionListItem[]);
        setSessionLoadError(null);
      }
    } catch {
      toast('error', 'AI service is temporarily unavailable. The system data was not changed.');
      const fallbackAssistant = buildAiUnavailableAssistant('limited_answer');
      const assistantMessage: UIMessage = {
        id: `local-assistant-${Date.now()}`,
        role: 'assistant',
        content: fallbackAssistant.summary,
        createdAt: new Date().toISOString(),
        assistant: fallbackAssistant,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setSending(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (deletingSessionId || clearingAllSessions) return;
    const target = sessions.find((item) => item.id === sessionId);
    const confirmed = window.confirm(`Delete "${target?.title ?? 'this chat session'}" and all its messages?`);
    if (!confirmed) return;

    setDeletingSessionId(sessionId);
    const { error } = await deleteChatSession(sessionId);
    if (error) {
      toast('error', 'Unable to delete chat session');
      setDeletingSessionId(null);
      return;
    }

    const nextSessions = sessions.filter((item) => item.id !== sessionId);
    setSessions(nextSessions);
    if (activeSessionId === sessionId) {
      setActiveSessionId(nextSessions[0]?.id);
      if (nextSessions.length === 0) setMessages([]);
    }
    toast('success', 'Chat session deleted');
    setDeletingSessionId(null);
  };

  const handleDeleteAllSessions = async () => {
    if (clearingAllSessions || deletingSessionId) return;
    const confirmed = window.confirm('Delete all chat sessions and full message history? This cannot be undone.');
    if (!confirmed) return;

    setClearingAllSessions(true);
    const { error, count } = await deleteAllChatSessions();
    if (error) {
      toast('error', 'Unable to delete all chat sessions');
      setClearingAllSessions(false);
      return;
    }

    setSessions([]);
    setActiveSessionId(undefined);
    setMessages([]);
    toast('success', count > 0 ? `Deleted ${count} chat session${count === 1 ? '' : 's'}` : 'No chat sessions to delete');
    setClearingAllSessions(false);
  };

  const handleInputKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = async (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    await sendMessage();
  };

  const startFresh = () => {
    setActiveSessionId(undefined);
    setMessages([]);
  };

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-7xl flex-col gap-4">
      <PageHeader
        title={CHATBOT_NAME}
        description="Ask a grounded role-aware assistant about equipment, maintenance, PM, calibration, stock, procurement, reports, and safe next steps."
        actions={
          <Button variant="outline" size="sm" onClick={startFresh}>
            <Plus className="h-4 w-4" />
            New chat
          </Button>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="hidden min-h-0 overflow-hidden xl:flex xl:flex-col" padding={false}>
          <CardHeader className="border-b border-[var(--border-subtle)] p-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Recent Sessions</CardTitle>
              <Button
                size="sm"
                variant="ghost"
                disabled={loadingSessions || sessions.length === 0 || clearingAllSessions || !!deletingSessionId}
                loading={clearingAllSessions}
                onClick={handleDeleteAllSessions}
              >
                <Trash2 className="h-4 w-4" />
                Clear all
              </Button>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto p-2">
            {loadingSessions ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : sessionLoadError ? (
              <div className="space-y-3 px-3 py-6">
                <p className="text-sm text-[var(--text-muted)]">{sessionLoadError}</p>
                <Button size="sm" variant="outline" onClick={() => void loadSessionsAndSelectors()}>
                  Retry
                </Button>
              </div>
            ) : sessions.length === 0 ? (
              <p className="px-3 py-6 text-sm text-[var(--text-muted)]">No chat sessions yet. Start a new conversation.</p>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`group rounded-xl ${
                      activeSessionId === session.id
                        ? 'bg-[var(--brand)]/20 text-[var(--foreground)]'
                        : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    <button
                      onClick={() => setActiveSessionId(session.id)}
                      className="w-full px-3 py-2 text-left text-sm"
                    >
                      <div className="line-clamp-2 pr-8 font-medium">{session.title}</div>
                      <div className="mt-1 text-xs opacity-80">
                        {new Date(session.last_message_at ?? session.updated_at ?? session.created_at).toLocaleString()}
                      </div>
                    </button>
                    <div className="mt-[-34px] flex justify-end pr-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteSession(session.id);
                        }}
                        className="rounded-md p-1 text-[var(--text-muted)] opacity-60 transition hover:bg-[var(--surface-3)] hover:opacity-100"
                        aria-label={`Delete ${session.title}`}
                        disabled={clearingAllSessions || deletingSessionId === session.id}
                      >
                        {deletingSessionId === session.id ? <Spinner size="sm" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-[calc(100dvh-12rem)] flex-col overflow-hidden xl:min-h-0" padding={false}>
          <CardHeader className="border-b border-[var(--border-subtle)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="inline-flex items-center gap-2 text-base">
                <MessageSquareText className="h-4 w-4" />
                {ASSISTANT_NAME}
              </CardTitle>
              <div className="flex min-w-0 flex-wrap gap-2">
                <Select
                  label=""
                  options={equipmentOptions}
                  placeholder="Equipment context"
                  value={selectedEquipmentId}
                  onChange={(event) => setSelectedEquipmentId(event.target.value)}
                />
                <Select
                  label=""
                  options={workOrderOptions}
                  placeholder="Work order"
                  value={selectedWorkOrderId}
                  onChange={(event) => setSelectedWorkOrderId(event.target.value)}
                />
                <Select
                  label=""
                  options={departmentOptions}
                  placeholder="Department"
                  value={selectedDepartmentId}
                  onChange={(event) => setSelectedDepartmentId(event.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <div ref={messagesContainerRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-5">
              {loadingMessages ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : messages.length === 0 ? (
                <EmptyState
                  title="Start a scoped operations conversation"
                  description="Use natural language. The assistant will provide grounded support or safely redirect when evidence is not sufficient."
                  icon={<Bot className="h-12 w-12" />}
                />
              ) : (
                messages.map((message) => (
                  <AssistantMessageCard key={message.id} message={message as AssistantUiMessage} />
                ))
              )}

              {sending && (
                <div className="flex justify-start">
                  <div className="panel-surface-muted max-w-[75%] rounded-2xl border border-[var(--border-subtle)] p-4">
                    <div className="mb-2 inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <Bot className="h-4 w-4" />
                      Assistant
                    </div>
                    <div className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]">
                      <Spinner size="sm" />
                      Generating response...
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-auto space-y-3 border-t border-[var(--border-subtle)] bg-[var(--background)]/95 px-3 py-3 sm:px-5">
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2">
                <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => setInput(prompt)}
                      disabled={sending}
                      className="shrink-0 rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--foreground)]"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                <Textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Ask about equipment status, maintenance, troubleshooting, PM, work orders, calibration, logistics, and replacement priorities."
                  rows={2}
                  disabled={sending}
                  className="min-h-[84px] border-0 bg-transparent text-[var(--foreground)] shadow-none placeholder:text-[var(--text-muted)] focus:ring-0"
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    onClick={sendMessage}
                    loading={sending}
                    disabled={sending || !input.trim()}
                    className="min-w-[120px] shadow-sm"
                  >
                    <Send className="h-4 w-4" />
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
