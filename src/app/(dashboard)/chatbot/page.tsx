'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Bot, ClipboardCopy, MessageSquareText, Send, UserCircle2 } from 'lucide-react';
import {
  Badge,
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

type UIMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  assistant?: AssistantContent;
};

const QUICK_PROMPTS = [
  'Generate PM tips for infusion pumps in ICU.',
  'Troubleshoot this equipment safely before escalation.',
  'Summarize this work order into concise technician notes.',
  'Why is this equipment currently high risk?',
  'Show overdue PM concerns and likely operational impact.',
];

const BASIS_BADGE_VARIANT: Record<string, 'default' | 'info' | 'purple' | 'warning'> = {
  system_data: 'info',
  manual_or_sop: 'purple',
  general_safe_guidance: 'default',
  insufficient_data: 'warning',
};

const CONFIDENCE_BADGE_VARIANT: Record<string, 'success' | 'warning' | 'error'> = {
  high: 'success',
  medium: 'warning',
  low: 'error',
};

function mapPersistedMessage(row: PersistedChatMessage): UIMessage {
  const assistant = row.role === 'assistant'
    ? normalizeAssistantPayloadForUi(row.metadata?.assistant, row.content)
    : undefined;

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    assistant,
  };
}

function sanitizeSummaryForRender(value: string | undefined) {
  const raw = (value ?? '').trim();
  if (!raw) return 'No summary available.';
  if (/^```|^\{/.test(raw)) return 'I generated a response but it could not be displayed reliably. Please try again.';
  return raw;
}

function buildCopyText(assistant: AssistantContent) {
  const kf = assistant.key_findings ?? [];
  const ra = assistant.recommended_actions ?? [];
  const pr = assistant.priority_reasoning ?? [];
  const lc = assistant.likely_causes ?? [];
  const ts = assistant.troubleshooting_steps ?? [];
  const mt = assistant.maintenance_tips ?? [];
  const rtp = assistant.required_tools_or_parts ?? [];
  const sections = [
    assistant.title ? `Title: ${assistant.title}` : '',
    `Summary: ${assistant.summary}`,
    kf.length ? `Key findings:\n- ${kf.join('\n- ')}` : '',
    ra.length ? `Recommended actions:\n- ${ra.join('\n- ')}` : '',
    pr.length ? `Priority reasoning:\n- ${pr.join('\n- ')}` : '',
    lc.length ? `Likely causes:\n- ${lc.join('\n- ')}` : '',
    ts.length ? `Troubleshooting steps:\n- ${ts.join('\n- ')}` : '',
    mt.length ? `Maintenance tips:\n- ${mt.join('\n- ')}` : '',
    rtp.length ? `Required tools or parts:\n- ${rtp.join('\n- ')}` : '',
    assistant.escalation_recommendation ? `Escalation recommendation: ${assistant.escalation_recommendation}` : '',
    assistant.intelligence_mode ? `Intelligence mode: ${assistant.intelligence_mode}` : '',
    assistant.proactive_signals?.length
      ? `Proactive signals:\n- ${assistant.proactive_signals.join('\n- ')}`
      : '',
    assistant.routing_explanation?.length
      ? `Routing:\n- ${assistant.routing_explanation.join('\n- ')}`
      : '',
  ].filter(Boolean);
  return sections.join('\n\n');
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

  useEffect(() => {
    async function bootstrap() {
      setLoadingSessions(true);
      const [sessionRes, equipmentRes, workOrderRes, departmentRes] = await Promise.all([
        listChatSessions(),
        getEquipmentSelectorOptions(),
        getWorkOrderSelectorOptions(),
        getDepartmentSelectorOptions(),
      ]);

      if (sessionRes.error) {
        toast('error', 'Unable to load chat sessions');
      } else {
        const nextSessions = (sessionRes.data ?? []) as ChatSessionListItem[];
        setSessions(nextSessions);
        if (nextSessions.length > 0) setActiveSessionId(nextSessions[0].id);
      }

      setEquipmentOptions(equipmentRes.data);
      setWorkOrderOptions(workOrderRes.data);
      setDepartmentOptions(departmentRes.data);
      setLoadingSessions(false);
    }

    void bootstrap();
  }, [toast]);

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

      const assistantNormalized = normalizeAssistantPayloadForUi(payload.assistant);
      const assistantMessage: UIMessage = {
        id: `local-assistant-${Date.now()}`,
        role: 'assistant',
        content: assistantNormalized.summary,
        createdAt: new Date().toISOString(),
        assistant: assistantNormalized,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      const sessionsRes = await listChatSessions();
      if (!sessionsRes.error) {
        setSessions((sessionsRes.data ?? []) as ChatSessionListItem[]);
      }
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Unable to process chatbot request');
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

  const handleInputKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = async (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    await sendMessage();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={CHATBOT_NAME}
        description="Ask about equipment status, maintenance, troubleshooting, PM, work orders, calibration, logistics, and replacement priorities."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px,1fr,340px]">
        <Card className="h-[calc(100vh-220px)] overflow-hidden" padding={false}>
          <CardHeader className="border-b border-[var(--border-subtle)] p-4">
            <CardTitle className="text-base">Recent Sessions</CardTitle>
          </CardHeader>
          <CardContent className="h-full overflow-y-auto p-2">
            {loadingSessions ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : sessions.length === 0 ? (
              <p className="px-3 py-6 text-sm text-[var(--text-muted)]">No prior chats yet.</p>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => setActiveSessionId(session.id)}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                      activeSessionId === session.id
                        ? 'bg-[var(--brand)]/20 text-[var(--foreground)]'
                        : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    <div className="line-clamp-2 font-medium">{session.title}</div>
                    <div className="mt-1 text-xs opacity-80">{new Date(session.created_at).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex h-[calc(100vh-220px)] flex-col overflow-hidden" padding={false}>
          <CardHeader className="border-b border-[var(--border-subtle)] p-4">
            <CardTitle className="inline-flex items-center gap-2 text-base">
              <MessageSquareText className="h-4 w-4" />
              {ASSISTANT_NAME}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4">
            <div ref={messagesContainerRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
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
                  <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl border border-[var(--border-subtle)] p-4 ${
                        message.role === 'user' ? 'bg-[var(--surface-2)]' : 'panel-surface-muted'
                      }`}
                    >
                      <div className="mb-2 inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
                        {message.role === 'user' ? <UserCircle2 className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                        {message.role === 'user' ? 'You' : 'Assistant'}
                      </div>

                      {message.assistant ? (
                        <div className="space-y-3 text-sm">
                          {message.assistant.title && <p className="font-semibold">{message.assistant.title}</p>}
                          <p>{sanitizeSummaryForRender(message.assistant.summary) || message.content || 'No summary available.'}</p>

                          {message.assistant.intelligence_mode && (
                            <Badge variant="info" className="text-xs capitalize">
                              Mode: {message.assistant.intelligence_mode.replace(/_/g, ' ')}
                            </Badge>
                          )}

                          {(message.assistant.proactive_signals?.length ?? 0) > 0 && (
                            <div>
                              <p className="mb-1 font-semibold">Operational signals</p>
                              <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
                                {message.assistant.proactive_signals!.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {(message.assistant.routing_explanation?.length ?? 0) > 0 && (
                            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-muted)]">
                              <p className="mb-1 font-semibold text-[var(--text-primary)]">Routing</p>
                              <ul className="list-disc space-y-1 pl-4">
                                {message.assistant.routing_explanation!.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {(message.assistant.key_findings ?? []).length > 0 && (
                            <div>
                              <p className="mb-1 font-semibold">Key findings</p>
                              <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
                                {(message.assistant.key_findings ?? []).map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {(message.assistant.recommended_actions ?? []).length > 0 && (
                            <div>
                              <p className="mb-1 font-semibold">Recommended actions</p>
                              <ol className="list-decimal space-y-1 pl-5 text-[var(--text-muted)]">
                                {(message.assistant.recommended_actions ?? []).map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ol>
                            </div>
                          )}

                          {(message.assistant.likely_causes ?? []).length > 0 && (
                            <div>
                              <p className="mb-1 font-semibold">Likely causes</p>
                              <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
                                {(message.assistant.likely_causes ?? []).map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {(message.assistant.troubleshooting_steps ?? []).length > 0 && (
                            <div>
                              <p className="mb-1 font-semibold">Troubleshooting steps</p>
                              <ol className="list-decimal space-y-1 pl-5 text-[var(--text-muted)]">
                                {(message.assistant.troubleshooting_steps ?? []).map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ol>
                            </div>
                          )}

                          {(message.assistant.maintenance_tips ?? []).length > 0 && (
                            <div>
                              <p className="mb-1 font-semibold">Maintenance tips</p>
                              <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
                                {(message.assistant.maintenance_tips ?? []).map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {(message.assistant.required_tools_or_parts ?? []).length > 0 && (
                            <div>
                              <p className="mb-1 font-semibold">Required tools or parts</p>
                              <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
                                {(message.assistant.required_tools_or_parts ?? []).map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {message.assistant.escalation_required && (
                            <div className="assistant-warning rounded-xl p-3">
                              <div className="assistant-warning-strong mb-1 inline-flex items-center gap-2 text-sm font-medium">
                                <AlertTriangle className="h-4 w-4" />
                                Escalation Recommended
                              </div>
                              <p className="text-sm">
                                {message.assistant.escalation_recommendation || 'Escalate to a qualified biomedical engineer or vendor.'}
                              </p>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Badge
                              variant={BASIS_BADGE_VARIANT[message.assistant.answer_basis ?? 'insufficient_data'] ?? 'default'}
                            >
                              Basis: {(message.assistant.answer_basis ?? 'insufficient_data').replace(/_/g, ' ')}
                            </Badge>
                            <Badge variant={CONFIDENCE_BADGE_VARIANT[message.assistant.confidence ?? 'low'] ?? 'warning'}>
                              Confidence: {message.assistant.confidence ?? 'low'}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={async () => {
                                if (!message.assistant) return;
                                await navigator.clipboard.writeText(buildCopyText(message.assistant));
                                toast('success', 'Response copied');
                              }}
                            >
                              <ClipboardCopy className="h-4 w-4" />
                              Copy
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm">{message.content}</p>
                      )}
                    </div>
                  </div>
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

            <div className="mt-auto space-y-3 border-t border-[var(--border-subtle)] bg-[var(--surface-1)] pt-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Select
                  label="Equipment"
                  options={equipmentOptions}
                  placeholder="Attach equipment context"
                  value={selectedEquipmentId}
                  onChange={(event) => setSelectedEquipmentId(event.target.value)}
                />
                <Select
                  label="Work Order"
                  options={workOrderOptions}
                  placeholder="Attach work order"
                  value={selectedWorkOrderId}
                  onChange={(event) => setSelectedWorkOrderId(event.target.value)}
                />
                <Select
                  label="Department"
                  options={departmentOptions}
                  placeholder="Attach department"
                  value={selectedDepartmentId}
                  onChange={(event) => setSelectedDepartmentId(event.target.value)}
                />
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-2">
                <div className="mb-2 flex flex-wrap gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => setInput(prompt)}
                      disabled={sending}
                      className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--foreground)]"
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
                  rows={3}
                  disabled={sending}
                  className="border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--foreground)] placeholder:text-[var(--text-muted)]"
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

        <Card className="h-[calc(100vh-220px)] overflow-hidden" padding={false}>
          <CardHeader className="border-b border-[var(--border-subtle)] p-4">
            <CardTitle className="text-base">Scope Guidance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 overflow-y-auto p-4 text-sm text-[var(--text-muted)]">
            <p className="font-medium text-[var(--foreground)]">This assistant is open in input but restricted in behavior.</p>
            <p>It prioritizes grounded system data, available manual/SOP context, and safe first-line guidance.</p>
            <p>If enough support is not available, it will return check-manual or escalation guidance instead of guessing.</p>
            <div className="panel-surface-muted rounded-xl border border-[var(--border-subtle)] p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--foreground)]">Supported domains</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Maintenance and PM support</li>
                <li>Safe troubleshooting guidance</li>
                <li>Work-order summary and drafting support</li>
                <li>Equipment, risk, and reliability explanations</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
