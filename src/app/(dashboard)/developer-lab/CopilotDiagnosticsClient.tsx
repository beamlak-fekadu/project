'use client';

import { useState, useTransition } from 'react';
import { Activity, FlaskConical, RefreshCcw } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, useToast } from '@/components/ui';
import {
  getCopilotRouteDriftSummaryAction,
  getCopilotTelemetrySummaryAction,
  getCopilotUsageSummaryAction,
  runGeminiSmokeTestAction,
} from '@/actions/copilot-diagnostics.actions';
import type { CopilotUsageSummary } from '@/services/chatbot/usage-service';
import type { CopilotRouteDriftSummary } from '@/services/chatbot/telemetry-drift-service';

function fmtTokens(tokens: number) {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return String(tokens);
}

export default function CopilotDiagnosticsClient({
  initialSummary,
  initialTelemetry,
  initialRouteDrift,
}: {
  initialSummary: CopilotUsageSummary;
  initialTelemetry: Array<Record<string, unknown>>;
  initialRouteDrift: CopilotRouteDriftSummary;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState(initialSummary);
  const [telemetry, setTelemetry] = useState(initialTelemetry);
  const [routeDrift, setRouteDrift] = useState(initialRouteDrift);
  const [smokeResult, setSmokeResult] = useState<string | null>(null);

  function refresh() {
    startTransition(async () => {
      const [usageResult, telemetryResult, routeDriftResult] = await Promise.all([
        getCopilotUsageSummaryAction(),
        getCopilotTelemetrySummaryAction(),
        getCopilotRouteDriftSummaryAction(),
      ]);
      if (usageResult.success && usageResult.data) setSummary(usageResult.data);
      if (telemetryResult.success && telemetryResult.data) setTelemetry(telemetryResult.data);
      if (routeDriftResult.success && routeDriftResult.data) setRouteDrift(routeDriftResult.data);
      if (!usageResult.success || !telemetryResult.success || !routeDriftResult.success) {
        toast('error', usageResult.error ?? telemetryResult.error ?? routeDriftResult.error ?? 'Refresh failed');
      }
    });
  }

  function runSmoke() {
    startTransition(async () => {
      const result = await runGeminiSmokeTestAction();
      const data = result.data as { ok?: boolean; model?: string; error?: string } | undefined;
      if (result.success) {
        setSmokeResult(`Gemini OK (${data?.model ?? summary.model})`);
        toast('success', 'Gemini smoke test passed');
      } else {
        setSmokeResult(data?.error ?? result.error ?? 'Gemini smoke test failed');
        toast('error', result.error ?? 'Gemini smoke test failed');
      }
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">AI Copilot Diagnostics</h2>
          <p className="text-sm text-[var(--text-muted)]">
            App-tracked Gemini usage, parser recovery, fallback health, and telemetry. This is not the Google AI Studio billing dashboard.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={refresh} loading={pending}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={runSmoke} loading={pending}>
            <FlaskConical className="h-4 w-4" />
            Gemini smoke test
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <Activity className="mb-2 h-5 w-5 text-cyan-300" />
          <p className="text-sm text-[var(--text-muted)]">Provider configured</p>
          <Badge variant={summary.providerConfigured ? 'success' : 'warning'}>{summary.providerConfigured ? 'Yes' : 'No'}</Badge>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-muted)]">Model</p>
          <p className="text-sm font-semibold text-[var(--foreground)]">{summary.model}</p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-muted)]">Requests today</p>
          <p className="text-2xl font-semibold text-[var(--foreground)]">{summary.requestsToday}</p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-muted)]">Tokens today</p>
          <p className="text-2xl font-semibold text-[var(--foreground)]">{fmtTokens(summary.tokensToday)}</p>
          <p className="text-xs text-[var(--text-muted)]">{summary.usageSource}</p>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          ['Provider failures', summary.providerFailuresToday],
          ['Fallback events', summary.fallbackEventsToday],
          ['Parser recoveries', summary.parserRecoveryEventsToday],
          ['Deterministic fallbacks', summary.deterministicFallbackEventsToday],
          ['Unsafe/blocked requests', summary.blockedRequestsToday],
          ['Fallback rate', summary.requestsToday ? `${Math.round((summary.fallbackEventsToday / summary.requestsToday) * 100)}%` : '0%'],
          ['Action drafts executed', summary.actionDraftsExecutedToday],
        ].map(([label, value]) => (
          <Card key={label}>
            <p className="text-sm text-[var(--text-muted)]">{label}</p>
            <p className="text-xl font-semibold text-[var(--foreground)]">{value}</p>
          </Card>
        ))}
      </div>

      {smokeResult && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-sm text-[var(--text-muted)]">
          Last smoke test: {smokeResult}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top capabilities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {summary.topCapabilities.length ? summary.topCapabilities.map((item) => (
              <div key={item.capability} className="flex justify-between gap-3">
                <span className="text-[var(--text-muted)]">{item.capability}</span>
                <span className="font-medium text-[var(--foreground)]">{item.count}</span>
              </div>
            )) : <p className="text-[var(--text-muted)]">No usage events today.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Role usage distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {summary.roleUsage.length ? summary.roleUsage.map((item) => (
              <div key={item.role} className="flex justify-between gap-3">
                <span className="text-[var(--text-muted)]">{item.role}</span>
                <span className="font-medium text-[var(--foreground)]">{item.count}</span>
              </div>
            )) : <p className="text-[var(--text-muted)]">No role usage today.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Copilot-assisted action drafts today</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-[var(--text-muted)]">
            Drafts proposed by the assistant and confirmed by a user. Each executed draft writes a copilot.draft.executed.* audit log.
          </p>
          {summary.actionDraftsByKindToday.length ? summary.actionDraftsByKindToday.map((item) => (
            <div key={item.kind} className="flex justify-between gap-3">
              <span className="text-[var(--text-muted)]">{item.kind}</span>
              <span className="font-medium text-[var(--foreground)]">{item.count}</span>
            </div>
          )) : <p className="text-[var(--text-muted)]">No copilot-assisted actions executed today.</p>}
        </CardContent>
      </Card>

      <div className="panel-surface overflow-x-auto rounded-lg">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Capability</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Usage</th>
              <th className="px-3 py-2">Fallback</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]/60">
            {summary.recentEvents.map((event, index) => (
              <tr key={`${event.created_at}-${index}`}>
                <td className="px-3 py-2 text-[var(--text-muted)]">{event.created_at ? new Date(event.created_at).toLocaleString() : '—'}</td>
                <td className="px-3 py-2 text-[var(--foreground)]">{event.capability ?? '—'}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{event.provider} · {event.model ?? 'unknown'}</td>
                <td className="px-3 py-2"><Badge variant={event.provider_status === 'success' ? 'success' : 'warning'}>{event.provider_status}</Badge></td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{event.usage_source} · {event.total_tokens ?? event.estimated_tokens ?? 0}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{event.fallback_reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent telemetry detail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-[var(--text-muted)]">
          {telemetry.slice(0, 8).map((event, index) => (
            <div key={index} className="rounded border border-[var(--border-subtle)] p-2">
              {String(event.created_at ?? '')} · {String(event.capability ?? 'unknown')} · confidence {String(event.confidence_label ?? 'n/a')} · parser recovery {String(event.parsing_recovery_used ?? false)}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Route drift health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-[var(--text-muted)]">Events reviewed</span>
              <span className="font-medium text-[var(--foreground)]">{routeDrift.totalEvents}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--text-muted)]">Fallback rate</span>
              <span className="font-medium text-[var(--foreground)]">{Math.round(routeDrift.fallbackRate * 100)}%</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--text-muted)]">Parser recovery</span>
              <span className="font-medium text-[var(--foreground)]">{Math.round(routeDrift.parserRecoveryRate * 100)}%</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--text-muted)]">Unsafe/blocked</span>
              <span className="font-medium text-[var(--foreground)]">{Math.round(routeDrift.blockedRate * 100)}%</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--text-muted)]">Unsafe category rate</span>
              <span className="font-medium text-[var(--foreground)]">{Math.round((routeDrift.unsafeBlockedRate ?? 0) * 100)}%</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Capability by route</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {routeDrift.capabilityByRoute.length ? routeDrift.capabilityByRoute.slice(0, 6).map((item) => (
              <div key={`${item.route}-${item.capability}`} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-[var(--text-muted)]">{item.route} · {item.capability}</span>
                <span className="font-medium text-[var(--foreground)]">{item.count}</span>
              </div>
            )) : <p className="text-[var(--text-muted)]">No route telemetry yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Suspicious drift buckets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {routeDrift.suspiciousBuckets.length ? routeDrift.suspiciousBuckets.map((bucket) => (
              <div key={bucket.bucket} className="rounded border border-[var(--border-subtle)] p-2">
                <div className="flex justify-between gap-3">
                  <span className="text-[var(--text-muted)]">{bucket.bucket.replace(/_/g, ' ')}</span>
                  <span className="font-medium text-[var(--foreground)]">{bucket.count}</span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                  {bucket.examples.map((item) => `${item.route} · ${item.intent} → ${item.capability}`).join(' | ')}
                </p>
              </div>
            )) : <p className="text-[var(--text-muted)]">No suspicious drift in the review window.</p>}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Evidence completeness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {routeDrift.evidenceCompletenessByCapability?.length ? routeDrift.evidenceCompletenessByCapability.slice(0, 6).map((item) => (
              <div key={`${item.capability}-${item.status}`} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-[var(--text-muted)]">{item.capability} · {item.status}</span>
                <span className="font-medium text-[var(--foreground)]">{item.count} · {Math.round(item.averageScore * 100)}%</span>
              </div>
            )) : <p className="text-[var(--text-muted)]">No completeness telemetry yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Role/page clusters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {routeDrift.rolePageBreakdown?.length ? routeDrift.rolePageBreakdown.slice(0, 6).map((item) => (
              <div key={`${item.role_category}-${item.route}`} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-[var(--text-muted)]">{item.role_category} · {item.route}</span>
                <span className="font-medium text-[var(--foreground)]">{item.count}</span>
              </div>
            )) : <p className="text-[var(--text-muted)]">No role/page clusters yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Low-confidence clusters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {routeDrift.repeatedLowConfidenceClusters?.length ? routeDrift.repeatedLowConfidenceClusters.slice(0, 6).map((item) => (
              <div key={`${item.route}-${item.intent}-${item.capability}`} className="rounded border border-[var(--border-subtle)] p-2">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 truncate text-[var(--text-muted)]">{item.route}</span>
                  <span className="font-medium text-[var(--foreground)]">{item.count}</span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{item.intent} → {item.capability}</p>
              </div>
            )) : <p className="text-[var(--text-muted)]">No repeated low-confidence clusters.</p>}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
