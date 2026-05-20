'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, Filter, RefreshCw, ShieldAlert } from 'lucide-react';
import { useRole } from '@/hooks/useRole';
import AssistantPageContextBridge from '@/components/assistant/AssistantPageContextBridge';
import { PageHeader, Badge, Button, Tabs, EmptyState } from '@/components/ui';
import Card, { CardContent } from '@/components/ui/Card';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import {
  createTestNotificationToSelfAction,
  getMyNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationStatusAction,
} from '@/actions/notifications.actions';
import type {
  NotificationCategory,
  NotificationPriority,
  NotificationRow,
  NotificationStatus,
} from '@/types/notifications';

type FilterState = {
  status: 'any' | NotificationStatus;
  priority: 'any' | NotificationPriority;
  category: 'any' | NotificationCategory;
  search: string;
};

const PRIORITY_OPTIONS: Array<NotificationPriority | 'any'> = ['any', 'critical', 'high', 'medium', 'low', 'info'];
const STATUS_OPTIONS: Array<NotificationStatus | 'any'> = ['any', 'unread', 'read', 'reviewed', 'dismissed'];
const CATEGORY_OPTIONS: Array<NotificationCategory | 'any'> = [
  'any',
  'critical',
  'task',
  'request',
  'compliance',
  'stock',
  'procurement',
  'replacement',
  'offline',
  'qr',
  'system',
  'management',
];

const TAB_CATEGORY: Record<string, NotificationCategory[] | 'all'> = {
  forme: 'all',
  critical: ['critical'],
  tasks: ['task'],
  requests: ['request'],
  compliance: ['compliance'],
  stock: ['stock', 'procurement'],
  system: ['system', 'offline', 'qr'],
  reviewed: 'all',
};

function priorityClass(priority: NotificationPriority): string {
  switch (priority) {
    case 'critical':
      return 'bg-red-500/15 text-red-500';
    case 'high':
      return 'bg-orange-500/15 text-orange-500';
    case 'medium':
      return 'bg-amber-500/15 text-amber-500';
    case 'low':
      return 'bg-blue-500/15 text-blue-500';
    case 'info':
    default:
      return 'bg-slate-500/15 text-slate-400';
  }
}

