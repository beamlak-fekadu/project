'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, ClipboardCopy, ExternalLink, ShieldCheck, WifiOff } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import type { CopilotActionDraft, CopilotActionResult } from '@/types/copilot-actions';
import { CopilotActionConfirmDialog } from './CopilotActionConfirmDialog';
import { executeCopilotActionDraftAction } from '@/actions/copilot-actions.actions';
import {
  enqueueOfflineDraft,
  isOfflineCapableExecutionMode,
} from './copilot-offline';
import { useAssistantContext } from './AssistantProvider';

const RISK_BADGE: Record<string, 'success' | 'warning' | 'error' | 'info'> = {
  low: 'success',
  medium: 'warning',
  high: 'error',
};

const MODE_LABEL: Record<string, string> = {
  link_only: 'Open record only',
  draft_only: 'Review-only draft',
  confirm_then_execute: 'Confirm to create',
  online_only: 'Online-only',
  offline_capable: 'Offline capable',
};

interface CopilotActionCardProps {
  draft: CopilotActionDraft;
  messageId?: string;
}

export function CopilotActionCard({ draft, messageId }: CopilotActionCardProps) {
  const { toast } = useToast();
  const { activeSessionId } = useAssistantContext();
  const sessionId = activeSessionId;
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<CopilotActionResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const offlineCapable = isOfflineCapableExecutionMode(draft);
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;

  const handleCopy = async () => {
    const text = [
      `# ${draft.title}`,
      draft.description,
      '',
      ...draft.fields.map((field) => `- ${field.label}: ${field.value ?? ''}`),
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('success', 'Draft copied to clipboard');
    } catch {
      toast('error', 'Copy failed — your browser blocked clipboard access');
    }
  };

  const handleConfirm = async (overrides: Record<string, string | number | boolean | null>) => {
    setSubmitting(true);
    try {
      // Offline + offline-capable → queue via existing IndexedDB queue rather than calling server.
      if (offlineCapable && !isOnline) {
        const queued = await enqueueOfflineDraft({ draft, overrides, sessionId, messageId });
        if (queued.ok) {
          setResult({
            status: 'queued_offline',
            message: 'Action queued offline. It will sync from the Sync Review Center when you reconnect.',
          });
          toast('success', 'Queued for offline sync');
          setOpen(false);
        } else {
          setResult({ status: 'failed', error: queued.error });
          toast('error', queued.error);
        }
        return;
      }
      const response = await executeCopilotActionDraftAction({
        draft,
        overrides,
        sessionId,
        messageId,
      });
      setResult(response);
      if (response.status === 'executed') {
        toast('success', response.message ?? 'Action submitted');
        setOpen(false);
      } else if (response.status === 'conflict') {
        toast('error', `Conflict: ${response.message ?? response.error ?? 'Existing record blocks this action'}`);
      } else if (response.status === 'blocked') {
        toast('error', response.error ?? 'Blocked');
      } else if (response.status === 'failed') {
        toast('error', response.error ?? 'Action failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to execute copilot action';
      setResult({ status: 'failed', error: message });
      toast('error', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{draft.title}</span>
        <Badge variant={RISK_BADGE[draft.riskLevel] ?? 'info'} className="text-[10px]">
          {draft.riskLevel} risk
        </Badge>
        <Badge variant="info" className="text-[10px]">
          {MODE_LABEL[draft.executionMode] ?? draft.executionMode}
        </Badge>
        {offlineCapable ? (
          <Badge variant="default" className="text-[10px]">
            <WifiOff className="mr-1 inline h-3 w-3" />
            Offline capable
          </Badge>
        ) : null}
      </div>
      <p className="text-[var(--text-muted)]">{draft.description}</p>

      {draft.validationWarnings.length > 0 ? (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
          <div className="mb-1 inline-flex items-center gap-1 font-semibold">
            <AlertTriangle className="h-3 w-3" />
            Review before confirming
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {draft.validationWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft.evidenceUsed.length > 0 ? (
        <div className="mt-2 text-xs text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--foreground)]">Evidence used:</span>{' '}
          {draft.evidenceUsed.slice(0, 4).join(' • ')}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {draft.primaryRoute ? (
          <Link
            href={draft.primaryRoute}
            target="_blank"
            className="inline-flex min-h-9 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs hover:border-[var(--assistant-accent-soft)]"
          >
            <ExternalLink className="h-3 w-3" />
            {draft.primaryRouteLabel ?? 'Open record'}
          </Link>
        ) : null}
        <Button variant="ghost" size="sm" onClick={handleCopy}>
          <ClipboardCopy className="h-3 w-3" />
          Copy draft
        </Button>
        {draft.executionMode === 'confirm_then_execute' ? (
          <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
            <ShieldCheck className="h-3 w-3" />
            Review & submit
          </Button>
        ) : null}
      </div>

      {result ? (
        <div
          className={`mt-3 rounded-md border p-2 text-xs ${
            result.status === 'executed'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : result.status === 'queued_offline'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                : 'border-red-500/40 bg-red-500/10 text-red-200'
          }`}
        >
          <p className="font-semibold capitalize">{result.status.replace(/_/g, ' ')}</p>
          {result.message ? <p>{result.message}</p> : null}
          {result.error ? <p>{result.error}</p> : null}
          {result.createdRecordRoute ? (
            <Link href={result.createdRecordRoute} className="mt-1 inline-flex items-center gap-1 underline">
              <ExternalLink className="h-3 w-3" />
              Open created record
            </Link>
          ) : null}
          {result.existingRecordRoute ? (
            <Link href={result.existingRecordRoute} className="mt-1 inline-flex items-center gap-1 underline">
              <ExternalLink className="h-3 w-3" />
              Open existing record
            </Link>
          ) : null}
        </div>
      ) : null}

      <CopilotActionConfirmDialog
        open={open}
        draft={draft}
        submitting={submitting}
        onCancel={() => setOpen(false)}
        onConfirm={handleConfirm}
        offlineHint={offlineCapable && !isOnline ? 'You are offline — confirming will queue this for sync.' : undefined}
      />
    </div>
  );
}
