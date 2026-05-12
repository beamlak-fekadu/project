'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  CheckCircle, XCircle, Wrench, ArrowLeft, AlertTriangle, Activity,
} from 'lucide-react';
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, CardFooter,
  Button, Spinner,
} from '@/components/ui';
import { UrgencyBadge, RequestStatusBadge, WorkOrderStatusBadge } from '@/components/ui/StatusBadge';
import { getRequestById, getWorkOrdersByRequestId } from '@/services/maintenance.service';
import { getEquipmentById } from '@/services/equipment.service';
import { updateRequestStatusAction } from '@/actions/maintenance.actions';
import { useToast } from '@/components/ui/Toast';
import { useRole } from '@/hooks/useRole';
import { formatEquipmentCondition, getConditionBadgeClass } from '@/utils/equipment/condition-labels';
import type { MaintenanceRequest, MaintenanceRequestStatus, WorkOrder } from '@/types/domain';

type RequestWithJoins = MaintenanceRequest & {
  equipment_assets?: { id: string; asset_code: string; name: string };
  departments?: { id: string; name: string; code: string };
  reported_condition?: string | null;
  reported_condition_source?: string | null;
};

type WORow = WorkOrder & {
  profiles?: { id: string; full_name: string | null; email: string | null } | null;
  completion_outcome?: string | null;
  final_equipment_condition?: string | null;
};

interface EquipmentSnapshot {
  id: string;
  name: string;
  asset_code: string;
  condition: string;
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900 dark:text-white">{value || '—'}</dd>
    </div>
  );
}

