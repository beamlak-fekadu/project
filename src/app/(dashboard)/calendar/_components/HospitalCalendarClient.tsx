'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Filter,
  Info,
  ListChecks,
  PanelRightClose,
  RotateCcw,
} from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import {
  CALENDAR_STATUS_LABELS,
  CALENDAR_TYPE_ICONS,
  CALENDAR_TYPE_LABELS,
  CALENDAR_TYPE_STYLES,
  type CalendarEvent,
  type CalendarEventStatus,
  type CalendarEventType,
  type CalendarSourceWarning,
  type HospitalCalendarData,
  formatCalendarLabel,
  isTerminalCalendarStatus,
  sortCalendarEvents,
} from '../_lib/calendar-semantics';

type ViewMode = 'month' | 'week' | 'day' | 'list';
type DatePreset = 'visible' | 'today' | 'week' | 'month' | 'next30' | 'overdue';

const TYPE_OPTIONS: Array<CalendarEventType | 'all'> = [
  'all',
  'pm',
  'calibration',
  'work_order',
  'maintenance_request',
  'training',
  'installation',
  'procurement',
  'disposal',
  'document',
];

const STATUS_OPTIONS: Array<CalendarEventStatus | 'all'> = [
  'all',
  'overdue',
  'due_soon',
  'scheduled',
  'pending',
  'approved',
  'assigned',
  'in_progress',
  'on_hold',
  'delayed',
  'completed',
  'cancelled',
  'info',
];

const PRIORITY_OPTIONS = ['all', 'critical', 'high', 'medium', 'low'] as const;

function parseEventDate(value: string) {
  return parseISO(value.includes('T') ? value : `${value}T00:00:00`);
}

function dayKey(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

function eventDayKey(event: CalendarEvent) {
  return event.startDate.slice(0, 10);
}

function eventInRange(event: CalendarEvent, start: Date, end: Date) {
  const date = startOfDay(parseEventDate(event.startDate));
  return date >= startOfDay(start) && date <= startOfDay(end);
}

function statusBadgeVariant(status: CalendarEventStatus): 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple' {
  if (status === 'overdue' || status === 'delayed' || status === 'on_hold') return 'error';
  if (status === 'due_soon' || status === 'pending') return 'warning';
  if (status === 'completed') return 'success';
  if (status === 'in_progress' || status === 'assigned') return 'purple';
  if (status === 'approved' || status === 'scheduled') return 'info';
  return 'default';
}

function priorityRank(value?: string | null) {
  const ranks: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return ranks[value ?? ''] ?? 4;
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function TogglePill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 rounded-lg border px-3 text-xs font-medium transition-colors ${
        active
          ? 'border-[var(--brand)] bg-[var(--brand)] text-white'
          : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]'
      }`}
    >
      {label}
    </button>
  );
}

function EventChip({
  event,
  compact = false,
  onOpen,
}: {
  event: CalendarEvent;
  compact?: boolean;
  onOpen: (event: CalendarEvent) => void;
}) {
  const Icon = CALENDAR_TYPE_ICONS[event.sourceType];
  return (
    <button
      type="button"
      onClick={(click) => {
        click.stopPropagation();
        onOpen(event);
      }}
      className={`w-full rounded-md border px-2 py-1 text-left transition hover:brightness-110 ${CALENDAR_TYPE_STYLES[event.sourceType]} ${event.status === 'overdue' || event.status === 'delayed' ? 'ring-1 ring-rose-400/50' : ''}`}
      title={`${CALENDAR_TYPE_LABELS[event.sourceType]}: ${event.title}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-xs font-semibold">{event.title}</span>
      </span>
      {!compact && (
        <span className="mt-0.5 flex items-center gap-1 text-[10px] opacity-85">
          <span>{CALENDAR_TYPE_LABELS[event.sourceType]}</span>
          {(event.status === 'overdue' || event.status === 'delayed' || event.status === 'on_hold') && (
            <span>· {CALENDAR_STATUS_LABELS[event.status]}</span>
          )}
        </span>
      )}
    </button>
  );
}

