'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { createProcurementRequestAction } from '@/actions/procurement.actions';
import { procurementRequestSchema } from '@/utils/validation/operations';
import { useToast } from '@/components/ui/Toast';

export default function NewProcurementRequestPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const prefill = useMemo(() => {
    const itemName = searchParams.get('itemName') ?? 'spare part';
    const currentStock = searchParams.get('currentStock');
    const reorderLevel = searchParams.get('reorderLevel');
    const suggestedQuantity = searchParams.get('suggestedQuantity');
    const reason = searchParams.get('reason') ?? 'Stock below reorder level';
    const source = searchParams.get('source');
    return {
      title: source === 'command-center' ? `Procure ${itemName}` : '',
      justification: source === 'command-center'
        ? [
            reason,
            currentStock ? `Current stock: ${currentStock}` : null,
            reorderLevel ? `Reorder level: ${reorderLevel}` : null,
            suggestedQuantity ? `Suggested quantity: ${suggestedQuantity}` : null,
            searchParams.get('partId') ? `Linked spare part: ${searchParams.get('partId')}` : null,
            searchParams.get('workOrderId') ? `Linked work order: ${searchParams.get('workOrderId')}` : null,
            searchParams.get('assetId') ? `Linked asset: ${searchParams.get('assetId')}` : null,
            source === 'command-center' ? 'Source: Command Center' : null,
          ].filter(Boolean).join('\n')
        : '',
      priority: source === 'command-center' && currentStock === '0' ? 'critical' : source === 'command-center' ? 'high' : 'medium',
    };
  }, [searchParams]);

  const [form, setForm] = useState({
    title: prefill.title,
    justification: prefill.justification,
    status: 'requested',
    priority: prefill.priority as 'low' | 'medium' | 'high' | 'critical',
    expected_delivery_date: '',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = procurementRequestSchema.safeParse(form);
    if (!parsed.success) {
      toast('warning', parsed.error.issues[0]?.message ?? 'Invalid procurement request');
      return;
    }
    setSubmitting(true);
    const result = await createProcurementRequestAction({
      title: parsed.data.title,
      justification: parsed.data.justification,
      status: parsed.data.status,
      priority: parsed.data.priority,
      expected_delivery_date: parsed.data.expected_delivery_date || null,
    });
    setSubmitting(false);
    if (!result.success) {
      toast('error', result.error ?? 'Failed to create procurement request');
      return;
    }
    toast('success', 'Procurement request created');
    const id = (result.data as { id?: string } | undefined)?.id;
    router.push(id ? `/command/drilldown/procurement/${id}` : '/procurement');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Procurement Request"
        description="Create a contextual procurement request."
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
          <form onSubmit={submit} className="space-y-5">
            <Input
              label="Title"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Procurement request title"
            />
            <Textarea
              label="Justification"
              value={form.justification}
              onChange={(e) => setForm((prev) => ({ ...prev, justification: e.target.value }))}
              placeholder="Clinical and operational justification"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Priority"
                value={form.priority}
                onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value as typeof form.priority }))}
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                  { value: 'critical', label: 'Critical' },
                ]}
              />
              <Input
                label="Expected Delivery"
                type="date"
                value={form.expected_delivery_date}
                onChange={(e) => setForm((prev) => ({ ...prev, expected_delivery_date: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={submitting}>Cancel</Button>
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
