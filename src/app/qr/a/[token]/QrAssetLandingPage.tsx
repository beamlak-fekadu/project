import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Beaker,
  Building2,
  CalendarCheck,
  CheckCircle,
  Clock,
  FileText,
  Layers,
  Package,
  QrCode,
  ShieldAlert,
  UserRound,
  Wrench,
} from 'lucide-react';
import LogoMark from '@/components/brand/LogoMark';
import NetworkStatusPill from '@/components/offline/NetworkStatusPill';
import { Badge, EmptyState, Tabs } from '@/components/ui';
import { ConditionBadge } from '@/components/ui/StatusBadge';
import {
  formatQrLabelStatus,
  getQrLabelStatusBadgeVariant,
  type QrLabelStatus,
} from '@/types/qr';
import { APP_NAME_SHORT, HOSPITAL_NAME } from '@/constants';
import type { QrLandingAsset } from '@/services/qr.service';
import type {
  QrCalibrationRecordRow,
  QrMaintenanceEventRow,
  QrMaintenanceRequestRow,
  QrPmScheduleRow,
  QrProfileContext,
  QrRoleCategory,
  QrRoleContext,
  QrStockIssueRow,
  QrWorkOrderRow,
} from '@/services/qr-context.service';
import QrRoleActions, { type QrAction } from './components/QrRoleActions';
import QrOfflineActions from './components/QrOfflineActions';

type Props = {
  asset: QrLandingAsset;
  profile: QrProfileContext;
  context: QrRoleContext;
};

const VALID_CONDITIONS = ['functional', 'needs_repair', 'non_functional', 'under_maintenance', 'decommissioned'];

function formatLabel(value: string | null | undefined): string {
  if (!value) return 'Not available';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleDateString();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleString();
}

function roleLabel(role: QrRoleCategory): string {
  if (role === 'bme_head') return 'BME Head / Admin';
  if (role === 'department_head') return 'Department Head';
  if (role === 'department_user') return 'Department User';
  if (role === 'store_user') return 'Store User';
  if (role === 'unknown') return 'Authenticated User';
  return formatLabel(role);
}

function badgeVariant(value: string | null | undefined): 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple' {
  if (!value) return 'default';
  if (['critical', 'high', 'overdue', 'non_functional', 'failed', 'on_hold'].includes(value)) return 'error';
  if (['medium', 'needs_repair', 'due_soon', 'pending', 'deferred'].includes(value)) return 'warning';
  if (['functional', 'current', 'completed', 'passed', 'low'].includes(value)) return 'success';
  if (['assigned', 'scheduled', 'approved'].includes(value)) return 'info';
  if (['in_progress', 'under_maintenance'].includes(value)) return 'purple';
  return 'default';
}

function replacementBandLabel(value: string | null | undefined): string {
  if (value === 'strong_candidate') return 'Strong Candidate';
  if (value === 'review_candidate') return 'Review Candidate';
  if (value === 'monitor') return 'Monitor';
  return 'Not available';
}

function requestHref(id: string) {
  return `/maintenance/requests/${id}`;
}

function workOrderHref(id: string) {
  return `/maintenance/work-orders/${id}`;
}

function pmHref(id: string) {
  return `/pm/schedules/${id}`;
}

function calibrationHref(id: string) {
  return `/calibration?calibrationId=${id}&source=qr-scan`;
}

function rowsAvailable(context: QrRoleContext, section: string): boolean {
  return context.queryHealth.find((item) => item.section === section)?.ok ?? false;
}

