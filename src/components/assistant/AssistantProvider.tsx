'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { sendChatMessage } from '@/services/chatbot/chat-client.service';
import type { AssistantContent, ChatContextRefs, ChatDecision } from '@/types/chatbot';
import { useToast } from '@/components/ui/Toast';
import { normalizeAssistantPayloadForUi } from '@/services/chatbot/chat-response-normalizer';
import { buildAiUnavailableAssistant } from '@/services/chatbot/providers/normalize-provider-output';

export interface AssistantUiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  assistant?: AssistantContent;
  /** Populated for assistant role when API returns routing metadata */
  intent?: string;
  capability?: string;
  fallbackReason?: string;
}

export interface AssistantLaunchOptions {
  moduleLabel?: string;
  contextRefs?: ChatContextRefs;
  seedPrompt?: string;
}

interface AssistantContextValue {
  isOpen: boolean;
  sending: boolean;
  draftInput: string;
  activeSessionId?: string;
  messages: AssistantUiMessage[];
  moduleLabel: string;
  contextRefs?: ChatContextRefs;
  openAssistant: (options?: AssistantLaunchOptions) => void;
  closeAssistant: () => void;
  sendMessage: (message?: string) => Promise<void>;
  setDraftInput: (value: string) => void;
  clearContextRefs: () => void;
  startNewSession: () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

function mapModuleFromPathname(pathname: string): string {
  if (pathname.startsWith('/inventory') || pathname.startsWith('/equipment')) return 'Equipment';
  if (pathname.startsWith('/maintenance') || pathname.startsWith('/work-orders') || pathname.startsWith('/requests')) return 'Maintenance';
  if (pathname.startsWith('/pm')) return 'Preventive Maintenance';
  if (pathname.startsWith('/calibration')) return 'Calibration';
  if (pathname.startsWith('/spare-parts') || pathname.startsWith('/logistics') || pathname.startsWith('/procurement')) return 'Logistics';
  if (pathname.startsWith('/analytics') || pathname.startsWith('/decision-support') || pathname.startsWith('/replacement')) return 'Decision Support';
  if (pathname.startsWith('/reports')) return 'Reporting';
  return 'Operations';
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [draftInput, setDraftInput] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<AssistantUiMessage[]>([]);
  const [contextRefs, setContextRefs] = useState<ChatContextRefs | undefined>();
  const routeModuleLabel = useMemo(() => mapModuleFromPathname(pathname), [pathname]);
  const [moduleLabel, setModuleLabel] = useState(routeModuleLabel);

  const openAssistant = (options?: AssistantLaunchOptions) => {
    setIsOpen(true);
    setModuleLabel(options?.moduleLabel ?? routeModuleLabel);
    if (options?.contextRefs) {
      setContextRefs(options.contextRefs);
    } else if (options) {
      setContextRefs(undefined);
    }
    if (options?.seedPrompt) {
      setDraftInput(options.seedPrompt);
    }
  };

  const closeAssistant = () => setIsOpen(false);

  const clearContextRefs = () => setContextRefs(undefined);

  const startNewSession = () => {
    setActiveSessionId(undefined);
    setMessages([]);
  };

  const sendMessage = async (message?: string) => {
    const text = (message ?? draftInput).trim();
    if (!text || sending) return;

    const userMessage: AssistantUiMessage = {
      id: `assistant-user-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setDraftInput('');
    setSending(true);

    try {
      const response = await sendChatMessage({
        message: text,
        sessionId: activeSessionId,
        contextRefs,
        moduleContext: {
          moduleLabel,
          pathname,
          route: pathname,
          pageLabel: moduleLabel,
        },
      });

      setActiveSessionId(response.sessionId);
      const assistantNormalized = normalizeAssistantPayloadForUi(
        response.assistant,
        undefined,
        response.assistant?.decision as ChatDecision | undefined
      );

      const assistantMessage: AssistantUiMessage = {
        id: `assistant-response-${Date.now()}`,
        role: 'assistant',
        content: assistantNormalized.summary,
        createdAt: new Date().toISOString(),
        assistant: assistantNormalized,
        intent: response.intent,
        capability: response.capability,
        fallbackReason: response.fallbackReason,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Unable to process assistant request');
      const fallbackAssistant = buildAiUnavailableAssistant('limited_answer');
      const assistantMessage: AssistantUiMessage = {
        id: `assistant-response-${Date.now()}`,
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

  return (
    <AssistantContext.Provider
      value={{
        isOpen,
        sending,
        draftInput,
        activeSessionId,
        messages,
        moduleLabel,
        contextRefs,
        openAssistant,
        closeAssistant,
        sendMessage,
        setDraftInput,
        clearContextRefs,
        startNewSession,
      }}
    >
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistantContext() {
  const context = useContext(AssistantContext);
  if (!context) {
    throw new Error('useAssistantContext must be used within AssistantProvider');
  }
  return context;
}
