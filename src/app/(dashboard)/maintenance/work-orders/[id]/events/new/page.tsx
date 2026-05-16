'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import Badge from '@/components/ui/Badge';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { OfflineActionResult } from '@/components/offline/OfflineActionResult';
import OfflineSubmitBanner from '@/components/offline/OfflineSubmitBanner';
import { getWorkOrderById } from '@/services/maintenance.service';
import { createMaintenanceEventAction } from '@/actions/maintenance.actions';
import { runOfflineCapableAction } from '@/lib/offline/queue';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useRole } from '@/hooks/useRole';
import type { OfflineActionRunResult } from '@/types/offline';

type WorkOrderRow = Record<string, unknown> & {
  equipment_assets?: { id?: string; asset_code?: string | null; name?: string | null } | null;
};

export default function NewWorkOrderEventPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { profile } = useProfile(user?.id);
  const { roles, primaryRole } = useRole();
  const [workOrder, setWorkOrder] = useState<WorkOrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [offlineResult, setOfflineResult] = useState<OfflineActionRunResult | null>(null);
  const [form, setForm] = useState({
    event_type: 'corrective',
    event_date: new Date().toISOString().slice(0, 16),
    action_taken: '',
    notes: '',
    repair_duration_hours: '',
    service_cost: '',
    condition_impact: '',
  });

  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await getWorkOrderById(params.id);
      if (!active) return;
      if (error || !data) {
        toast('error', 'Work order not found');
        router.push('/work-orders');
        return;
      }
      setWorkOrder(data as unknown as WorkOrderRow);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [params.id, router, toast]);

  async function submit() {
    if (!workOrder) return;
    if (!form.action_taken.trim()) {
      toast('warning', 'Action taken is required');
      return;
    }
    setSubmitting(true);
    const assetId = String(workOrder.asset_id ?? workOrder.equipment_assets?.id ?? '');
    const payload = {
      work_order_id: params.id,
      asset_id: assetId,
      event_type: form.event_type,
      failure_date: form.event_date ? new Date(form.event_date).toISOString() : null,
      completion_date: form.event_date ? new Date(form.event_date).toISOString() : null,
      action_taken: form.action_taken,
      repair_duration_hours: form.repair_duration_hours ? Number(form.repair_duration_hours) : null,
      service_cost: form.service_cost ? Number(form.service_cost) : null,
      notes: [form.notes, form.condition_impact ? `Condition impact: ${form.condition_impact}` : null].filter(Boolean).join('\n') || null,
      observed_condition: form.condition_impact || null,
      timestamp: new Date().toISOString(),
    };
    const result = await runOfflineCapableAction({
      actionType: 'maintenance_event.log',
      entityType: 'maintenance_events',
      entityId: params.id,
      assetId,
      payload,
      createdByProfileId: profile?.id ?? null,
      roleName: primaryRole,
      roleNames: roles,
      sourceRoute: typeof window !== 'undefined' ? window.location.pathname + window.location.search : `/maintenance/work-orders/${params.id}/events/new`,
      executeOnline: () => createMaintenanceEventAction(payload),
      metadata: { form: 'work_order_event_new', work_order_id: params.id },
    });
    setSubmitting(false);
    setOfflineResult(result);
    if (result.status === 'queued') {
      toast('success', 'Saved offline — will sync when connection returns.');
      return;
    }
    if (result.status === 'failed' || result.status === 'conflict') {
      toast('error', result.error ?? 'Failed to add work order event');
      return;
    }
    toast('success', 'Work order event added');
    router.push(`/maintenance/work-orders/${params.id}`);
    router.refresh();
  }

  if (loading || !workOrder) return <PageLoader />;

  const asset = workOrder.equipment_assets;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add Work Order Event"
        description={`${String(workOrder.work_order_number ?? 'Work order')} · ${asset?.asset_code ?? 'Asset'} · ${asset?.name ?? 'No asset name'}`}
        breadcrumbs={[
          { label: 'Work Orders', href: '/work-orders' },
          { label: String(workOrder.work_order_number ?? 'Work Order'), href: `/maintenance/work-orders/${params.id}` },
          { label: 'Add Event' },
        ]}
        actions={<Link href={`/maintenance/work-orders/${params.id}`}><Button variant="outline" size="sm">Open Work Order</Button></Link>}
      />

      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
        <div className="mb-4 space-y-3">
          <OfflineSubmitBanner actionLabel="Maintenance event" />
          <OfflineActionResult result={offlineResult} />
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge variant="info">{String(workOrder.status ?? '').replace(/_/g, ' ')}</Badge>
          <Badge variant={workOrder.priority === 'critical' ? 'error' : workOrder.priority === 'high' ? 'warning' : 'default'}>{String(workOrder.priority ?? 'priority')}</Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Event Type"
            value={form.event_type}
            onChange={(event) => setForm((prev) => ({ ...prev, event_type: event.target.value }))}
            options={[
              { value: 'corrective', label: 'Corrective' },
              { value: 'preventive', label: 'Preventive' },
              { value: 'inspection', label: 'Inspection' },
              { value: 'emergency', label: 'Emergency' },
            ]}
          />
          <Input label="Event Date / Time" type="datetime-local" value={form.event_date} onChange={(event) => setForm((prev) => ({ ...prev, event_date: event.target.value }))} />
          <Input label="Repair Hours" type="number" step="0.25" value={form.repair_duration_hours} onChange={(event) => setForm((prev) => ({ ...prev, repair_duration_hours: event.target.value }))} />
          <Input label="Cost" type="number" step="0.01" value={form.service_cost} onChange={(event) => setForm((prev) => ({ ...prev, service_cost: event.target.value }))} />
        </div>
        <div className="mt-4 space-y-4">
          <Textarea label="Action Taken *" value={form.action_taken} onChange={(event) => setForm((prev) => ({ ...prev, action_taken: event.target.value }))} placeholder="Describe the work performed, diagnostic findings, or action taken." />
          <Textarea label="Failure / Repair Notes" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="Parts used, downtime context, blocker notes, or follow-up evidence." />
          <Select
            label="Condition Impact"
            value={form.condition_impact}
            onChange={(event) => setForm((prev) => ({ ...prev, condition_impact: event.target.value }))}
            options={[
              { value: '', label: 'No direct condition change' },
              { value: 'functional', label: 'Functional' },
              { value: 'needs_repair', label: 'Needs repair' },
              { value: 'non_functional', label: 'Non-functional' },
              { value: 'under_maintenance', label: 'Under maintenance' },
            ]}
          />
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Link href={`/maintenance/work-orders/${params.id}`}><Button variant="outline">Cancel</Button></Link>
          <Button onClick={submit} loading={submitting}>Add Event</Button>
        </div>
      </section>
    </div>
  );
}
