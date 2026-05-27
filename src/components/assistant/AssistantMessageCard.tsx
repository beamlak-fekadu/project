'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, Bot, ChevronDown, ChevronRight, ClipboardCopy, ExternalLink, UserCircle2 } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import type { AssistantUiMessage } from './AssistantProvider';
import type { AssistantContent } from '@/types/chatbot';
import { useToast } from '@/components/ui/Toast';
import { ASSISTANT_NAME } from '@/constants';
import { buildAssistantCopyText, displayableAssistantSummary } from './assistant-ui-display';
import { normalizeAssistantPayloadForUi } from '@/services/chatbot/chat-response-normalizer';
import { CopilotActionCard } from './CopilotActionCard';
import { useRole } from '@/hooks/useRole';
import { getAssistantVisibleSections, safeAssistantList } from './assistant-message-sections';

const BASIS_BADGE_VARIANT: Record<string, 'default' | 'info' | 'purple' | 'warning'> = {
  system_data: 'info',
  manual_or_sop: 'purple',
  general_safe_guidance: 'default',
  insufficient_data: 'warning',
};

function buildEvidenceChips(assistant: AssistantContent): string[] {
  const evidence = safeAssistantList(assistant.evidence_used, 5);
  if (evidence.length > 0) return evidence;
  return safeAssistantList(assistant.entities_referenced as unknown[] | undefined, 5);
}

