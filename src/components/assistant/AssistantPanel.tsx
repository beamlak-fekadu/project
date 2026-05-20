'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Bot, MessageSquareText, Plus, Send, X } from 'lucide-react';
import { Button, EmptyState, Textarea } from '@/components/ui';
import LottiePlayer, { LOTTIE_PATHS } from '@/components/ui/LottiePlayer';
import { Loader2 } from 'lucide-react';
import { useDrawerA11y } from '@/hooks/useDrawerA11y';
import { AnimatePresence, motion } from 'framer-motion';
import { cardItem, cardStagger, slideUp, transitions } from '@/lib/ui/motion-presets';
import { AssistantContextChips } from './AssistantContextChips';
import { AssistantMessageCard } from './AssistantMessageCard';
import { useAssistantContext } from './AssistantProvider';
import { ASSISTANT_NAME } from '@/constants';
import { useRole } from '@/hooks/useRole';

function formatApproxTokens(tokens: number) {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return String(tokens);
}

const QUICK_PROMPTS_BY_MODULE: Record<string, string[]> = {
  Equipment: [
    'Summarize this equipment status and history.',
    'What safe first-line checks should I do first?',
  ],
  Maintenance: [
    'Summarize this work order and suggest next safe steps.',
    'Generate concise closure notes for technician handoff.',
  ],
  'Preventive Maintenance': [
    'Explain the overdue PM concerns and likely impact.',
    'Generate PM tips for this equipment category.',
  ],
  Logistics: [
    'Explain possible stockout risks and next steps.',
    'Summarize spare-parts issues affecting maintenance.',
  ],
  'Decision Support': [
    'Explain why this item is high risk or high priority.',
    'Explain MTTR/MTBF and replacement priority in practical terms.',
  ],
  Reporting: ['Summarize key operational trends from this module.'],
  Operations: ['What should I check first based on current operations context?'],
};

const QUICK_PROMPTS_BY_ROLE: Record<string, string[]> = {
  developer: [
    'Explain why this metric is 0.',
    'Which table/view feeds this card?',
    'Show failed offline sync conflicts.',
    'Check QR coverage issues.',
    'Run Gemini smoke test.',
    'Review copilot telemetry.',
    'Why was my last prompt classified this way?',
  ],
  admin: [
    'What should I prioritize today?',
    'Which equipment is blocking clinical service?',
    'Which departments are least ready?',
    'Which PM/calibration items are urgent?',
    'Prepare a concise operations summary.',
  ],
  bme_head: [
    'What should I prioritize today?',
    'Which equipment is blocking clinical service?',
    'Which departments are least ready?',
    'Which PM/calibration items are urgent?',
    'Which replacement risks need management attention?',
  ],
  technician: [
    'What is assigned to me?',
    'Summarize this asset before inspection.',
    'What safe first-line checks should I do?',
    'What parts may be needed?',
    'What should I escalate?',
  ],
  store_user: [
    'Which parts are stocked out?',
    'Which stockouts are blocking work?',
    'What reorder drafts should I prepare?',
    'What deliveries are expected?',
    'Which issued parts need usage linkage?',
  ],
  department_head: [
    'Which equipment in my department is unavailable?',
    'What requests are pending in my department?',
    'Which work orders are delayed?',
    'Which compliance issues need attention?',
    'Prepare a department readiness summary.',
  ],
  department_user: [
    'Help me report this equipment problem.',
    'Track my department requests.',
    'Which devices in my department are down?',
    'Request calibration for this asset.',
    'Request training for this equipment.',
  ],
  viewer: [
    'Summarize hospital readiness.',
    'Explain top management risks.',
    'Which departments need attention?',
    'Summarize replacement pressure.',
    'Prepare management report notes.',
  ],
};

