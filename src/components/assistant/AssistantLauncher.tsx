'use client';

import { Bot } from 'lucide-react';
import { useAssistantContext } from './AssistantProvider';
import { ASSISTANT_NAME } from '@/constants';

export function AssistantLauncher() {
  const { isOpen, openAssistant } = useAssistantContext();

  if (isOpen) return null;

  return (
    <button
      onClick={() => openAssistant()}
      className="assistant-launcher inline-flex items-center gap-2 rounded-xl border border-[var(--assistant-accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--surface-2)]"
      aria-label={`Open ${ASSISTANT_NAME}`}
    >
      <Bot className="h-4 w-4 text-[var(--assistant-accent)]" />
      Ask Assistant
    </button>
  );
}
