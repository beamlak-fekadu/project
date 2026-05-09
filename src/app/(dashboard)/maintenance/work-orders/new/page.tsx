'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent,
  Button, Input, Select, Textarea, Spinner,
} from '@/components/ui';
import { createWorkOrderAction } from '@/actions/maintenance.actions';
import { getEquipmentList } from '@/services/equipment.service';
import { getActiveTechnicians } from '@/services/users.service';
import { useToast } from '@/components/ui/Toast';
import type { EquipmentAsset, Profile, WorkType, Urgency } from '@/types/database';

export default function NewWorkOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [equipment, setEquipment] = useState<EquipmentAsset[]>([]);
  const [technicians, setTechnicians] = useState<Profile[]>([]);

  const [form, setForm] = useState({
    asset_id: searchParams.get('asset_id') || '',
    request_id: searchParams.get('request_id') || '',
    assigned_to: '',
    priority: 'medium' as Urgency,
    work_type: 'corrective' as WorkType,
    estimated_hours: '',
    closure_notes: '',
  });

  useEffect(() => {
    async function loadLookups() {
      const [eqRes, profRes] = await Promise.all([
        getEquipmentList(),
        getActiveTechnicians(),
      ]);
      if (eqRes.data) setEquipment(eqRes.data as unknown as EquipmentAsset[]);
      if (profRes.data) setTechnicians(profRes.data as unknown as Profile[]);
      setLoading(false);
    }
    loadLookups();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.asset_id) {
      toast('warning', 'Please select an asset');
      return;
    }
    setSubmitting(true);
    const result = await createWorkOrderAction({
      asset_id: form.asset_id,
      request_id: form.request_id || null,
      assigned_to: form.assigned_to || null,
      priority: form.priority,
      work_type: form.work_type,
      status: form.assigned_to ? 'assigned' : 'open',
      estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : null,
      closure_notes: form.closure_notes || null,
      root_cause: null,
      action_taken: null,
      external_vendor: false,
      external_vendor_name: null,
      actual_hours: null,
      started_at: null,
      completed_at: null,
    });

    if (!result.success) {
      toast('error', result.error ?? 'Failed to create work order');
      setSubmitting(false);
      return;
    }
    toast('success', 'Work order created');
    router.push(`/maintenance/work-orders/${(result.data as unknown as Record<string, string>).id}`);
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="New Work Order"
        breadcrumbs={[
          { label: 'Command Center', href: '/command' },
          { label: 'Maintenance', href: '/maintenance' },
          { label: 'New Work Order' },
        ]}
        actions={
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Work Order Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Asset *"
                placeholder="Select asset"
                value={form.asset_id}
                onChange={(e) => setForm({ ...form, asset_id: e.target.value })}
                options={equipment.map((eq) => ({
                  value: eq.id,
                  label: `${eq.asset_code} — ${eq.name}`,
                }))}
              />
              <Select
                label="Assign Technician"
                placeholder="Unassigned"
                value={form.assigned_to}
                onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
                options={technicians.map((t) => ({ value: t.id, label: `${t.full_name}${t.email ? ` · ${t.email}` : ''}` }))}
              />
              <Select
                label="Priority"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as Urgency })}
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                  { value: 'critical', label: 'Critical' },
                ]}
              />
              <Select
                label="Work Type"
                value={form.work_type}
                onChange={(e) => setForm({ ...form, work_type: e.target.value as WorkType })}
                options={[
                  { value: 'corrective', label: 'Corrective' },
                  { value: 'preventive', label: 'Preventive' },
                  { value: 'inspection', label: 'Inspection' },
                  { value: 'calibration', label: 'Calibration' },
                  { value: 'installation', label: 'Installation' },
                ]}
              />
              <Input
                label="Estimated Hours"
                type="number"
                step="0.5"
                value={form.estimated_hours}
                onChange={(e) => setForm({ ...form, estimated_hours: e.target.value })}
              />
              {form.request_id && (
                <Input
                  label="Linked Request"
                  value={form.request_id}
                  disabled
                />
              )}
            </div>
            <Textarea
              label="Notes"
              value={form.closure_notes}
              onChange={(e) => setForm({ ...form, closure_notes: e.target.value })}
              placeholder="Additional notes or instructions…"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={submitting}>
                <Save className="h-4 w-4" />
                Create Work Order
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