function strongestOpenRequest(requests: QrMaintenanceRequestRow[]) {
  const rank = { critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>;
  return [...requests].sort((a, b) => (rank[b.urgency ?? ''] ?? 0) - (rank[a.urgency ?? ''] ?? 0))[0] ?? null;
}

function buildActions(asset: QrLandingAsset, context: QrRoleContext): QrAction[] {
  const id = asset.id;
  const source = 'source=qr-scan';
  const assetProfile = `/equipment/${id}?${source}`;
  const maintenanceNew = `/maintenance/requests/new?assetId=${id}&source=qr-scan&type=corrective`;
  const calibrationNew = `/calibration/requests/new?assetId=${id}&source=qr-scan`;
  const trainingNew = `/training?action=new-request&assetId=${id}&source=qr-scan`;
  const requestsTrack = `/requests?assetId=${id}&source=qr-scan`;
  const maintenanceFiltered = `/maintenance?assetId=${id}&source=qr-scan`;
  const pmEvidence = `/pm?assetId=${id}&source=qr-scan`;
  const calibrationEvidence = `/calibration?assetId=${id}&source=qr-scan`;
  const replacementEvidence = `/command/drilldown/replacement/${id}?source=qr-scan`;
  const openRequest = strongestOpenRequest(context.requests.open);
  const openWorkOrder = context.workOrders.open[0] ?? null;
  const assignedWork = context.workOrders.assignedToMe[0] ?? null;
  const firstStockIssue = context.parts.stockIssues[0] ?? null;
  const firstProcurement = context.parts.procurementLinks[0] ?? null;

  if (context.restricted) return [];

  if (context.roleCategory === 'developer') {
    return [
      { id: 'asset', label: 'Open Asset Profile', description: 'Open the full equipment detail and QR identity panel.', href: assetProfile, icon: 'asset', variant: 'primary' },
      { id: 'developer-lab', label: 'Open Developer Lab', description: 'Review QR coverage, data health, and thesis controls.', href: '/developer-lab', icon: 'shield' },
      { id: 'qr-labels', label: 'Open QR Label Sheet', description: 'Print or lifecycle-manage QR labels.', href: `/equipment/qr-labels?assets=${id}`, icon: 'qr' },
      ...(context.route.url ? [{ id: 'copy-qr', label: 'Copy QR URL', description: 'Copy the public scan URL for this label.', copyText: context.route.url, icon: 'copy' as const }] : []),
      { id: 'maintenance', label: 'Review Maintenance', description: 'Open the asset-filtered maintenance surface.', href: maintenanceFiltered, icon: 'wrench' },
      { id: 'reports', label: 'Open Reports', description: 'Review operational and evidence exports.', href: '/reports', icon: 'file' },
    ];
  }

  if (context.roleCategory === 'bme_head') {
    const primary = openRequest && ['critical', 'high'].includes(openRequest.urgency ?? '')
      ? { id: 'review-request', label: 'Review Request', description: `${openRequest.request_number ?? 'Open request'} is ${formatLabel(openRequest.urgency)} urgency.`, href: requestHref(openRequest.id), icon: 'clipboard' as const, variant: 'primary' as const }
      : openWorkOrder
        ? { id: 'open-work', label: 'Open Work Order', description: `${openWorkOrder.work_order_number ?? 'Open work'} is ${formatLabel(openWorkOrder.status)}.`, href: workOrderHref(openWorkOrder.id), icon: 'wrench' as const, variant: 'primary' as const }
        : ['needs_repair', 'non_functional'].includes(asset.condition ?? '')
          ? { id: 'create-work', label: 'Create Work Order', description: 'Asset condition needs operational review.', href: `/maintenance/work-orders/new?asset_id=${id}&work_type=corrective&source=qr-scan`, icon: 'wrench' as const, variant: 'primary' as const }
          : context.pm.overdue.length > 0
            ? { id: 'pm', label: 'Open PM Evidence', description: `${context.pm.overdue.length} overdue PM item(s).`, href: pmEvidence, icon: 'clipboard' as const, variant: 'primary' as const }
            : context.calibration.state === 'overdue'
              ? { id: 'calibration', label: 'Open Calibration Evidence', description: 'Latest calibration is overdue.', href: calibrationEvidence, icon: 'beaker' as const, variant: 'primary' as const }
              : { id: 'asset', label: 'Open Asset Profile', description: 'Review complete equipment evidence.', href: assetProfile, icon: 'asset' as const, variant: 'primary' as const };
    return [
      primary,
      { id: 'requests', label: 'Review Requests', href: requestsTrack, icon: 'clipboard' },
      { id: 'maintenance', label: 'Open Maintenance', href: maintenanceFiltered, icon: 'wrench' },
      { id: 'pm-evidence', label: 'PM Evidence', href: pmEvidence, icon: 'clipboard' },
      { id: 'cal-evidence', label: 'Calibration Evidence', href: calibrationEvidence, icon: 'beaker' },
      ...(context.decisionSupport.replacement ? [{ id: 'replacement', label: 'Replacement Evidence', href: replacementEvidence, icon: 'file' as const }] : []),
      { id: 'qr-label', label: 'Open QR Label Sheet', href: `/equipment/qr-labels?assets=${id}`, icon: 'qr' },
      { id: 'reports', label: 'Open Reports', href: '/reports', icon: 'file' },
    ];
  }

  if (context.roleCategory === 'technician') {
    return [
      ...(assignedWork ? [{ id: 'assigned', label: 'Open Assigned Work', description: `${assignedWork.work_order_number ?? 'Assigned work'} on this asset.`, href: workOrderHref(assignedWork.id), icon: 'wrench' as const, variant: 'primary' as const }] : []),
      ...(assignedWork ? [{ id: 'log-event', label: 'Log Maintenance Event', description: 'Use the existing work-order event form.', href: `/maintenance/work-orders/${assignedWork.id}/events/new`, icon: 'clipboard' as const, variant: 'success' as const }] : []),
      { id: 'corrective-request', label: 'Create Corrective Request', description: assignedWork ? 'Report a separate issue if needed.' : 'No assigned work was found for you on this asset.', href: maintenanceNew, icon: 'clipboard', variant: assignedWork ? 'secondary' : 'primary' },
      { id: 'asset', label: 'Open Asset Profile', href: assetProfile, icon: 'asset' },
      { id: 'pm', label: 'View PM Evidence', href: pmEvidence, icon: 'clipboard' },
      { id: 'calibration', label: 'View Calibration Evidence', href: calibrationEvidence, icon: 'beaker' },
    ];
  }

  if (context.roleCategory === 'department_head') {
    return [
      { id: 'maintenance-request', label: 'Create Maintenance Request', href: maintenanceNew, icon: 'clipboard', variant: 'primary' },
      { id: 'calibration-request', label: 'Create Calibration Request', href: calibrationNew, icon: 'beaker' },
      { id: 'training-request', label: 'Request Training', href: trainingNew, icon: 'graduation' },
      { id: 'track', label: 'Track Existing Requests', href: requestsTrack, icon: 'file' },
      { id: 'evidence', label: 'View Evidence', href: assetProfile, icon: 'asset' },
      { id: 'department-work', label: 'Open Department Work Status', href: '/maintenance?tab=work-orders&source=qr-scan', icon: 'wrench' },
    ];
  }

  if (context.roleCategory === 'department_user') {
    return [
      { id: 'report-problem', label: 'Report Equipment Problem', href: maintenanceNew, icon: 'clipboard', variant: 'primary' },
      { id: 'calibration-request', label: 'Request Calibration', href: calibrationNew, icon: 'beaker' },
      { id: 'training-request', label: 'Request Training', href: trainingNew, icon: 'graduation' },
      { id: 'track', label: 'Track Existing Request', href: requestsTrack, icon: 'file' },
      { id: 'asset', label: 'Open Basic Asset Profile', href: assetProfile, icon: 'asset' },
    ];
  }

  if (context.roleCategory === 'store_user') {
    return [
      { id: 'blockers', label: 'Open Maintenance Blockers', href: '/spare-parts?tab=blockers&source=qr-scan', icon: 'package', variant: 'primary' },
      ...(firstStockIssue?.part_id ? [{ id: 'part', label: 'Open Linked Part', href: `/spare-parts?partId=${firstStockIssue.part_id}&source=qr-scan`, icon: 'package' as const }] : []),
      ...(firstProcurement ? [{ id: 'procurement', label: 'Track Procurement', href: `/command/drilldown/procurement/${firstProcurement.id}`, icon: 'clipboard' as const }] : []),
      { id: 'usage', label: 'Open Usage Linkage', href: '/logistics?workflow=usage-linkage&source=qr-scan', icon: 'truck' },
      ...(openWorkOrder ? [{ id: 'work-evidence', label: 'Open Work Evidence', href: workOrderHref(openWorkOrder.id), icon: 'wrench' as const }] : []),
    ];
  }

  if (context.roleCategory === 'viewer') {
    return [
      { id: 'summary', label: 'Open Asset Summary', href: assetProfile, icon: 'asset', variant: 'primary' },
      { id: 'evidence', label: 'View Evidence', href: `${assetProfile}#evidence`, icon: 'file' },
      { id: 'report', label: 'Open Report', href: '/reports/equipment', icon: 'file' },
    ];
  }

  return [{ id: 'asset', label: 'Open Asset Profile', href: assetProfile, icon: 'asset', variant: 'primary' }];
}

function MetricCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'default' | 'warning' | 'error' | 'success' | 'info' }) {
  const toneClass = tone === 'error'
    ? 'border-red-500/40 bg-red-500/10'
    : tone === 'warning'
      ? 'border-amber-500/40 bg-amber-500/10'
      : tone === 'success'
        ? 'border-emerald-500/40 bg-emerald-500/10'
        : tone === 'info'
          ? 'border-cyan-500/40 bg-cyan-500/10'
          : 'border-[var(--border-subtle)] bg-[var(--surface-1)]';
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">{value}</p>
      {sub && <p className="mt-1 text-[10px] text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

function SectionHeader({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <div className="mt-0.5 text-[var(--brand)]">{icon}</div>
      <div>
        <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
        {description && <p className="text-xs text-[var(--text-muted)]">{description}</p>}
      </div>
    </div>
  );
}

function EmptySection({ title, description }: { title: string; description: string }) {
  return <EmptyState title={title} description={description} />;
}

function RequestList({ rows, scope }: { rows: QrMaintenanceRequestRow[]; scope: 'full' | 'simple' }) {
  if (rows.length === 0) {
    return <EmptySection title="No linked maintenance requests" description="No real request rows were found for this asset." />;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <Link key={row.id} href={requestHref(row.id)} className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 hover:border-[var(--brand)]/40">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">{row.request_number ?? `Request ${row.id.slice(0, 8)}`}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{scope === 'simple' ? 'Status' : row.fault_description ?? 'No description recorded'}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={badgeVariant(row.status)}>{formatLabel(row.status)}</Badge>
              <Badge variant={badgeVariant(row.urgency)}>{formatLabel(row.urgency)}</Badge>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-[var(--text-muted)]">Updated {formatDateTime(row.updated_at)}</p>
        </Link>
      ))}
    </div>
  );
}