function EventRow({ event, onOpen }: { event: CalendarEvent; onOpen: (event: CalendarEvent) => void }) {
  const Icon = CALENDAR_TYPE_ICONS[event.sourceType];
  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      className="grid w-full grid-cols-1 gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-left transition hover:border-[var(--brand)]/50 hover:bg-[var(--surface-2)] md:grid-cols-[7rem_9rem_1fr_8rem_8rem]"
    >
      <div className="text-sm font-semibold text-[var(--foreground)]">{format(parseEventDate(event.startDate), 'MMM d, yyyy')}</div>
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <Icon className="h-4 w-4" />
        {CALENDAR_TYPE_LABELS[event.sourceType]}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[var(--foreground)]">{event.title}</p>
        <p className="truncate text-xs text-[var(--text-muted)]">
          {[event.assetCode, event.assetName, event.departmentName].filter(Boolean).join(' · ') || event.subtitle || 'General operation'}
        </p>
      </div>
      <Badge variant={statusBadgeVariant(event.status)}>{CALENDAR_STATUS_LABELS[event.status]}</Badge>
      <span className="text-xs text-[var(--text-muted)]">{event.assignedToName ?? 'Unassigned'}</span>
    </button>
  );
}

function SourceWarnings({ warnings, canSeeDetails }: { warnings: CalendarSourceWarning[]; canSeeDetails: boolean }) {
  if (warnings.length === 0) return null;

  const labels = warnings.map((warning) => warning.label).join(', ');

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
      <p className="font-medium">Some event sources could not be loaded: {labels}.</p>
      {canSeeDetails && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-amber-100 hover:text-white">
            Show source details
          </summary>
          <div className="mt-2 space-y-2">
            {warnings.map((warning) => (
              <div key={warning.source} className="rounded-md border border-amber-500/20 bg-black/10 p-2 dark:bg-white/5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="warning">{warning.label}</Badge>
                  <code className="text-[11px] text-amber-100">{warning.source}</code>
                </div>
                <p className="mt-1 text-xs text-amber-100">{warning.message}</p>
                {warning.hint && <p className="mt-1 text-xs text-amber-50/90">Suggested fix: {warning.hint}</p>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function DetailPanel({ event, onClose }: { event: CalendarEvent | null; onClose: () => void }) {
  if (!event) {
    return (
      <aside className="panel-surface rounded-lg p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
          <Info className="h-4 w-4 text-[var(--brand)]" />
          Event details
        </div>
        <p className="mt-2 text-sm text-[var(--text-muted)]">Select an event to inspect its source record and next action.</p>
      </aside>
    );
  }

  const Icon = CALENDAR_TYPE_ICONS[event.sourceType];
  const rows = [
    ['Date', format(parseEventDate(event.startDate), 'MMMM d, yyyy')],
    ['Status', CALENDAR_STATUS_LABELS[event.status]],
    ['Asset', [event.assetCode, event.assetName].filter(Boolean).join(' - ') || 'Not linked'],
    ['Department', event.departmentName ?? 'Not recorded'],
    ['Assigned', event.assignedToName ?? 'Unassigned'],
    ['Priority', event.priority ? formatCalendarLabel(event.priority) : 'Not recorded'],
    ['Criticality', event.criticality ? formatCalendarLabel(event.criticality) : 'Not recorded'],
    ['Source', event.sourceTable],
  ];

  return (
    <aside className="panel-surface rounded-lg p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${CALENDAR_TYPE_STYLES[event.sourceType]}`}>
              <Icon className="h-3.5 w-3.5" />
              {CALENDAR_TYPE_LABELS[event.sourceType]}
            </span>
            <Badge variant={statusBadgeVariant(event.status)}>{CALENDAR_STATUS_LABELS[event.status]}</Badge>
          </div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">{event.title}</h2>
          {event.subtitle && <p className="mt-1 text-sm text-[var(--text-muted)]">{event.subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          title="Close details"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[6rem_1fr] gap-3 border-b border-[var(--border-subtle)] py-2 text-sm last:border-b-0">
            <span className="text-xs font-medium uppercase text-[var(--text-muted)]">{label}</span>
            <span className="min-w-0 text-[var(--foreground)]">{value}</span>
          </div>
        ))}
      </div>

      {event.description && (
        <div className="mt-4 rounded-lg bg-[var(--surface-2)] p-3">
          <p className="text-xs font-semibold uppercase text-[var(--text-muted)]">Description</p>
          <p className="mt-1 text-sm text-[var(--foreground)]">{event.description}</p>
        </div>
      )}

      <Link
        href={event.href}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-strong)]"
      >
        {event.actionLabel}
        <ExternalLink className="h-4 w-4" />
      </Link>
    </aside>
  );
}

function buildIcs(events: CalendarEvent[]) {
  const escapeText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BMERMS//Hospital Operations Calendar//EN',
    'CALSCALE:GREGORIAN',
    ...events.flatMap((event) => {
      const start = event.startDate.replace(/-/g, '');
      const endDate = addDays(parseEventDate(event.startDate), 1);
      const end = format(endDate, 'yyyyMMdd');
      return [
        'BEGIN:VEVENT',
        `UID:${event.id}@bmerms.internal`,
        `DTSTAMP:${format(new Date(), "yyyyMMdd'T'HHmmss'Z'")}`,
        `DTSTART;VALUE=DATE:${start}`,
        `DTEND;VALUE=DATE:${end}`,
        `SUMMARY:${escapeText(event.title)}`,
        `DESCRIPTION:${escapeText([event.description, event.href].filter(Boolean).join('\\n'))}`,
        `CATEGORIES:${escapeText(CALENDAR_TYPE_LABELS[event.sourceType])}`,
        `STATUS:${event.status === 'completed' ? 'CONFIRMED' : 'TENTATIVE'}`,
        'END:VEVENT',
      ];
    }),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

export default function HospitalCalendarClient({ data }: { data: HospitalCalendarData }) {
  const searchParams = useSearchParams();
  const today = useMemo(() => startOfDay(new Date()), []);
  const [view, setView] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState(today);
  const [selectedDay, setSelectedDay] = useState(today);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const initialType = TYPE_OPTIONS.includes(searchParams.get('type') as CalendarEventType) ? searchParams.get('type') as CalendarEventType : 'all';
  // Viewer-only default: prefer management-significant events. The user can
  // still flip these toggles, but the initial view shows critical/high
  // priority events and excludes completed/cancelled noise.
  const isViewerOnly = data.scope.roleNames.length > 0
    && data.scope.roleNames.includes('viewer')
    && !data.scope.roleNames.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head');
  const isStoreOnly = data.scope.roleNames.length > 0
    && data.scope.roleNames.includes('store_user')
    && !data.scope.roleNames.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  const isDepartmentOnly = data.scope.roleNames.length > 0
    && (data.scope.roleNames.includes('department_head') || data.scope.roleNames.includes('department_user'))
    && !data.scope.roleNames.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  // For store_user, default the type filter to procurement so logistics
  // events surface first. Users can still flip to other event types.
  const storeDefaultType: CalendarEventType | 'all' = 'procurement';
  const [typeFilter, setTypeFilter] = useState<CalendarEventType | 'all'>(isStoreOnly && initialType === 'all' ? storeDefaultType : initialType);
  const [statusFilter, setStatusFilter] = useState<CalendarEventStatus | 'all'>('all');
  // For department roles, default the department filter to the user's
  // department so events from other departments are not shown by default.
  // The user can still flip the filter to "all" if needed.
  const [departmentFilter, setDepartmentFilter] = useState(isDepartmentOnly && data.scope.departmentName ? data.scope.departmentName : 'all');
  const [assignedFilter, setAssignedFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState<(typeof PRIORITY_OPTIONS)[number]>(isViewerOnly ? 'high' : 'all');
  const [datePreset, setDatePreset] = useState<DatePreset>('visible');
  const [showCompleted, setShowCompleted] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [myAssignmentsOnly, setMyAssignmentsOnly] = useState(false);
  const canSeeWarningDetails = data.scope.roleNames.some((role) => ['developer', 'admin', 'bme_head'].includes(role));

  const visibleRange = useMemo(() => {
    if (view === 'month') {
      return { start: startOfWeek(startOfMonth(cursor)), end: endOfWeek(endOfMonth(cursor)) };
    }
    if (view === 'week') return { start: startOfWeek(cursor), end: endOfWeek(cursor) };
    if (view === 'day') return { start: cursor, end: cursor };
    return { start: today, end: addDays(today, 30) };
  }, [cursor, today, view]);

  const presetRange = useMemo(() => {
    if (datePreset === 'today') return { start: today, end: today };
    if (datePreset === 'week') return { start: startOfWeek(today), end: endOfWeek(today) };
    if (datePreset === 'month') return { start: startOfMonth(today), end: endOfMonth(today) };
    if (datePreset === 'next30') return { start: today, end: addDays(today, 30) };
    if (datePreset === 'overdue') return { start: new Date('2000-01-01T00:00:00'), end: today };
    return visibleRange;
  }, [datePreset, today, visibleRange]);

  const departments = useMemo(() => {
    const names = Array.from(new Set(data.events.map((event) => event.departmentName).filter(Boolean) as string[])).sort();
    return [{ value: 'all', label: 'All departments' }, ...names.map((name) => ({ value: name, label: name }))];
  }, [data.events]);

  const assignees = useMemo(() => {
    const names = Array.from(new Set(data.events.map((event) => event.assignedToName).filter(Boolean) as string[])).sort();
    return [{ value: 'all', label: 'All assignees' }, { value: 'unassigned', label: 'Unassigned' }, ...names.map((name) => ({ value: name, label: name }))];
  }, [data.events]);

  const filteredEvents = useMemo(() => {
    return sortCalendarEvents(data.events.filter((event) => {
      if (!eventInRange(event, presetRange.start, presetRange.end)) return false;
      if (typeFilter !== 'all' && event.sourceType !== typeFilter) return false;
      if (statusFilter !== 'all' && event.status !== statusFilter) return false;
      if (departmentFilter !== 'all' && event.departmentName !== departmentFilter) return false;
      if (assignedFilter === 'unassigned' && event.assignedToName) return false;
      if (assignedFilter !== 'all' && assignedFilter !== 'unassigned' && event.assignedToName !== assignedFilter) return false;
      if (priorityFilter !== 'all' && event.priority !== priorityFilter && event.criticality !== priorityFilter) return false;
      if (!showCompleted && isTerminalCalendarStatus(event.status)) return false;
      if (overdueOnly && event.status !== 'overdue' && event.status !== 'delayed') return false;
      if (myAssignmentsOnly && event.metadata?.assignedProfileId !== data.scope.profileId) return false;
      return true;
    })).sort((a, b) => priorityRank(a.priority ?? a.criticality) - priorityRank(b.priority ?? b.criticality) || a.startDate.localeCompare(b.startDate));
  }, [assignedFilter, data.events, data.scope.profileId, departmentFilter, myAssignmentsOnly, overdueOnly, presetRange.end, presetRange.start, priorityFilter, showCompleted, statusFilter, typeFilter]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of filteredEvents) {
      const key = eventDayKey(event);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [filteredEvents]);

  const visibleEvents = useMemo(() => filteredEvents.filter((event) => eventInRange(event, visibleRange.start, visibleRange.end)), [filteredEvents, visibleRange]);
  const selectedDayEvents = eventsByDay.get(dayKey(selectedDay)) ?? [];
  const monthDays = useMemo(() => eachDayOfInterval(visibleRange), [visibleRange]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: startOfWeek(cursor), end: endOfWeek(cursor) }), [cursor]);

  const periodTitle = view === 'month'
    ? format(cursor, 'MMMM yyyy')
    : view === 'week'
      ? `Week of ${format(startOfWeek(cursor), 'MMM d, yyyy')}`
      : view === 'day'
        ? format(cursor, 'MMMM d, yyyy')
        : `${format(presetRange.start, 'MMM d')} - ${format(presetRange.end, 'MMM d, yyyy')}`;

  const legendCounts = useMemo(() => {
    const counts = new Map<CalendarEventType, number>();
    for (const event of visibleEvents) counts.set(event.sourceType, (counts.get(event.sourceType) ?? 0) + 1);
    return counts;
  }, [visibleEvents]);

  const goPrevious = () => {
    if (view === 'month') setCursor((date) => subMonths(date, 1));
    if (view === 'week') setCursor((date) => addDays(date, -7));
    if (view === 'day') setCursor((date) => addDays(date, -1));
    if (view === 'list') setCursor((date) => subMonths(date, 1));
  };

  const goNext = () => {
    if (view === 'month') setCursor((date) => addMonths(date, 1));
    if (view === 'week') setCursor((date) => addDays(date, 7));
    if (view === 'day') setCursor((date) => addDays(date, 1));
    if (view === 'list') setCursor((date) => addMonths(date, 1));
  };

  const resetFilters = () => {
    setTypeFilter('all');
    setStatusFilter('all');
    setDepartmentFilter('all');
    setAssignedFilter('all');
    setPriorityFilter('all');
    setDatePreset('visible');
    setShowCompleted(false);
    setOverdueOnly(false);
    setMyAssignmentsOnly(false);
  };

  const exportIcs = () => {
    const blob = new Blob([buildIcs(filteredEvents)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `bmerms-calendar-${format(new Date(), 'yyyy-MM-dd')}.ics`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <SourceWarnings warnings={data.warnings} canSeeDetails={canSeeWarningDetails} />

      <section className="panel-surface rounded-lg p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" onClick={goPrevious} title="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => { setCursor(today); setSelectedDay(today); }}>
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={goNext} title="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="ml-1 flex min-w-[12rem] items-center gap-2 text-lg font-semibold text-[var(--foreground)]">
              <CalendarDays className="h-5 w-5 text-[var(--brand)]" />
              {periodTitle}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['month', 'week', 'day', 'list'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={`h-9 rounded-lg px-3 text-sm font-medium transition-colors ${
                  view === mode ? 'bg-[var(--brand)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]'
                }`}
              >
                {formatCalendarLabel(mode)}
              </button>
            ))}
            <Button variant="outline" onClick={exportIcs} title="Export visible events">
              <Download className="h-4 w-4" />
              Export .ics
            </Button>
          </div>
        </div>
      </section>

      <section className="panel-surface rounded-lg p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
          <Filter className="h-4 w-4 text-[var(--brand)]" />
          Filters
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <SelectField
            label="Event type"
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as CalendarEventType | 'all')}
            options={TYPE_OPTIONS.map((value) => ({ value, label: value === 'all' ? 'All types' : CALENDAR_TYPE_LABELS[value] }))}
          />
          <SelectField
            label="Status"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as CalendarEventStatus | 'all')}
            options={STATUS_OPTIONS.map((value) => ({ value, label: value === 'all' ? 'All statuses' : CALENDAR_STATUS_LABELS[value] }))}
          />
          <SelectField label="Department" value={departmentFilter} onChange={setDepartmentFilter} options={departments} />
          <SelectField label="Assigned" value={assignedFilter} onChange={setAssignedFilter} options={assignees} />
          <SelectField
            label="Priority / criticality"
            value={priorityFilter}
            onChange={(value) => setPriorityFilter(value as (typeof PRIORITY_OPTIONS)[number])}
            options={PRIORITY_OPTIONS.map((value) => ({ value, label: value === 'all' ? 'All priorities' : formatCalendarLabel(value) }))}
          />
          <SelectField
            label="Date range"
            value={datePreset}
            onChange={(value) => {
              setDatePreset(value as DatePreset);
              if (value === 'overdue') setOverdueOnly(true);
            }}
            options={[
              { value: 'visible', label: 'All visible range' },
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'This week' },
              { value: 'month', label: 'This month' },
              { value: 'next30', label: 'Next 30 days' },
              { value: 'overdue', label: 'Overdue' },
            ]}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TogglePill active={showCompleted} label="Show completed" onClick={() => setShowCompleted((value) => !value)} />
          <TogglePill active={overdueOnly} label="Overdue only" onClick={() => setOverdueOnly((value) => !value)} />
          <TogglePill active={myAssignmentsOnly} label="My assignments only" onClick={() => setMyAssignmentsOnly((value) => !value)} />
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
        </div>
      </section>

      <section className="panel-surface rounded-lg p-4">
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.filter((type): type is CalendarEventType => type !== 'all').map((type) => {
            const Icon = CALENDAR_TYPE_ICONS[type];
            return (
              <button
                type="button"
                key={type}
                onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
                className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${CALENDAR_TYPE_STYLES[type]} ${typeFilter === type ? 'ring-1 ring-[var(--brand)]' : ''}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {CALENDAR_TYPE_LABELS[type]}
                <span className="rounded bg-black/10 px-1.5 py-px dark:bg-white/10">{legendCounts.get(type) ?? 0}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_22rem]">
        <main className="min-w-0">
          {view === 'month' && (
            <section className="panel-surface overflow-hidden rounded-lg">
              <div className="hidden grid-cols-7 border-b border-[var(--border-subtle)] lg:grid">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day} className="px-3 py-2 text-xs font-semibold uppercase text-[var(--text-muted)]">{day}</div>
                ))}
              </div>
              <div className="hidden grid-cols-7 lg:grid">
                {monthDays.map((day) => {
                  const key = dayKey(day);
                  const events = eventsByDay.get(key) ?? [];
                  const visible = events.slice(0, 4);
                  const extra = events.length - visible.length;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      className={`min-h-[9.5rem] border-b border-r border-[var(--border-subtle)] p-2 text-left transition hover:bg-[var(--surface-2)] ${
                        !isSameMonth(day, cursor) ? 'opacity-45' : ''
                      } ${isSameDay(day, today) ? 'bg-[var(--brand)]/5' : ''} ${isSameDay(day, selectedDay) ? 'outline outline-1 outline-[var(--brand)]' : ''}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${isSameDay(day, today) ? 'bg-[var(--brand)] text-white' : 'text-[var(--foreground)]'}`}>
                          {format(day, 'd')}
                        </span>
                        {events.some((event) => event.status === 'overdue' || event.status === 'delayed') && (
                          <span className="rounded bg-rose-500/15 px-1.5 py-px text-[10px] font-semibold text-rose-300">Overdue</span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {visible.map((event) => <EventChip key={event.id} event={event} compact onOpen={setSelectedEvent} />)}
                        {extra > 0 && <span className="block text-xs font-medium text-[var(--text-muted)]">+{extra} more</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="space-y-2 p-3 lg:hidden">
                {visibleEvents.length === 0 ? (
                  <EmptyCalendarState />
                ) : visibleEvents.map((event) => <EventRow key={event.id} event={event} onOpen={setSelectedEvent} />)}
              </div>
            </section>
          )}

          {view === 'week' && (
            <section className="panel-surface rounded-lg p-4">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-7">
                {weekDays.map((day) => {
                  const events = eventsByDay.get(dayKey(day)) ?? [];
                  return (
                    <div key={dayKey(day)} className={`rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 ${isSameDay(day, today) ? 'ring-1 ring-[var(--brand)]' : ''}`}>
                      <button type="button" onClick={() => { setSelectedDay(day); setCursor(day); setView('day'); }} className="mb-3 text-left">
                        <p className="text-xs font-semibold uppercase text-[var(--text-muted)]">{format(day, 'EEE')}</p>
                        <p className="text-lg font-semibold text-[var(--foreground)]">{format(day, 'MMM d')}</p>
                      </button>
                      <div className="space-y-2">
                        {events.length === 0 ? <p className="text-xs text-[var(--text-muted)]">No events</p> : events.map((event) => <EventChip key={event.id} event={event} onOpen={setSelectedEvent} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {view === 'day' && (
            <section className="panel-surface rounded-lg p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">{format(cursor, 'EEEE')}</p>
                  <h2 className="text-xl font-bold text-[var(--foreground)]">{format(cursor, 'MMMM d, yyyy')}</h2>
                </div>
                <Badge variant="info">{selectedDayEvents.length} events</Badge>
              </div>
              <DayGroups events={eventsByDay.get(dayKey(cursor)) ?? []} onOpen={setSelectedEvent} />
            </section>
          )}

          {view === 'list' && (
            <section className="panel-surface rounded-lg p-4">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                <ListChecks className="h-4 w-4 text-[var(--brand)]" />
                Chronological operations list
              </div>
              {filteredEvents.length === 0 ? <EmptyCalendarState /> : (
                <div className="space-y-2">
                  {filteredEvents.map((event) => <EventRow key={event.id} event={event} onOpen={setSelectedEvent} />)}
                </div>
              )}
            </section>
          )}
        </main>

        <div className="space-y-5">
          <DetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
          <section className="panel-surface rounded-lg p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">{format(selectedDay, 'MMM d, yyyy')}</h2>
              <Badge variant="default">{selectedDayEvents.length}</Badge>
            </div>
            <div className="space-y-2">
              {selectedDayEvents.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No events found for this day.</p>
              ) : selectedDayEvents.map((event) => <EventChip key={event.id} event={event} onOpen={setSelectedEvent} />)}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function DayGroups({ events, onOpen }: { events: CalendarEvent[]; onOpen: (event: CalendarEvent) => void }) {
  const groups = [
    { label: 'Urgent / Overdue', events: events.filter((event) => ['overdue', 'delayed', 'on_hold'].includes(event.status)) },
    { label: 'Scheduled Today', events: events.filter((event) => ['scheduled', 'due_soon', 'pending', 'approved', 'assigned', 'in_progress'].includes(event.status)) },
    { label: 'Completed Today', events: events.filter((event) => event.status === 'completed') },
    { label: 'Other', events: events.filter((event) => event.status === 'info' || event.status === 'cancelled') },
  ];

  if (events.length === 0) return <EmptyCalendarState />;

  return (
    <div className="space-y-5">
      {groups.filter((group) => group.events.length > 0).map((group) => (
        <div key={group.label}>
          <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--text-muted)]">{group.label}</h3>
          <div className="space-y-2">
            {group.events.map((event) => <EventRow key={event.id} event={event} onOpen={onOpen} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyCalendarState() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-8 text-center">
      <p className="text-sm font-medium text-[var(--foreground)]">No events found for this period/filter.</p>
    </div>
  );
}
