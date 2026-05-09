'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import { PageHeader, Card, CardHeader, CardTitle, CardContent, Button, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { getEquipmentList } from '@/services/equipment.service';
import { createMaintenanceRequestAction } from '@/actions/maintenance.actions';
import type { EquipmentAsset, Urgency } from '@/types/database';
import { maintenanceRequestSchema } from '@/utils/validation/operations';

export default function NewMaintenanceRequestPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [assets, setAssets] = useState<EquipmentAsset[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(() => {
    const source = searchParams.get('source');
    const type = searchParams.get('type');
    const urgency = searchParams.get('urgency') as Urgency | null;
    return {
      asset_id: searchParams.get('assetId') ?? searchParams.get('asset_id') ?? '',
      urgency: urgency && ['low', 'medium', 'high', 'critical'].includes(urgency) ? urgency : 'medium' as Urgency,
      fault_description: searchParams.get('description') ?? '',
      notes: source === 'command-center'
        ? ['Source: Command Center', type ? `Request type: ${type}` : null].filter(Boolean).join('\n')
        : '',
    };
  });

  useEffect(() => {
    async function load() {
      const { data } = await getEquipmentList();
      setAssets((data ?? []) as unknown as EquipmentAsset[]);
    }
    load();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = maintenanceRequestSchema.safeParse(form);
    if (!parsed.success) {
      toast('warning', parsed.error.issues[0]?.message ?? 'Invalid request details');
      return;
    }

    const selectedAsset = assets.find((item) => item.id === form.asset_id);
    if (!selectedAsset?.department_id) {
      toast('error', 'Selected asset does not have a department');
      return;
    }

    setSubmitting(true);
    const result = await createMaintenanceRequestAction({
      asset_id: form.asset_id,
      requested_by: null,
      department_id: selectedAsset.department_id,
      fault_description: parsed.data.fault_description.trim(),
      urgency: parsed.data.urgency,
      status: 'pending',
      resolved_at: null,
      notes: parsed.data.notes?.trim() || null,
    });
    setSubmitting(false);

    if (!result.success) {
      toast('error', result.error ?? 'Failed to create maintenance request');
      return;
    }

    toast('success', 'Maintenance request created');
    router.push(`/maintenance/requests/${(result.data as { id: string }).id}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Maintenance Request"
        description="Submit a curative maintenance request for equipment support."
        actions={
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Request Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <Select
              label="Equipment Asset *"
              placeholder="Select asset"
              value={form.asset_id}
              onChange={(e) => setForm((prev) => ({ ...prev, asset_id: e.target.value }))}
              options={assets.map((asset) => ({
                value: asset.id,
                label: `${asset.asset_code} - ${asset.name}`,
              }))}
            />
            <Select
              label="Urgency"
              value={form.urgency}
              onChange={(e) => setForm((prev) => ({ ...prev, urgency: e.target.value as Urgency }))}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
                { value: 'critical', label: 'Critical' },
              ]}
            />
            <Textarea
              label="Fault Description *"
              value={form.fault_description}
              onChange={(e) => setForm((prev) => ({ ...prev, fault_description: e.target.value }))}
              placeholder="Describe the issue observed with this equipment."
            />
            <Textarea
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Additional context for maintenance team."
            />
            <div className="flex justify-end">
              <Button type="submit" loading={submitting}>
                <Save className="h-4 w-4" />
                Submit Request
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