function paragraphs(summary: string): string[] {
  return summary
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

export function AssistantMessageCard({ message }: { message: AssistantUiMessage }) {
  const { toast } = useToast();
  const { isDeveloper } = useRole();
  const [showDebug, setShowDebug] = useState(false);
  const [showEvidence, setShowEvidence] = useState(isDeveloper);
  const [showAllEvidence, setShowAllEvidence] = useState(false);

  const isUser = message.role === 'user';
  const assistant = message.assistant
    ? normalizeAssistantPayloadForUi(message.assistant, message.content, undefined, message.capability)
    : undefined;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="assistant-bubble-user max-w-[94%] rounded-2xl px-3 py-2 sm:max-w-[85%]">
          <div className="mb-1 inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <UserCircle2 className="h-3.5 w-3.5" />
            You
          </div>
          <p className="whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{message.content}</p>
        </div>
      </div>
    );
  }

  if (!assistant) {
    return (
      <div className="flex justify-start">
        <div className="assistant-bubble-assistant max-w-[96%] rounded-2xl px-3 py-2 sm:max-w-[90%]">
          <div className="mb-1 inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Bot className="h-3.5 w-3.5 text-[var(--assistant-accent)]" />
            {ASSISTANT_NAME}
          </div>
          <p className="whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{message.content}</p>
        </div>
      </div>
    );
  }

  const summary = displayableAssistantSummary(assistant.summary);
  const evidenceChips = buildEvidenceChips(assistant);
  const links = (assistant.links ?? []).filter((link) => link?.href?.startsWith('/'));
  const actionDrafts = assistant.action_drafts ?? [];

  const {
    recommendedActions,
    priorityReasoning,
    troubleshootingSteps,
    likelyCauses,
    maintenanceTips,
    requiredToolsParts,
    keyFindings,
    followUps,
    limitations,
    sourceTables,
    missingDataNotices,
  } = getAssistantVisibleSections(assistant, message.capability);

  const summaryParas = paragraphs(summary);

  return (
    <div className="flex justify-start">
      <div className="assistant-bubble-assistant max-w-[98%] rounded-2xl px-3 py-3 sm:max-w-[92%] sm:px-3.5">
        <div className="mb-1.5 inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Bot className="h-3.5 w-3.5 text-[var(--assistant-accent)]" />
          <span>{ASSISTANT_NAME}</span>
          {assistant.escalation_required ? (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              Escalation
            </span>
          ) : null}
        </div>

        {assistant.title ? (
          <p className="mb-1 text-sm font-semibold text-[var(--foreground)]">{assistant.title}</p>
        ) : null}

        <div className="space-y-2 text-sm text-[var(--foreground)]">
          {summaryParas.length > 0
            ? summaryParas.map((para, idx) => (
                <p key={idx} className="whitespace-pre-wrap break-words leading-relaxed">
                  {para}
                </p>
              ))
            : null}
        </div>

        {priorityReasoning.length > 0 && (
          <div className="mt-3 space-y-1 text-sm text-[var(--foreground)]">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Why</p>
            <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
              {priorityReasoning.map((item, idx) => (
                <li key={`pr-${idx}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {recommendedActions.length > 0 && (
          <div className="mt-3 space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Next steps</p>
            <ol className="list-decimal space-y-1 pl-5 text-[var(--text-muted)]">
              {recommendedActions.map((item, idx) => (
                <li key={`ra-${idx}`}>{item}</li>
              ))}
            </ol>
          </div>
        )}

        {troubleshootingSteps.length > 0 && (
          <div className="mt-3 space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Safe first-line checks</p>
            <ol className="list-decimal space-y-1 pl-5 text-[var(--text-muted)]">
              {troubleshootingSteps.map((item, idx) => (
                <li key={`ts-${idx}`}>{item}</li>
              ))}
            </ol>
          </div>
        )}

        {likelyCauses.length > 0 && (
          <div className="mt-3 space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Likely causes</p>
            <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
              {likelyCauses.map((item, idx) => (
                <li key={`lc-${idx}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {maintenanceTips.length > 0 && (
          <div className="mt-3 space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Maintenance tips</p>
            <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
              {maintenanceTips.map((item, idx) => (
                <li key={`mt-${idx}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {requiredToolsParts.length > 0 && (
          <div className="mt-3 space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Tools / parts</p>
            <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
              {requiredToolsParts.map((item, idx) => (
                <li key={`rt-${idx}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {assistant.escalation_required && (
          <div className="assistant-warning mt-3 rounded-xl p-3">
            <p className="assistant-warning-strong mb-1 inline-flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4" />
              Escalation recommended
            </p>
            <p className="text-sm">
              {assistant.escalation_recommendation || 'Escalate to a qualified biomedical engineer or vendor.'}
            </p>
          </div>
        )}

        {missingDataNotices.length > 0 && (
          <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--assistant-surface-elev)]/70 p-3 text-sm text-[var(--text-muted)]">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide">Missing data</p>
            <ul className="list-disc space-y-1 pl-5">
              {missingDataNotices.map((item, idx) => (
                <li key={`md-${idx}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {actionDrafts.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Suggested actions</p>
            {actionDrafts.map((draft) => (
              <CopilotActionCard key={draft.id} draft={draft} messageId={message.id} />
            ))}
          </div>
        )}

        {(evidenceChips.length > 0 || links.length > 0) && (
          <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--assistant-surface-elev)]/70">
            <button
              type="button"
              onClick={() => setShowEvidence((prev) => !prev)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]"
              aria-expanded={showEvidence}
            >
              <span className="font-medium">Evidence & links</span>
              <span className="inline-flex items-center gap-1">
                {evidenceChips.length + links.length} item{evidenceChips.length + links.length === 1 ? '' : 's'}
                {showEvidence ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </span>
            </button>
            {showEvidence && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)] px-3 py-2">
                {evidenceChips.slice(0, showAllEvidence ? evidenceChips.length : 3).map((chip, idx) => (
                  <span
                    key={`ev-${idx}`}
                    className="assistant-chip rounded-full px-2 py-0.5 text-[11px]"
                  >
                    {chip}
                  </span>
                ))}
                {evidenceChips.length > 3 && !showAllEvidence && (
                  <button
                    type="button"
                    onClick={() => setShowAllEvidence(true)}
                    className="text-[11px] text-[var(--text-muted)] underline-offset-2 hover:underline"
                  >
                    +{evidenceChips.length - 3} more
                  </button>
                )}
                {links.map((link, idx) => (
                  <Link
                    key={`lk-${idx}`}
                    href={link.href}
                    className="assistant-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] hover:text-[var(--foreground)]"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {followUps.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {followUps.map((item, idx) => (
              <Badge key={`fu-${idx}`} variant="default" className="text-[11px]">
                {item}
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          {isDeveloper && assistant.answer_basis ? (
            <Badge variant={BASIS_BADGE_VARIANT[assistant.answer_basis] ?? 'default'} className="text-[11px]">
              {assistant.answer_basis.replace(/_/g, ' ')}
            </Badge>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(buildAssistantCopyText(assistant as AssistantContent, message.capability));
                toast('success', 'Copied');
              } catch {
                toast('error', 'Could not copy');
              }
            }}
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
            Copy
          </Button>
          {isDeveloper && (
            <button
              type="button"
              onClick={() => setShowDebug((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] hover:text-[var(--foreground)]"
            >
              {showDebug ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Developer trace
            </button>
          )}
        </div>

        {isDeveloper && showDebug && (
          <div className="mt-3 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--assistant-surface-elev)] p-2 text-[11px] text-[var(--text-muted)]">
            <div className="flex flex-wrap gap-1.5">
              {message.intent ? (
                <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">Intent: {message.intent}</span>
              ) : null}
              {message.capability ? (
                <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">{message.capability}</span>
              ) : null}
              {message.fallbackReason ? (
                <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">Fallback: {message.fallbackReason}</span>
              ) : null}
              {assistant.intelligence_mode ? (
                <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">Mode: {assistant.intelligence_mode}</span>
              ) : null}
              <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">Confidence: {assistant.confidence}</span>
            </div>
            {keyFindings.length > 0 && (
              <div>
                <p className="font-semibold text-[var(--foreground)]">Key findings (model)</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {keyFindings.map((item, idx) => (
                    <li key={`kf-${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {evidenceChips.length > 0 && (
              <div>
                <p className="font-semibold text-[var(--foreground)]">Evidence used</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {evidenceChips.map((item, idx) => (
                    <li key={`ev-debug-${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {sourceTables.length > 0 && (
              <p>Sources: {sourceTables.join(', ')}</p>
            )}
            {limitations.length > 0 && <p>Limits: {limitations.join('; ')}</p>}
            {assistant.data_freshness && <p>Freshness: {assistant.data_freshness}</p>}
            {assistant.reason_for_limit && <p>Reason: {assistant.reason_for_limit}</p>}
            {(assistant.routing_explanation ?? []).length > 0 && (
              <div>
                <p className="font-semibold text-[var(--foreground)]">Routing</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {safeAssistantList(assistant.routing_explanation, 6).map((item, idx) => (
                    <li key={`r-${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!isDeveloper && limitations.length > 0 && (
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            Note: {limitations[0]}
          </p>
        )}
      </div>
    </div>
  );
}