function WorkOrderList({ rows, showAssignee = true }: { rows: QrWorkOrderRow[]; showAssignee?: boolean }) {
  if (rows.length === 0) {
    return <EmptySection title="No linked work orders" description="No real work-order rows were found for this asset." />;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <Link key={row.id} href={workOrderHref(row.id)} className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 hover:border-[var(--brand)]/40">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">{row.work_order_number ?? `Work ${row.id.slice(0, 8)}`}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {formatLabel(row.work_type)}{showAssignee ? ` · ${row.assigned_to_name ?? 'Unassigned'}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={badgeVariant(row.status)}>{formatLabel(row.status)}</Badge>
              <Badge variant={badgeVariant(row.priority)}>{formatLabel(row.priority)}</Badge>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-[var(--text-muted)]">Updated {formatDateTime(row.updated_at)}</p>
        </Link>
      ))}
    </div>
  );
}

function PmList({ rows }: { rows: QrPmScheduleRow[] }) {
  if (rows.length === 0) {
    return <EmptySection title="No active PM schedules" description="No active PM rows were found for this asset." />;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <Link key={row.id} href={pmHref(row.id)} className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 hover:border-[var(--brand)]/40">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">PM due {formatDate(row.scheduled_date)}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{row.assigned_to_name ?? 'No assignee recorded'}</p>
            </div>
            <Badge variant={badgeVariant(row.status)}>{formatLabel(row.status)}</Badge>
          </div>
        </Link>
      ))}
    </div>
  );
}

function CalibrationList({ rows }: { rows: QrCalibrationRecordRow[] }) {
  if (rows.length === 0) {
    return <EmptySection title="No calibration records" description="No real calibration records were found for this asset." />;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <Link key={row.id} href={calibrationHref(row.id)} className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 hover:border-[var(--brand)]/40">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">Calibration {formatDate(row.calibration_date)}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Next due {formatDate(row.next_due_date)}</p>
            </div>
            <Badge variant={badgeVariant(row.result)}>{formatLabel(row.result)}</Badge>
          </div>
        </Link>
      ))}
    </div>
  );
}

function StockIssueList({ rows }: { rows: QrStockIssueRow[] }) {
  if (rows.length === 0) {
    return <EmptySection title="No directly linked stock issues" description="No stock issue rows linked through maintenance events were found for this asset." />;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">{row.part_code ?? 'Part'} · {row.part_name ?? 'Unknown part'}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Quantity {row.quantity ?? 'Not available'} · Issued {formatDate(row.issue_date)}</p>
            </div>
            {row.work_order_id && <Link href={workOrderHref(row.work_order_id)} className="text-xs font-medium text-[var(--brand)] hover:underline">Open Work Evidence</Link>}
          </div>
        </div>
      ))}
    </div>
  );
}

function MaintenanceEventList({ rows }: { rows: QrMaintenanceEventRow[] }) {
  if (rows.length === 0) {
    return <EmptySection title="No maintenance events" description="No maintenance event rows were found for this asset." />;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">{formatLabel(row.event_type)}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{row.action_taken ?? 'No action text recorded'}</p>
            </div>
            <Badge variant="default">{formatDate(row.completion_date ?? row.created_at)}</Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

function CurrentStatusSection({ asset, context }: { asset: QrLandingAsset; context: QrRoleContext }) {
  const currentIssue = strongestOpenRequest(context.requests.open);
  const latestWork = context.workOrders.open[0] ?? context.workOrders.completedRecent[0] ?? null;
  return (
    <div className="space-y-4">
      <SectionHeader icon={<Layers className="h-4 w-4" />} title="Current Status" description="Live asset state and the most immediate open issue, when one exists." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Condition" value={formatLabel(asset.condition)} tone={badgeVariant(asset.condition) === 'error' ? 'error' : badgeVariant(asset.condition) === 'warning' ? 'warning' : 'success'} />
        <MetricCard label="Criticality" value={formatLabel(asset.criticality_level)} tone={['critical', 'high'].includes(asset.criticality_level ?? '') ? 'warning' : 'default'} />
        <MetricCard label="Department" value={asset.department_name ?? 'Not available'} />
        <MetricCard label="Latest Update" value={latestWork ? formatDate(latestWork.updated_at) : 'Not available'} />
      </div>
      {currentIssue ? <RequestList rows={[currentIssue]} scope="full" /> : <EmptySection title="No current open issue" description="No open maintenance request was found for this asset." />}
    </div>
  );
}

function RequestsWorkSection({ context }: { context: QrRoleContext }) {
  const role = context.roleCategory;
  const requestRows = role === 'department_user' ? context.requests.mine : context.requests.open;
  return (
    <div className="space-y-5">
      {role === 'technician' && (
        <div>
          <SectionHeader icon={<UserRound className="h-4 w-4" />} title="Assigned Work on This Asset" />
          {context.workOrders.assignedToMe.length > 0 ? (
            <WorkOrderList rows={context.workOrders.assignedToMe} showAssignee={false} />
          ) : (
            <EmptySection title="No assigned work order for you on this asset" description="You can still create a corrective request or review safe evidence." />
          )}
        </div>
      )}
      {role === 'technician' && (
        <div>
          <SectionHeader icon={<Wrench className="h-4 w-4" />} title="Other Open Work on This Asset" />
          <WorkOrderList rows={context.workOrders.otherOpen} />
        </div>
      )}
      {role !== 'technician' && (
        <>
          <div>
            <SectionHeader icon={<FileText className="h-4 w-4" />} title={role === 'department_user' ? 'My Requests for This Asset' : 'Open Maintenance Requests'} />
            <RequestList rows={requestRows} scope={role === 'department_user' ? 'simple' : 'full'} />
          </div>
          {role === 'department_head' || role === 'department_user' ? (
            <div>
              <SectionHeader icon={<Building2 className="h-4 w-4" />} title="All Department Requests for This Asset" />
              <RequestList rows={context.requests.department} scope="simple" />
            </div>
          ) : null}
          <div>
            <SectionHeader icon={<Wrench className="h-4 w-4" />} title="Open Work Orders" />
            <WorkOrderList rows={context.workOrders.open} />
          </div>
        </>
      )}
    </div>
  );
}

function PmCalibrationSection({ context }: { context: QrRoleContext }) {
  return (
    <div className="space-y-5">
      {context.roleCategory === 'technician' && (
        <div>
          <SectionHeader icon={<UserRound className="h-4 w-4" />} title="PM Assigned to Me" />
          <PmList rows={context.pm.assignedToMe} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Active PM" value={String(context.pm.active.length)} />
        <MetricCard label="Overdue PM" value={String(context.pm.overdue.length)} tone={context.pm.overdue.length > 0 ? 'error' : 'success'} />
        <MetricCard label="Calibration State" value={formatLabel(context.calibration.state)} tone={context.calibration.state === 'overdue' ? 'error' : context.calibration.state === 'due_soon' ? 'warning' : context.calibration.state === 'current' ? 'success' : 'default'} />
        <MetricCard label="Next Calibration" value={formatDate(context.calibration.latest?.next_due_date)} />
      </div>
      <div>
        <SectionHeader icon={<CalendarCheck className="h-4 w-4" />} title="Active PM Schedules" />
        <PmList rows={context.pm.active} />
      </div>
      <div>
        <SectionHeader icon={<Beaker className="h-4 w-4" />} title="Recent Calibration Records" />
        <CalibrationList rows={context.calibration.recent} />
      </div>
    </div>
  );
}

function PartsBlockersSection({ context }: { context: QrRoleContext }) {
  return (
    <div className="space-y-5">
      <SectionHeader icon={<Package className="h-4 w-4" />} title="Parts / Blockers" description="Directly linked stock evidence only; no fuzzy matching is used." />
      {!context.parts.hasDirectStockEvidence ? (
        <EmptySection title="No stock or procurement blockers are linked to this asset" description="No directly linked stock evidence found in stock issues, specification/procurement links, stock flags, or on-hold work orders." />
      ) : (
        <>
          {context.workOrders.onHold.length > 0 && (
            <div>
              <SectionHeader icon={<AlertTriangle className="h-4 w-4" />} title="Open Work Currently On Hold" />
              <WorkOrderList rows={context.workOrders.onHold} />
            </div>
          )}
          {context.parts.stockFlags.length > 0 && (
            <div className="space-y-2">
              <SectionHeader icon={<AlertTriangle className="h-4 w-4" />} title="Stock-Related Flags" />
              {context.parts.stockFlags.map((flag) => (
                <div key={flag.id} className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--foreground)]">{formatLabel(flag.flag_type)}</p>
                    <Badge variant={badgeVariant(flag.severity)}>{formatLabel(flag.severity)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{flag.message ?? 'No message recorded'}</p>
                </div>
              ))}
            </div>
          )}
          {context.parts.procurementLinks.length > 0 && (
            <div className="space-y-2">
              <SectionHeader icon={<FileText className="h-4 w-4" />} title="Linked Procurement" />
              {context.parts.procurementLinks.map((row) => (
                <Link key={row.id} href={`/command/drilldown/procurement/${row.id}`} className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 hover:border-[var(--brand)]/40">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">{row.title ?? row.request_number ?? `Procurement ${row.id.slice(0, 8)}`}</p>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">Linked through specification request</p>
                    </div>
                    <Badge variant={badgeVariant(row.status)}>{formatLabel(row.status)}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <StockIssueList rows={context.parts.stockIssues} />
        </>
      )}
    </div>
  );
}

function HistorySection({ context }: { context: QrRoleContext }) {
  return (
    <div className="space-y-5">
      <div>
        <SectionHeader icon={<Clock className="h-4 w-4" />} title="Recent Maintenance Events" />
        <MaintenanceEventList rows={context.history.maintenanceEvents} />
      </div>
      <div>
        <SectionHeader icon={<CheckCircle className="h-4 w-4" />} title="Recent Completed Work Orders" />
        <WorkOrderList rows={context.history.completedWorkOrders} />
      </div>
      <div>
        <SectionHeader icon={<Beaker className="h-4 w-4" />} title="Calibration History" />
        <CalibrationList rows={context.history.calibrationRecords} />
      </div>
    </div>
  );
}

function DeveloperInfoSection({ asset, context }: { asset: QrLandingAsset; context: QrRoleContext }) {
  const rows = [
    ['Token format valid', context.route.tokenFormatValid ? 'Yes' : 'No'],
    ['Masked token', context.route.maskedToken],
    ['Label status', formatQrLabelStatus(asset.qr_label_status)],
    ['Generated at', formatDateTime(asset.qr_generated_at)],
    ['Printed at', formatDateTime(asset.qr_label_printed_at)],
    ['Attached at', formatDateTime(asset.qr_label_attached_at)],
    ['Replaced at', formatDateTime(asset.qr_label_replaced_at)],
    ['Regenerated at', formatDateTime(asset.qr_token_regenerated_at)],
    ['Route path', context.route.path ?? 'Not available'],
    ['URL base', context.route.baseUrl],
    ['Resolved role category', context.roleCategory],
  ];
  return (
    <div className="space-y-5">
      <SectionHeader icon={<ShieldAlert className="h-4 w-4" />} title="QR Info / Debug" description="Developer/admin metadata only. No service-role details or secrets are exposed." />
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-2 gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 last:border-b-0">
            <p className="text-xs text-[var(--text-muted)]">{label}</p>
            <p className="break-words text-xs font-medium text-[var(--foreground)]">{value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
        <p className="text-sm font-semibold text-[var(--foreground)]">Context Query Health</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {context.queryHealth.map((item) => (
            <div key={item.section} className="rounded-md bg-[var(--surface-2)] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[var(--text-muted)]">{item.section}</span>
                <Badge variant={item.ok ? 'success' : 'warning'}>{item.ok ? 'Loaded' : 'Unavailable'}</Badge>
              </div>
              {!item.ok && item.message && <p className="mt-1 text-[10px] text-amber-300">{item.message}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DecisionSupportStrip({ context }: { context: QrRoleContext }) {
  const risk = context.decisionSupport.risk;
  const replacement = context.decisionSupport.replacement;
  if (!risk && !replacement) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {risk && (
        <MetricCard
          label="Risk / RPN"
          value={risk.rpn == null ? 'Not available' : String(risk.rpn)}
          sub={risk.risk_level ? `Band: ${formatLabel(risk.risk_level)}` : undefined}
          tone={badgeVariant(risk.risk_level) === 'error' ? 'error' : badgeVariant(risk.risk_level) === 'warning' ? 'warning' : 'default'}
        />
      )}
      {replacement && (
        <MetricCard
          label="Replacement Band"
          value={replacementBandLabel(replacement.band)}
          sub={replacement.replacement_priority_index == null ? undefined : `RPI ${replacement.replacement_priority_index.toFixed(2)}${replacement.rank ? ` · Rank ${replacement.rank}` : ''}`}
          tone={replacement.band === 'strong_candidate' ? 'warning' : 'default'}
        />
      )}
    </div>
  );
}

export default function QrAssetLandingPage({ asset, profile, context }: Props) {
  const actions = buildActions(asset, context);
  const showQrInfo = context.roleCategory === 'developer' || context.roleCategory === 'bme_head';
  const canSeeDecisionSupport = ['developer', 'bme_head', 'viewer'].includes(context.roleCategory);
  const displayName = profile.full_name ?? profile.email ?? 'Authenticated user';
  const conditionIsValid = asset.condition && VALID_CONDITIONS.includes(asset.condition);
  const assignedWork = context.workOrders.assignedToMe[0] ?? context.workOrders.open[0] ?? null;
  const firstStockIssue = context.parts.stockIssues[0] ?? null;

  const tabs = [
    {
      id: 'current-status',
      label: 'Current Status',
      content: <CurrentStatusSection asset={asset} context={context} />,
    },
    {
      id: 'requests-work',
      label: 'Requests & Work',
      count: context.requests.open.length + context.workOrders.open.length,
      content: <RequestsWorkSection context={context} />,
    },
    {
      id: 'pm-calibration',
      label: 'PM & Calibration',
      count: context.pm.active.length + context.calibration.recent.length,
      content: <PmCalibrationSection context={context} />,
    },
    {
      id: 'parts-blockers',
      label: 'Parts / Blockers',
      count: context.parts.stockIssues.length + context.parts.procurementLinks.length + context.parts.stockFlags.length + context.workOrders.onHold.length,
      content: <PartsBlockersSection context={context} />,
    },
    {
      id: 'history',
      label: 'History',
      count: context.history.maintenanceEvents.length + context.history.completedWorkOrders.length,
      content: <HistorySection context={context} />,
    },
    ...(showQrInfo ? [{
      id: 'qr-info',
      label: 'QR Info',
      content: <DeveloperInfoSection asset={asset} context={context} />,
    }] : []),
  ];

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
          <div className="flex items-center gap-2">
            <LogoMark size={36} />
            <div>
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">
                {APP_NAME_SHORT} QR Scan
              </p>
              <p className="text-[0.62rem] text-[var(--text-muted)]">{HOSPITAL_NAME}</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <NetworkStatusPill />
            <Badge variant="info">{displayName}</Badge>
            <Badge variant="default">{profile.job_title ?? roleLabel(context.roleCategory)}</Badge>
            <Badge variant="purple">{roleLabel(context.roleCategory)}</Badge>
          </div>
        </header>

        <section className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-muted)]">
          <p className="font-medium text-[var(--foreground)]">Online QR experience</p>
          <p className="mt-1">QR identifies the asset. Access and actions depend on your role.</p>
        </section>

        {context.restricted ? (
          <section className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-100">
            <h1 className="text-lg font-semibold text-amber-200">Limited access</h1>
            <p className="mt-2 text-amber-100/90">{context.restrictedReason}</p>
            <p className="mt-3 text-xs text-amber-200/80">
              The QR token confirms a BMERMS label was scanned, but department-scoped roles only see
              operational details for assets linked to their own department.
            </p>
          </section>
        ) : (
          <>
            <section className="mt-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Asset Code</p>
                  <h1 className="break-words text-3xl font-semibold tracking-tight">{asset.asset_code}</h1>
                  <p className="mt-1 text-base text-[var(--text-muted)]">{asset.name}</p>
                </div>
                {conditionIsValid ? (
                  <ConditionBadge condition={asset.condition as Parameters<typeof ConditionBadge>[0]['condition']} />
                ) : (
                  <Badge variant="default">Unknown condition</Badge>
                )}
              </div>

              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex items-center gap-2 text-[var(--text-muted)]">
                  <Building2 className="h-4 w-4" />
                  <span>{asset.department_name ?? 'Unknown department'}</span>
                </div>
                <div className="flex items-center gap-2 text-[var(--text-muted)]">
                  <Layers className="h-4 w-4" />
                  <span>{asset.category_name ?? 'Uncategorised'}</span>
                </div>
                <div className="flex items-center gap-2 text-[var(--text-muted)]">
                  <ShieldAlert className="h-4 w-4" />
                  <Badge variant={badgeVariant(asset.criticality_level)}>{formatLabel(asset.criticality_level)}</Badge>
                </div>
                <div className="flex items-center gap-2 text-[var(--text-muted)]">
                  <QrCode className="h-4 w-4" />
                  <Badge variant={getQrLabelStatusBadgeVariant(asset.qr_label_status as QrLabelStatus)}>
                    {formatQrLabelStatus(asset.qr_label_status)}
                  </Badge>
                </div>
              </div>
              <p className="mt-4 text-xs text-[var(--text-muted)]">QR generated {formatDateTime(asset.qr_generated_at)}</p>
            </section>

            <section className="mt-6 space-y-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  {roleLabel(context.roleCategory)} Actions
                </h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Safe next steps for someone physically standing at this asset.
                </p>
              </div>
              <QrRoleActions actions={actions} />
            </section>

            <QrOfflineActions
              asset={{
                id: asset.id,
                assetCode: asset.asset_code,
                name: asset.name,
                departmentId: asset.department_id,
                qrToken: asset.qr_token,
              }}
              profile={profile}
              roleCategory={context.roleCategory}
              assignedWorkOrderId={assignedWork?.id ?? null}
              stockPartId={firstStockIssue?.part_id ?? null}
              stockPartName={firstStockIssue?.part_name ?? null}
            />

            <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Open Requests" value={String(context.requests.open.length)} tone={context.requests.open.length > 0 ? 'warning' : 'success'} />
              <MetricCard label="Open Work Orders" value={String(context.workOrders.open.length)} tone={context.workOrders.open.length > 0 ? 'warning' : 'success'} />
              <MetricCard label="Overdue PM" value={String(context.pm.overdue.length)} tone={context.pm.overdue.length > 0 ? 'error' : 'success'} />
              <MetricCard label="Calibration" value={formatLabel(context.calibration.state)} tone={context.calibration.state === 'overdue' ? 'error' : context.calibration.state === 'due_soon' ? 'warning' : context.calibration.state === 'current' ? 'success' : 'default'} />
            </section>

            {canSeeDecisionSupport && (
              <section className="mt-3">
                <DecisionSupportStrip context={context} />
              </section>
            )}

            {!rowsAvailable(context, 'maintenance_requests') || !rowsAvailable(context, 'work_orders') ? (
              <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                Some evidence sections are unavailable under the current session/RLS state. Loaded sections still reflect live rows.
              </p>
            ) : null}

            <section className="mt-7 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 sm:p-5">
              <Tabs tabs={tabs} defaultTab="current-status" />
            </section>
          </>
        )}

        <footer className="mt-10 border-t border-[var(--border-subtle)] pt-4 text-[10px] text-[var(--text-muted)]">
          <p>
            QR asset context is live when online. Phase 2 offline capture queues selected notes and request drafts only; QR scan logging remains online-only.
          </p>
        </footer>
      </div>
    </main>
  );
}
