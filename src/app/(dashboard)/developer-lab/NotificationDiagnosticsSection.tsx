'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CheckCheck,
  ListChecks,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import Card, { CardContent } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import {
  createTestNotificationToSelfAction,
  fetchTelegramBotUpdatesAction,
  getNotificationDiagnosticsAction,
  getTelegramWebhookSetupAction,
  listDeliveriesAction,
  listRuleLogsAction,
  runNotificationRuleCheckAction,
  saveTelegramConnectionAction,
  sendSampleRoleNotificationAction,
  sendTelegramTestMessageAction,
  setTelegramWebhookAction,
  testTelegramBotAction,
} from '@/actions/notifications.actions';
import type {
  NotificationDeliveryRow,
  NotificationDiagnostics,
  NotificationRuleLogRow,
} from '@/types/notifications';

const SAMPLE_VARIANTS: Array<{ id: string; label: string; description: string }> = [
  { id: 'bme_head_critical', label: 'BME Head — critical maintenance', description: 'Critical equipment request lands for leadership.' },
  { id: 'technician_assignment', label: 'Technician — critical assignment', description: 'New high-priority work order assigned.' },
  { id: 'store_stock_blocker', label: 'Store — stock blocker', description: 'Repair blocked by missing spare part.' },
  { id: 'department_update', label: 'Department — critical equipment', description: 'Department-scoped critical update.' },
  { id: 'viewer_readiness', label: 'Viewer — readiness risk', description: 'Management-only service readiness signal.' },
  { id: 'developer_system', label: 'Developer — rule failed', description: 'Developer-only system signal.' },
];

interface WebhookSetup {
  expected_webhook_url: string;
  secret_token_configured: boolean;
  registered_webhook_url: string | null;
  registered_url_matches_expected: boolean | null;
  pending_update_count: number;
  last_error_date: string | null;
  last_error_message: string | null;
  ip_address: string | null;
  max_connections: number | null;
  allowed_updates: string[] | null;
  info_error: string | null;
}

interface TelegramUpdate {
  update_id: number;
  chat_id?: string;
  chat_type?: string;
  chat_title?: string | null;
  username?: string | null;
  first_name?: string | null;
  text?: string | null;
  date?: string | null;
}

function StatLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] py-1.5 text-xs">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-semibold text-[var(--foreground)]">{value}</span>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  let variant: 'success' | 'warning' | 'error' | 'info' | 'default' = 'default';
  if (value === 'sent' || value === 'matched') variant = 'success';
  else if (value === 'failed') variant = 'error';
  else if (value === 'skipped') variant = 'warning';
  else if (value === 'pending') variant = 'info';
  return <Badge variant={variant}>{value}</Badge>;
}