function categoryClass(category: NotificationCategory): string {
  switch (category) {
    case 'critical':
      return 'border-red-500/30 text-red-500';
    case 'task':
      return 'border-amber-500/30 text-amber-500';
    case 'request':
      return 'border-blue-500/30 text-blue-500';
    case 'compliance':
      return 'border-emerald-500/30 text-emerald-500';
    case 'stock':
    case 'procurement':
      return 'border-orange-500/30 text-orange-500';
    case 'replacement':
      return 'border-purple-500/30 text-purple-500';
    case 'offline':
    case 'qr':
      return 'border-indigo-500/30 text-indigo-500';
    case 'management':
      return 'border-sky-500/30 text-sky-500';
    case 'system':
    default:
      return 'border-[var(--border-subtle)] text-[var(--text-muted)]';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

interface NotificationItemProps {
  notification: NotificationRow;
  onMarkRead: (id: string) => void;
  onMarkReviewed: (id: string) => void;
  onDismiss: (id: string) => void;
}

function NotificationItem({ notification, onMarkRead, onMarkReviewed, onDismiss }: NotificationItemProps) {
  const isUnread = notification.status === 'unread';
  return (
    <Card padding={false} className={`border ${isUnread ? 'border-[var(--brand)]/40' : 'border-[var(--border-subtle)]'}`}>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex h-5 items-center rounded-md px-2 text-[10px] font-medium uppercase tracking-wide ${priorityClass(notification.priority)}`}>
              {notification.priority}
            </span>
            <span className={`inline-flex h-5 items-center rounded-md border px-2 text-[10px] uppercase tracking-wide ${categoryClass(notification.category)}`}>
              {notification.category}
            </span>
            {notification.status === 'reviewed' && (
              <Badge variant="success" className="text-[10px]">Reviewed</Badge>
            )}
            {notification.status === 'dismissed' && (
              <Badge variant="default" className="text-[10px]">Dismissed</Badge>
            )}
            <span className="text-[11px] text-[var(--text-muted)]">{formatDate(notification.created_at)}</span>
          </div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{notification.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">{notification.message}</p>
          {(notification.metadata?.count as number | undefined) && (notification.metadata.count as number) > 1 && (
            <p className="mt-1 text-[11px] text-[var(--text-subtle)]">
              Updated {String(notification.metadata.count)} times.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          {notification.action_href && (
            <Link
              href={notification.action_href}
              onClick={() => isUnread && onMarkRead(notification.id)}
              className="inline-flex h-8 items-center rounded-md bg-[var(--brand)] px-3 text-xs font-medium text-white hover:opacity-90"
            >
              {notification.action_label ?? 'Open'}
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-1">
            {isUnread && (
              <button
                type="button"
                onClick={() => onMarkRead(notification.id)}
                className="inline-flex h-8 items-center rounded-md border border-[var(--border-subtle)] px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--foreground)]"
              >
                Read
              </button>
            )}
            {notification.status !== 'reviewed' && (
              <button
                type="button"
                onClick={() => onMarkReviewed(notification.id)}
                className="inline-flex h-8 items-center rounded-md border border-[var(--border-subtle)] px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--foreground)]"
              >
                Reviewed
              </button>
            )}
            {notification.status !== 'dismissed' && (
              <button
                type="button"
                onClick={() => onDismiss(notification.id)}
                className="inline-flex h-8 items-center rounded-md border border-[var(--border-subtle)] px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--foreground)]"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function NotificationsPage() {
  const { isDeveloper } = useRole();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>('forme');
  const [filters, setFilters] = useState<FilterState>({
    status: 'any',
    priority: 'any',
    category: 'any',
    search: '',
  });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyNotificationsAction({ limit: 300 });
      if (res.success && Array.isArray(res.data)) {
        setNotifications(res.data as NotificationRow[]);
      } else {
        setNotifications([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const handleMarkRead = useCallback(
    async (id: string) => {
      const res = await markNotificationStatusAction(id, 'read');
      if (!res.success) toast('error', res.error ?? 'Failed to mark as read');
      void fetchAll();
    },
    [fetchAll, toast],
  );

  const handleMarkReviewed = useCallback(
    async (id: string) => {
      const res = await markNotificationStatusAction(id, 'reviewed');
      if (!res.success) toast('error', res.error ?? 'Failed to mark as reviewed');
      void fetchAll();
    },
    [fetchAll, toast],
  );

  const handleDismiss = useCallback(
    async (id: string) => {
      const res = await markNotificationStatusAction(id, 'dismissed');
      if (!res.success) toast('error', res.error ?? 'Failed to dismiss');
      void fetchAll();
    },
    [fetchAll, toast],
  );

  const handleMarkAll = useCallback(async () => {
    const res = await markAllNotificationsReadAction();
    if (!res.success) toast('error', res.error ?? 'Failed to mark all read');
    else toast('success', 'Notifications marked as read');
    void fetchAll();
  }, [fetchAll, toast]);

  const handleTest = useCallback(async () => {
    const res = await createTestNotificationToSelfAction();
    if (!res.success) toast('error', res.error ?? 'Failed to send test');
    else toast('success', 'Test notification queued');
    void fetchAll();
  }, [fetchAll, toast]);

  const filtered = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return notifications.filter((n) => {
      if (tab === 'reviewed' && n.status !== 'reviewed') return false;
      if (tab !== 'reviewed' && n.status === 'dismissed') return false;
      if (tab !== 'reviewed' && tab !== 'forme') {
        const allowedCategories = TAB_CATEGORY[tab];
        if (Array.isArray(allowedCategories) && !allowedCategories.includes(n.category)) {
          return false;
        }
      }
      if (filters.status !== 'any' && n.status !== filters.status) return false;
      if (filters.priority !== 'any' && n.priority !== filters.priority) return false;
      if (filters.category !== 'any' && n.category !== filters.category) return false;
      if (search) {
        const haystack = `${n.title} ${n.message}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [filters, notifications, tab]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {
      forme: 0,
      critical: 0,
      tasks: 0,
      requests: 0,
      compliance: 0,
      stock: 0,
      system: 0,
      reviewed: 0,
    };
    for (const n of notifications) {
      if (n.status === 'reviewed') out.reviewed++;
      if (n.status === 'dismissed') continue;
      out.forme++;
      if (n.category === 'critical') out.critical++;
      if (n.category === 'task') out.tasks++;
      if (n.category === 'request') out.requests++;
      if (n.category === 'compliance') out.compliance++;
      if (n.category === 'stock' || n.category === 'procurement') out.stock++;
      if (n.category === 'system' || n.category === 'offline' || n.category === 'qr') out.system++;
    }
    return out;
  }, [notifications]);

  const renderList = (rows: NotificationRow[]) => {
    if (rows.length === 0) {
      return (
        <Card>
          <CardContent className="py-6">
            <EmptyState
              lottie="notification"
              icon={<Bell className="h-10 w-10" />}
              title="You're all caught up"
              description="Nothing in this view right now. New notifications will show up here automatically."
              compact
            />
          </CardContent>
        </Card>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {rows.map((n) => (
          <NotificationItem
            key={n.id}
            notification={n}
            onMarkRead={handleMarkRead}
            onMarkReviewed={handleMarkReviewed}
            onDismiss={handleDismiss}
          />
        ))}
      </div>
    );
  };

  const tabs = [
    { id: 'forme', label: 'For Me', count: counts.forme, content: renderList(filtered) },
    { id: 'critical', label: 'Critical', count: counts.critical, content: renderList(filtered) },
    { id: 'tasks', label: 'Tasks', count: counts.tasks, content: renderList(filtered) },
    { id: 'requests', label: 'Requests', count: counts.requests, content: renderList(filtered) },
    { id: 'compliance', label: 'Compliance', count: counts.compliance, content: renderList(filtered) },
    { id: 'stock', label: 'Stock & Procurement', count: counts.stock, content: renderList(filtered) },
    { id: 'system', label: 'System', count: counts.system, content: renderList(filtered) },
    { id: 'reviewed', label: 'Reviewed', count: counts.reviewed, content: renderList(filtered) },
  ];

  if (loading) return <PageLoader />;

  const criticalUnread = notifications.filter((n) => n.priority === 'critical' && n.status === 'unread').length;
  const unread = notifications.filter((n) => n.status === 'unread').length;

  return (
    <div className="space-y-5">
      <AssistantPageContextBridge
        moduleLabel="Notifications"
        pageLabel="Notification Center"
        selectedRecordType="notification"
        activeTab={tab}
        pageSummary="Unified BMEDIS Notification Center. Tabs filter by role-relevant category (For Me, Critical, Tasks, Requests, Compliance, Stock & Procurement, System, Reviewed). Telegram is an optional external delivery channel and never an authorization plane; in-app notifications are the canonical source of truth."
        visibleCounts={{
          total: notifications.length,
          unread,
          critical_unread: criticalUnread,
          reviewed: counts.reviewed,
          active_tab_count: filtered.length,
        }}
        pageDataHints={[
          `Active tab: ${tab}`,
          `Filter status=${filters.status} priority=${filters.priority} category=${filters.category}`,
          'Source tables: notifications, notification_events, notification_deliveries, notification_rule_logs, telegram_connections.',
          'Telegram delivery is opt-in per user and only fires for eligible events (priority >= TELEGRAM_MIN_PRIORITY, or specific event types).',
        ]}
        availableEvidenceLinks={[
          { label: 'Notification Center', href: '/notifications', type: 'notifications' },
          ...(isDeveloper
            ? [{ label: 'Developer Lab — Notification Diagnostics', href: '/developer-lab#notification-diagnostics', type: 'diagnostics' }]
            : []),
        ]}
        quickPrompts={[
          'Why did I get this notification?',
          'Why didn\'t Telegram send?',
          'When was the last notification rule check?',
          'What does no_chat_id mean?',
        ]}
      />
      <PageHeader
        title="Notifications"
        description="Centralized inbox for everything that needs your attention. Quick personal updates also appear in the bell at the top right."
        breadcrumbs={[{ label: 'Command Center', href: '/command' }, { label: 'Notifications' }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => void fetchAll()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button variant="secondary" onClick={() => void handleMarkAll()}>
              <CheckCheck className="mr-2 h-4 w-4" /> Mark all read
            </Button>
            <Button onClick={() => void handleTest()}>
              <ShieldAlert className="mr-2 h-4 w-4" /> Send test
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="flex min-w-0 flex-wrap items-center gap-3">
          <Filter className="h-4 w-4 text-[var(--text-muted)]" />
          <select
            value={filters.priority}
            onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as FilterState['priority'] }))}
            className="h-10 min-w-[8rem] flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 text-xs sm:h-9 sm:flex-none"
            aria-label="Filter by priority"
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>{p === 'any' ? 'All priorities' : p}</option>
            ))}
          </select>
          <select
            value={filters.category}
            onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value as FilterState['category'] }))}
            className="h-10 min-w-[8rem] flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 text-xs sm:h-9 sm:flex-none"
            aria-label="Filter by category"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>{c === 'any' ? 'All categories' : c}</option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as FilterState['status'] }))}
            className="h-10 min-w-[8rem] flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 text-xs sm:h-9 sm:flex-none"
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === 'any' ? 'All statuses' : s}</option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search title or message…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            className="h-10 min-w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 text-xs sm:h-9 sm:min-w-[16rem]"
            aria-label="Search notifications"
          />
          <button
            type="button"
            onClick={() => setFilters({ status: 'any', priority: 'any', category: 'any', search: '' })}
            className="h-9 rounded-md border border-[var(--border-subtle)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--foreground)]"
          >
            Reset
          </button>
          <span className="text-[11px] text-[var(--text-subtle)] sm:ml-auto">
            Showing {filtered.length} of {notifications.length}
          </span>
        </CardContent>
      </Card>

      <Tabs tabs={tabs} activeTab={tab} onChange={(id) => setTab(id)} />

      {isDeveloper && (
        <Card>
          <CardContent>
            <p className="text-xs font-medium text-[var(--foreground)]">Developer diagnostics</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Full rule, delivery, and Telegram diagnostics live in
              {' '}
              <Link href="/developer-lab#notification-diagnostics" className="text-[var(--brand)] hover:underline">
                Developer Lab → Notification & Telegram Diagnostics
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
