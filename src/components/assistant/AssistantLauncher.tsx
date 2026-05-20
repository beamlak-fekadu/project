'use client';

import { Bot } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAssistantContext } from './AssistantProvider';
import { ASSISTANT_NAME } from '@/constants';

export function AssistantLauncher() {
  const { isOpen, openAssistant } = useAssistantContext();
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (isOpen) return;
    let cancelled = false;
    let pulseTimer: number | undefined;
    function schedule() {
      const delay = 35_000 + Math.random() * 40_000;
      window.setTimeout(() => {
        if (cancelled) return;
        setPulsing(true);
        pulseTimer = window.setTimeout(() => {
          if (!cancelled) setPulsing(false);
        }, 2_200);
        schedule();
      }, delay);
    }
    schedule();
    return () => {
      cancelled = true;
      if (pulseTimer) window.clearTimeout(pulseTimer);
    };
  }, [isOpen]);

  if (isOpen) return null;

  return (
    <button
      onClick={() => openAssistant()}
      aria-label={`Open ${ASSISTANT_NAME}`}
      className={`assistant-launcher inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-full border border-[var(--assistant-accent-soft)] px-2 text-sm font-semibold text-[var(--foreground)] transition-shadow sm:h-9 sm:px-3 ${
        pulsing
          ? 'ring-2 ring-[var(--assistant-accent)] ring-offset-2 ring-offset-transparent shadow-[0_0_18px_var(--assistant-glow)]'
          : ''
      }`}
    >
      <Bot className="h-4 w-4 text-[var(--assistant-accent)]" />
      <span className="hidden sm:inline">Ask Assistant</span>
    </button>
  );
}