export default function NotificationDiagnosticsSection() {
  const { toast } = useToast();
  const [diagnostics, setDiagnostics] = useState<NotificationDiagnostics | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDeliveryRow[]>([]);
  const [ruleLogs, setRuleLogs] = useState<NotificationRuleLogRow[]>([]);
  const [updates, setUpdates] = useState<TelegramUpdate[]>([]);
  const [webhook, setWebhook] = useState<WebhookSetup | null>(null);
  const [chatIdInput, setChatIdInput] = useState('');
  const [profileIdInput, setProfileIdInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [d, deliveryRes, ruleRes, webhookRes] = await Promise.all([
        getNotificationDiagnosticsAction(),
        listDeliveriesAction({}),
        listRuleLogsAction({}),
        getTelegramWebhookSetupAction(),
      ]);
      if (d.success && d.data) setDiagnostics(d.data as NotificationDiagnostics);
      if (deliveryRes.success && Array.isArray(deliveryRes.data)) {
        setDeliveries(deliveryRes.data as NotificationDeliveryRow[]);
      }
      if (ruleRes.success && Array.isArray(ruleRes.data)) {
        setRuleLogs(ruleRes.data as NotificationRuleLogRow[]);
      }
      if (webhookRes.success && webhookRes.data) {
        setWebhook(webhookRes.data as WebhookSetup);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const handleSendTest = useCallback(async () => {
    setWorking(true);
    const res = await createTestNotificationToSelfAction();
    setWorking(false);
    if (!res.success) toast('error', res.error ?? 'Test failed');
    else toast('success', 'Test notification created');
    void fetchAll();
  }, [fetchAll, toast]);

  const handleSendTelegramTest = useCallback(async () => {
    setWorking(true);
    const res = await sendTelegramTestMessageAction();
    setWorking(false);
    if (!res.success) toast('error', res.error ?? 'Telegram test failed');
    else toast('success', 'Telegram test message sent');
    void fetchAll();
  }, [fetchAll, toast]);

  const handleTestBot = useCallback(async () => {
    setWorking(true);
    const res = await testTelegramBotAction();
    setWorking(false);
    if (!res.success) toast('error', res.error ?? 'Bot check failed');
    else toast('success', `Bot OK${(res.data as { bot_username?: string })?.bot_username ? `: @${(res.data as { bot_username?: string }).bot_username}` : ''}`);
  }, [toast]);

  const handleSample = useCallback(
    async (variant: string) => {
      setWorking(true);
      const res = await sendSampleRoleNotificationAction(variant);
      setWorking(false);
      if (!res.success) toast('error', res.error ?? 'Sample failed');
      else toast('success', 'Sample notification queued');
      void fetchAll();
    },
    [fetchAll, toast],
  );

  const handleRuleCheck = useCallback(async () => {
    setWorking(true);
    const res = await runNotificationRuleCheckAction();
    setWorking(false);
    if (!res.success) toast('error', res.error ?? 'Rule check failed');
    else {
      const data = res.data as { events_created?: number; errors?: string[] } | null;
      toast('success', `Created ${data?.events_created ?? 0} event(s)`);
    }
    void fetchAll();
  }, [fetchAll, toast]);

  const handleRegisterWebhook = useCallback(async () => {
    setWorking(true);
    const res = await setTelegramWebhookAction();
    setWorking(false);
    if (!res.success) {
      toast('error', res.error ?? 'setWebhook failed');
      return;
    }
    toast('success', 'Telegram webhook registered');
    void fetchAll();
  }, [fetchAll, toast]);

  const handleFetchUpdates = useCallback(async () => {
    setWorking(true);
    const res = await fetchTelegramBotUpdatesAction();
    setWorking(false);
    if (!res.success) toast('error', res.error ?? 'Failed to fetch updates');
    else setUpdates(((res.data as TelegramUpdate[]) ?? []).slice().reverse());
  }, [toast]);

  const handleSaveConnection = useCallback(async () => {
    if (!profileIdInput.trim() || !chatIdInput.trim()) {
      toast('error', 'profile_id and telegram_chat_id are required');
      return;
    }
    setWorking(true);
    const res = await saveTelegramConnectionAction({
      profile_id: profileIdInput.trim(),
      telegram_chat_id: chatIdInput.trim(),
      telegram_username: usernameInput.trim() || null,
      is_enabled: true,
    });
    setWorking(false);
    if (!res.success) toast('error', res.error ?? 'Failed to save connection');
    else {
      toast('success', 'Telegram connection saved');
      setChatIdInput('');
      setProfileIdInput('');
      setUsernameInput('');
    }
  }, [chatIdInput, profileIdInput, usernameInput, toast]);

  const masked = useMemo(() => diagnostics?.telegram_monitor_chat_id_masked ?? null, [diagnostics]);

  return (
    <section id="notification-diagnostics" className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Notification & Telegram Diagnostics</h2>
          <p className="text-sm text-[var(--text-muted)]">
            In-app notifications are the source of truth. Telegram is an optional external delivery
            channel; the developer monitor receives copies of every Telegram-eligible notification
            for testing across roles.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void fetchAll()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent>
            <div className="mb-3 flex items-center gap-2">
              <Bell className="h-4 w-4 text-[var(--brand)]" />
              <p className="text-sm font-semibold text-[var(--foreground)]">In-app activity</p>
            </div>
            {loading || !diagnostics ? (
              <p className="text-xs text-[var(--text-muted)]">Loading…</p>
            ) : (
              <div>
                <StatLine label="Events today" value={diagnostics.events_today} />
                <StatLine label="Pending events" value={diagnostics.events_pending} />
                <StatLine label="Failed events today" value={diagnostics.events_failed_today} />
                <StatLine label="Notifications created today" value={diagnostics.notifications_today} />
                <StatLine label="Unread total" value={diagnostics.notifications_unread_total} />
                <StatLine label="Unread critical" value={diagnostics.notifications_unread_critical} />
                <StatLine label="Rule failures today" value={diagnostics.rule_failures_today} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="mb-3 flex items-center gap-2">
              <Send className="h-4 w-4 text-[var(--brand)]" />
              <p className="text-sm font-semibold text-[var(--foreground)]">Telegram delivery</p>
            </div>
            {loading || !diagnostics ? (
              <p className="text-xs text-[var(--text-muted)]">Loading…</p>
            ) : (
              <div>
                <StatLine label="Telegram enabled" value={diagnostics.telegram_enabled ? 'yes' : 'no'} />
                <StatLine label="Bot token configured" value={diagnostics.telegram_bot_token_present ? 'yes' : 'no'} />
                <StatLine label="Monitor enabled" value={diagnostics.telegram_monitor_enabled ? 'yes' : 'no'} />
                <StatLine label="Monitor chat id" value={masked ?? 'not set'} />
                <StatLine label="Deliveries today" value={diagnostics.deliveries_today} />
                <StatLine label="Sent today" value={diagnostics.deliveries_sent_today} />
                <StatLine label="Skipped today" value={diagnostics.deliveries_skipped_today} />
                <StatLine label="Failed today" value={diagnostics.deliveries_failed_today} />
                <StatLine label="Monitor copies today" value={diagnostics.monitor_deliveries_today} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-[var(--brand)]" />
            <p className="text-sm font-semibold text-[var(--foreground)]">
              Telegram bot webhook (required for /start /help /reset to reply)
            </p>
          </div>
          {!webhook ? (
            <p className="text-xs text-[var(--text-muted)]">Loading…</p>
          ) : (
            <div className="space-y-2 text-xs">
              <StatLine label="Expected webhook URL" value={webhook.expected_webhook_url} />
              <StatLine
                label="Registered webhook URL"
                value={webhook.registered_webhook_url ?? 'not set'}
              />
              <StatLine
                label="Registered matches expected"
                value={
                  webhook.registered_url_matches_expected == null
                    ? '—'
                    : webhook.registered_url_matches_expected
                      ? 'yes'
                      : 'no — bot replies will not arrive'
                }
              />
              <StatLine
                label="Secret token configured (server)"
                value={webhook.secret_token_configured ? 'yes' : 'no'}
              />
              <StatLine label="Pending updates" value={webhook.pending_update_count} />
              <StatLine
                label="Last delivery error"
                value={webhook.last_error_message ?? '—'}
              />
              {webhook.last_error_date && (
                <StatLine label="Last error at" value={webhook.last_error_date} />
              )}
              {webhook.info_error && (
                <div className="rounded-md border border-amber-500/60 bg-amber-500/10 p-2 text-amber-400">
                  Could not read webhook info from Telegram: {webhook.info_error}
                </div>
              )}
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2">
                <p className="mb-1 font-semibold text-[var(--foreground)]">
                  Manual setup (one-time)
                </p>
                <p className="text-[var(--text-muted)]">
                  Run this from a trusted shell — never paste your bot token into a chat or
                  client-side log:
                </p>
                <pre className="mt-1 overflow-x-auto whitespace-pre text-[11px] text-[var(--text-muted)]">
{`curl -X POST \\
  "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"${webhook.expected_webhook_url}"${webhook.secret_token_configured ? `,\n      "secret_token":"$TELEGRAM_WEBHOOK_SECRET"` : ''}}'`}
                </pre>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={working}
                  onClick={() => void handleRegisterWebhook()}
                >
                  <Wrench className="mr-2 h-4 w-4" /> Register webhook now
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void fetchAll()}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Recheck webhook info
                </Button>
              </div>
              <p className="text-[var(--text-muted)]">
                If commands appear in Telegram but the bot stays silent, the webhook is either
                unset or pointing at a stale URL. Set it once per deployment.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--brand)]" />
            <p className="text-sm font-semibold text-[var(--foreground)]">Developer test tools</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={working} onClick={() => void handleSendTest()}>
              <CheckCheck className="mr-2 h-4 w-4" /> Test notification to self
            </Button>
            <Button variant="secondary" size="sm" disabled={working} onClick={() => void handleSendTelegramTest()}>
              <Send className="mr-2 h-4 w-4" /> Send Telegram test
            </Button>
            <Button variant="secondary" size="sm" disabled={working} onClick={() => void handleTestBot()}>
              <ShieldCheck className="mr-2 h-4 w-4" /> Verify bot token
            </Button>
            <Button variant="secondary" size="sm" disabled={working} onClick={() => void handleRuleCheck()}>
              <ListChecks className="mr-2 h-4 w-4" /> Run rule check
            </Button>
            <Button variant="secondary" size="sm" disabled={working} onClick={() => void handleFetchUpdates()}>
              <Wrench className="mr-2 h-4 w-4" /> Fetch bot updates
            </Button>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-[var(--foreground)]">Sample role notifications</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SAMPLE_VARIANTS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  disabled={working}
                  onClick={() => void handleSample(v.id)}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-left text-xs hover:bg-[var(--surface-2)] disabled:opacity-50"
                >
                  <p className="font-semibold text-[var(--foreground)]">{v.label}</p>
                  <p className="mt-1 text-[var(--text-muted)]">{v.description}</p>
                </button>
              ))}
            </div>
          </div>

          {updates.length > 0 && (
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
              <p className="mb-2 text-xs font-semibold text-[var(--foreground)]">Recent bot updates</p>
              <div className="space-y-2 text-xs">
                {updates.slice(0, 10).map((u) => (
                  <div key={u.update_id} className="border-b border-[var(--border-subtle)] pb-1 last:border-b-0">
                    <p>
                      <span className="font-mono text-[var(--brand)]">{u.chat_id ?? '?'}</span>
                      {' '}
                      <span className="text-[var(--text-muted)]">{u.first_name ?? ''}{u.username ? ` @${u.username}` : ''}</span>
                    </p>
                    {u.text && <p className="text-[var(--text-muted)]">{u.text}</p>}
                    {u.date && <p className="text-[10px] text-[var(--text-subtle)]">{u.date}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
            <p className="mb-2 text-xs font-semibold text-[var(--foreground)]">Save Telegram chat id for a profile</p>
            <p className="mb-2 text-[11px] text-[var(--text-muted)]">
              Paste an exact <span className="font-mono">profiles.id</span> and the chat id you found in the bot updates list.
              Chat ids are stored encrypted at rest by Supabase and masked everywhere in the UI.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                value={profileIdInput}
                onChange={(e) => setProfileIdInput(e.target.value)}
                placeholder="profiles.id"
                className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 text-xs"
              />
              <input
                value={chatIdInput}
                onChange={(e) => setChatIdInput(e.target.value)}
                placeholder="telegram_chat_id"
                className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 text-xs"
              />
              <input
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="telegram_username (optional)"
                className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 text-xs"
              />
            </div>
            <div className="mt-2">
              <Button variant="primary" size="sm" disabled={working} onClick={() => void handleSaveConnection()}>
                Save connection
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent>
            <p className="mb-2 text-sm font-semibold text-[var(--foreground)]">Recent delivery logs</p>
            <div className="max-h-80 overflow-y-auto">
              {deliveries.length === 0 && (
                <p className="text-xs text-[var(--text-muted)]">No deliveries yet.</p>
              )}
              {deliveries.slice(0, 25).map((d) => (
                <div key={d.id} className="border-b border-[var(--border-subtle)] py-2 last:border-b-0">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-[var(--text-muted)]">{d.channel}</span>
                    <StatusBadge value={d.status} />
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {new Date(d.created_at).toLocaleString()}
                  </p>
                  {d.skip_reason && (
                    <p className="text-[11px] text-amber-500">Skip: {d.skip_reason}</p>
                  )}
                  {d.error_message && (
                    <p className="text-[11px] text-red-500">Error: {d.error_message}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <p className="mb-2 text-sm font-semibold text-[var(--foreground)]">Recent rule activity</p>
            <div className="max-h-80 overflow-y-auto">
              {ruleLogs.length === 0 && (
                <p className="text-xs text-[var(--text-muted)]">No rule logs yet.</p>
              )}
              {ruleLogs.slice(0, 25).map((r) => (
                <div key={r.id} className="border-b border-[var(--border-subtle)] py-2 last:border-b-0">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-[var(--text-muted)]">{r.rule_name}</span>
                    <StatusBadge value={r.status} />
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {new Date(r.created_at).toLocaleString()} · {r.recipient_count} recipients
                  </p>
                  {r.error_message && (
                    <p className="text-[11px] text-red-500">Error: {r.error_message}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