export function AssistantPanel() {
  const {
    isOpen,
    sending,
    draftInput,
    messages,
    usageStatus,
    moduleLabel,
    pageQuickPrompts,
    selectedEntityContext,
    registeredPageContext,
    closeAssistant,
    sendMessage,
    setDraftInput,
    contextRefs,
    clearContextRefs,
    startNewSession,
  } = useAssistantContext();
  const { primaryRole } = useRole();
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const quickPrompts = useMemo(
    () => {
      const rolePrompts = QUICK_PROMPTS_BY_ROLE[primaryRole] ?? QUICK_PROMPTS_BY_ROLE.viewer;
      const modulePrompts = QUICK_PROMPTS_BY_MODULE[moduleLabel] ?? QUICK_PROMPTS_BY_MODULE.Operations;
      return Array.from(new Set([...pageQuickPrompts, ...rolePrompts, ...modulePrompts])).slice(0, 7);
    },
    [moduleLabel, pageQuickPrompts, primaryRole]
  );

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  const onInputKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = async (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    await sendMessage();
  };

  // The panel is mounted-but-translated rather than conditionally rendered,
  // so we pass `isOpen` to the hook so focus management activates only when
  // the user has actually opened the assistant. `disableAutoFocus` is true
  // because the panel manages its own input focus via the Textarea below.
  const panelRef = useDrawerA11y(isOpen, closeAssistant, { disableAutoFocus: true });

  return (
    <>
      <div
        className={`fixed inset-0 z-[81] bg-black/40 transition-opacity ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={closeAssistant}
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Assistant"
        className={`assistant-panel fixed bottom-0 right-0 top-0 z-[82] w-full max-w-xl transform border-l border-[var(--border-subtle)] transition-transform duration-200 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ height: '100dvh' }}
      >
        <div className="assistant-panel-surface flex h-full min-h-0 flex-col text-[var(--foreground)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--assistant-accent-soft)] px-3 py-3 sm:px-4">
            <div className="inline-flex min-w-0 items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-[var(--assistant-accent)]" />
              <p className="truncate text-sm font-semibold">{ASSISTANT_NAME}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <Button variant="ghost" size="sm" onClick={startNewSession} className="px-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New chat</span>
              </Button>
              <Button variant="ghost" size="icon" onClick={closeAssistant} aria-label="Close assistant">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="border-b border-[var(--border-subtle)] px-3 py-3 sm:px-4">
            <AssistantContextChips moduleLabel={moduleLabel} contextRefs={contextRefs} onClear={clearContextRefs} />
            {(selectedEntityContext || registeredPageContext?.pageSummary) && (
              <p className="mt-2 line-clamp-2 break-words text-xs text-[var(--text-muted)]">
                {selectedEntityContext ? `Context: ${selectedEntityContext}` : registeredPageContext?.pageSummary}
              </p>
            )}
          </div>

          <div ref={messagesRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-4">
            {messages.length === 0 ? (
              <EmptyState
                title="Ask for maintenance, PM, analytics, or troubleshooting help"
                description="The assistant is safety-gated and will refuse unsupported technical detail."
                icon={<Bot className="h-10 w-10 text-[var(--assistant-accent)]" />}
              />
            ) : (
              <AnimatePresence initial={false}>
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    variants={slideUp}
                    initial="initial"
                    animate="animate"
                    transition={transitions.fast}
                  >
                    <AssistantMessageCard message={message} />
                  </motion.div>
                ))}
              </AnimatePresence>
            )}

            <AnimatePresence>
              {sending && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={transitions.fast}
                  className="assistant-panel-surface rounded-2xl border border-[var(--assistant-accent-soft)] p-4"
                >
                  <div className="inline-flex items-center gap-3 text-sm text-[var(--text-muted)]">
                    <LottiePlayer
                      src={LOTTIE_PATHS.aiThinking}
                      style={{ width: 28, height: 28 }}
                      fallback={<Loader2 className="h-4 w-4 animate-spin" />}
                      ariaLabel="Assistant thinking"
                    />
                    Generating response…
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="shrink-0 space-y-3 border-t border-[var(--assistant-accent-soft)] px-3 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-4">
            {usageStatus && (
              <div className={`rounded-md border px-2 py-1 text-xs ${
                usageStatus.hardLimited
                  ? 'border-red-500/40 bg-red-500/10 text-red-200'
                  : usageStatus.warning
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                    : 'border-[var(--border-subtle)] text-[var(--text-muted)]'
              }`}>
                <p>
                  {usageStatus.warning ?? 'AI usage today'}: {usageStatus.requestsToday} requests · approx. {formatApproxTokens(usageStatus.tokensToday)} tokens
                  {' '}
                  <span className="opacity-70">({usageStatus.usageSource})</span>
                </p>
                {usageStatus.hardLimited ? (
                  <p className="mt-0.5">AI provider calls are paused until tomorrow. Deterministic local responses still work.</p>
                ) : null}
              </div>
            )}
            {!contextRefs && (
              <p className="text-xs text-[var(--text-muted)]">
                No entity linked yet. Responses will stay general until equipment, work-order, or department context is attached.
              </p>
            )}
            <motion.div
              variants={cardStagger}
              initial="initial"
              animate="animate"
              className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
            >
              {quickPrompts.map((prompt) => (
                <motion.button
                  key={prompt}
                  variants={cardItem}
                  onClick={() => setDraftInput(prompt)}
                  className="max-w-[78vw] shrink-0 rounded-full border border-[var(--assistant-accent-soft)] px-3 py-1.5 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] sm:max-w-none sm:shrink"
                >
                  {prompt}
                </motion.button>
              ))}
            </motion.div>
            <Textarea
              rows={3}
              value={draftInput}
              onChange={(event) => setDraftInput(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Ask anything about equipment, work orders, PM, calibration, stock, or troubleshooting..."
              className="border-[var(--border-subtle)] bg-[var(--assistant-surface-elev)]"
              disabled={sending}
            />
            <div className="flex justify-end">
              <Button onClick={() => void sendMessage()} loading={sending} disabled={!draftInput.trim() || sending}>
                <Send className="h-4 w-4" />
                Send
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