function ReportedConditionLabel({ condition }: { condition?: string | null }) {
  if (!condition) return <span>—</span>;
  const map: Record<string, string> = {
    functional_issue: 'Functional (issue observed)',
    needs_repair: 'Needs repair',
    non_functional: 'Non-functional',
  };
  return <span>{map[condition] ?? condition}</span>;
}

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const duplicatePrevented = searchParams.get('duplicatePrevented') === '1';
  const { toast } = useToast();
  const { canManageMaintenance } = useRole();

  const [request, setRequest] = useState<RequestWithJoins | null>(null);
  const [linkedWOs, setLinkedWOs] = useState<WORow[]>([]);
  const [equipment, setEquipment] = useState<EquipmentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function fetchRequest() {
      const { data, error } = await getRequestById(id);
      if (cancelled) return;
      if (error || !data) { toast('error', 'Failed to load request'); return; }
      const req = data as unknown as RequestWithJoins;
      const [woRes, eqRes] = await Promise.all([
        getWorkOrdersByRequestId(id),
        req.equipment_assets?.id ? getEquipmentById(req.equipment_assets.id) : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      setRequest(req);
      setLinkedWOs((woRes.data ?? []) as unknown as WORow[]);
      if (eqRes.data) {
        const eq = eqRes.data as unknown as { id: string; name: string; asset_code: string; condition: string };
        setEquipment({ id: eq.id, name: eq.name, asset_code: eq.asset_code, condition: eq.condition });
      }
      setLoading(false);
    }
    void fetchRequest();
    return () => { cancelled = true; };
  }, [id, toast, refreshTick]);

  async function handleStatusUpdate(status: MaintenanceRequestStatus) {
    setActionLoading(true);
    const result = await updateRequestStatusAction(id, status);
    if (!result.success) {
      toast('error', result.error ?? `Failed to update request`);
    } else {
      toast('success', `Request ${status}`);
      refresh();
    }
    setActionLoading(false);
  }

  if (loading || !request) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const isPending = request.status === 'pending';
  const isApproved = request.status === 'approved';
  const isTerminal = ['completed', 'rejected', 'canceled'].includes(request.status);

  const openWO = linkedWOs.find((wo) => !['completed', 'canceled'].includes(wo.status));
  const hasLinkedWO = linkedWOs.length > 0;
  const assetId = request.equipment_assets?.id ?? request.asset_id;

  // Workflow step tracker
  const steps = [
    { key: 'submitted', label: 'Submitted', done: true },
    { key: 'approved',  label: 'Approved',  done: ['approved', 'assigned', 'in_progress', 'completed'].includes(request.status) },
    { key: 'work_order', label: 'Work Order', done: hasLinkedWO },
    { key: 'in_progress', label: 'In Progress', done: !!linkedWOs.find((wo) => ['in_progress', 'completed'].includes(wo.status)) },
    { key: 'completed', label: 'Completed', done: request.status === 'completed' || !!linkedWOs.find((wo) => wo.status === 'completed') },
  ];
  const latestCompletedWO = linkedWOs.find((wo) => wo.status === 'completed' && wo.final_equipment_condition);
  const requestedConditionEffect = request.reported_condition === 'functional_issue'
    ? 'Equipment remains Functional unless an active work order or worse existing condition says otherwise.'
    : request.reported_condition === 'needs_repair'
      ? 'Equipment condition syncs to Needs repair because the request reported repair risk.'
      : request.reported_condition === 'non_functional'
        ? 'Equipment condition syncs to Non-functional because the request reported loss of function.'
        : 'No condition change was reported on the request.';

  return (
    <div className="space-y-6">
      <PageHeader
        title={request.request_number}
        description="Maintenance Request"
        breadcrumbs={[
          { label: 'Command Center', href: '/command' },
          { label: 'Maintenance', href: '/maintenance' },
          { label: request.request_number },
        ]}
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push('/maintenance')}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        }
      />

      {/* Duplicate prevented notice */}
      {duplicatePrevented && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <p className="text-sm text-amber-200">
            A duplicate corrective request was prevented. This existing open request was opened instead.
          </p>
        </div>
      )}

      {/* Workflow steps strip */}
      <div className="panel-surface flex flex-wrap items-center gap-2 rounded-lg px-4 py-3">
        {steps.map((step, i) => (
          <div key={step.key} className="flex items-center gap-2">
            {i > 0 && <span className="text-[var(--text-muted)]">→</span>}
            <span className={`text-xs font-medium ${step.done ? 'text-emerald-300' : 'text-[var(--text-muted)]'}`}>
              {step.done ? '✓ ' : ''}{step.label}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left: main details + actions ── */}
        <div className="space-y-6 lg:col-span-2">

          {/* Request details */}
          <Card>
            <CardHeader>
              <CardTitle>Request Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <DetailItem label="Asset" value={
                  request.equipment_assets
                    ? <Link href={`/equipment/${request.equipment_assets.id}`} className="text-[var(--brand)] hover:underline">
                        {request.equipment_assets.asset_code} — {request.equipment_assets.name}
                      </Link>
                    : null
                } />
                <DetailItem label="Department" value={request.departments?.name} />
                <DetailItem label="Urgency" value={<UrgencyBadge urgency={request.urgency} />} />
                <DetailItem label="Status" value={<RequestStatusBadge status={request.status} />} />
                <DetailItem label="Reported Condition" value={
                  <span className={`font-medium ${
                    request.reported_condition === 'non_functional' ? 'text-rose-300'
                    : request.reported_condition === 'needs_repair' ? 'text-amber-300'
                    : 'text-emerald-300'
                  }`}>
                    <ReportedConditionLabel condition={request.reported_condition} />
                  </span>
                } />
                {request.reported_condition_source && (
                  <DetailItem label="Reported Via" value={request.reported_condition_source} />
                )}
                <DetailItem label="Created" value={new Date(request.created_at).toLocaleString()} />
                {request.resolved_at && (
                  <DetailItem label="Resolved" value={new Date(request.resolved_at).toLocaleString()} />
                )}
                <div className="sm:col-span-2">
                  <DetailItem label="Fault Description" value={
                    <span className="whitespace-pre-wrap">{request.fault_description}</span>
                  } />
                </div>
                {request.notes && (
                  <div className="sm:col-span-2">
                    <DetailItem label="Notes" value={<span className="whitespace-pre-wrap">{request.notes}</span>} />
                  </div>
                )}
              </dl>
            </CardContent>

            {!isTerminal && canManageMaintenance && (
              <CardFooter>
                <div className="flex flex-wrap gap-2">
                  {isPending && (
                    <>
                      <Button size="sm" onClick={() => handleStatusUpdate('approved')} loading={actionLoading}>
                        <CheckCircle className="h-4 w-4" />
                        Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleStatusUpdate('rejected')} loading={actionLoading}>
                        <XCircle className="h-4 w-4" />
                        Reject
                      </Button>
                    </>
                  )}
                  {isApproved && !openWO && (
                    <Link href={`/maintenance/work-orders/new?request_id=${request.id}&asset_id=${assetId}&urgency=${request.urgency}&priority=${request.urgency}&work_type=corrective&source=maintenance-request`}>
                      <Button size="sm">
                        <Wrench className="h-4 w-4" />
                        Create Work Order
                      </Button>
                    </Link>
                  )}
                  {isApproved && openWO && (
                    <Link href={`/maintenance/work-orders/${openWO.id}`}>
                      <Button size="sm" variant="outline">
                        <Wrench className="h-4 w-4" />
                        Open Work Order
                      </Button>
                    </Link>
                  )}
                </div>
              </CardFooter>
            )}
          </Card>

          {/* Linked Work Orders */}
          <Card>
            <CardHeader>
              <CardTitle>Work Orders</CardTitle>
            </CardHeader>
            <CardContent>
              {linkedWOs.length === 0 ? (
                <div className="py-3 text-center text-sm text-[var(--text-muted)]">
                  {isApproved
                    ? 'No work order created yet. Use "Create Work Order" above to begin execution.'
                    : 'No work orders linked to this request.'}
                </div>
              ) : (
                <div className="divide-y divide-[var(--surface-3)]">
                  {linkedWOs.map((wo) => (
                    <div key={wo.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <Link href={`/maintenance/work-orders/${wo.id}`} className="text-sm font-medium text-[var(--brand)] hover:underline">
                          {wo.work_order_number}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                          <WorkOrderStatusBadge status={wo.status} />
                          {(wo as { profiles?: { full_name?: string | null } | null }).profiles?.full_name && (
                            <span>· {(wo as { profiles?: { full_name?: string | null } | null }).profiles!.full_name}</span>
                          )}
                          {wo.completion_outcome && (
                            <span>· {wo.completion_outcome.replace(/_/g, ' ')}</span>
                          )}
                          {wo.final_equipment_condition && (
                            <span className={getConditionBadgeClass(wo.final_equipment_condition)}>
                              → {formatEquipmentCondition(wo.final_equipment_condition)}
                            </span>
                          )}
                        </div>
                      </div>
                      <Link href={`/maintenance/work-orders/${wo.id}`}>
                        <Button size="sm" variant="outline">View WO</Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right: equipment context + timeline ── */}
        <div className="space-y-6">
          {/* Equipment condition */}
          {equipment && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[var(--brand)]" />
                  Equipment Condition
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-[var(--text-muted)]">Current condition</p>
                  <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${getConditionBadgeClass(equipment.condition)}`}>
                    {formatEquipmentCondition(equipment.condition)}
                  </span>
                </div>
                {request.reported_condition && (
                  <div>
                    <p className="text-xs text-[var(--text-muted)]">Reported at request creation</p>
                    <p className="mt-0.5 text-xs font-medium text-[var(--foreground)]">
                      <ReportedConditionLabel condition={request.reported_condition} />
                    </p>
                  </div>
                )}
                {openWO?.status === 'in_progress' && (
                  <div className="rounded-md border border-indigo-400/30 bg-indigo-400/10 px-3 py-2 text-xs text-indigo-300">
                    Work in progress — equipment is under maintenance
                  </div>
                )}
                {openWO?.status === 'on_hold' && (
                  <div className="flex items-start gap-2 rounded-md border border-orange-400/30 bg-orange-400/10 px-3 py-2 text-xs text-orange-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Work order on hold — blocker must be resolved
                  </div>
                )}
                <Link href={`/equipment/${equipment.id}`} className="block text-xs text-[var(--brand)] hover:underline">
                  View equipment detail →
                </Link>
              </CardContent>
            </Card>
          )}

          {equipment && (
            <Card>
              <CardHeader>
                <CardTitle>Condition Trace</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
                  <p className="text-xs text-[var(--text-muted)]">Condition at request time</p>
                  <p className="font-medium text-[var(--foreground)]"><ReportedConditionLabel condition={request.reported_condition} /></p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{requestedConditionEffect}</p>
                </div>
                {openWO && (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
                    <p className="text-xs text-[var(--text-muted)]">Current work-order state</p>
                    <p className="font-medium text-[var(--foreground)]">{openWO.work_order_number} · {openWO.status.replace(/_/g, ' ')}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{openWO.status === 'in_progress' ? 'Started work sets the equipment condition to Under maintenance.' : openWO.status === 'on_hold' ? 'On hold preserves the current maintenance/repair condition until the blocker is resolved.' : 'Assignment/open state preserves the request condition until work starts or completes.'}</p>
                  </div>
                )}
                {latestCompletedWO && (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
                    <p className="text-xs text-[var(--text-muted)]">Final condition after completion</p>
                    <p className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${getConditionBadgeClass(latestCompletedWO.final_equipment_condition)}`}>
                      {formatEquipmentCondition(latestCompletedWO.final_equipment_condition)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{latestCompletedWO.completion_outcome ? `Source action: work order completion outcome ${latestCompletedWO.completion_outcome.replace(/_/g, ' ')}.` : 'Source action: work order completion.'}</p>
                  </div>
                )}
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
                  <p className="text-xs text-[var(--text-muted)]">Current equipment condition</p>
                  <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${getConditionBadgeClass(equipment.condition)}`}>
                    {formatEquipmentCondition(equipment.condition)}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                  <div>
                    <p className="font-medium text-[var(--foreground)]">Request created</p>
                    <p className="text-xs text-[var(--text-muted)]">{new Date(request.created_at).toLocaleString()}</p>
                  </div>
                </li>
                {request.reported_condition && (
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                    <div>
                      <p className="font-medium text-[var(--foreground)]">Condition reported</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        <ReportedConditionLabel condition={request.reported_condition} />
                        {request.reported_condition_source && ` · via ${request.reported_condition_source}`}
                      </p>
                    </div>
                  </li>
                )}
                {['approved', 'assigned', 'in_progress', 'completed'].includes(request.status) && (
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                    <div>
                      <p className="font-medium text-[var(--foreground)]">Request approved</p>
                      <p className="text-xs text-[var(--text-muted)]">{new Date(request.updated_at).toLocaleString()}</p>
                    </div>
                  </li>
                )}
                {request.status === 'rejected' && (
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-400" />
                    <div>
                      <p className="font-medium text-[var(--foreground)]">Request rejected</p>
                      <p className="text-xs text-[var(--text-muted)]">{new Date(request.updated_at).toLocaleString()}</p>
                    </div>
                  </li>
                )}
                {linkedWOs.map((wo) => (
                  <li key={wo.id} className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-violet-400" />
                    <div>
                      <p className="font-medium text-[var(--foreground)]">
                        Work order created
                        {' '}
                        <Link href={`/maintenance/work-orders/${wo.id}`} className="text-[var(--brand)] hover:underline">
                          {wo.work_order_number}
                        </Link>
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">{new Date(wo.created_at).toLocaleString()}</p>
                      {wo.status === 'completed' && wo.completed_at && (
                        <p className="text-xs text-emerald-300">
                          Completed {new Date(wo.completed_at as string).toLocaleDateString()}
                          {wo.completion_outcome && ` · ${wo.completion_outcome.replace(/_/g, ' ')}`}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
                {request.resolved_at && (
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-green-400" />
                    <div>
                      <p className="font-medium text-[var(--foreground)]">Request resolved</p>
                      <p className="text-xs text-[var(--text-muted)]">{new Date(request.resolved_at).toLocaleString()}</p>
                    </div>
                  </li>
                )}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
