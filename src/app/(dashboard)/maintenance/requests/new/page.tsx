'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Save, AlertTriangle } from 'lucide-react';
import { PageHeader, Card, CardHeader, CardTitle, CardContent, Button, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { publishNotificationsUpdated } from '@/lib/notifications/client-events';
import { OfflineActionResult } from '@/components/offline/OfflineActionResult';
import OfflineSubmitBanner from '@/components/offline/OfflineSubmitBanner';
import { getEquipmentList } from '@/services/equipment.service';
import { getActiveCorrectiveBlockerForAsset } from '@/services/maintenance.service';
import { createMaintenanceRequestAction } from '@/actions/maintenance.actions';
import { runOfflineCapableAction } from '@/lib/offline/queue';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useRole } from '@/hooks/useRole';
import { formatRequestStatus } from '@/utils/maintenance/request-status';
import type { EquipmentAsset, Urgency } from '@/types/domain';
import { maintenanceRequestSchema } from '@/utils/validation/operations';
import type { OfflineActionRunResult } from '@/types/offline';

// Reported condition options stored in maintenance_requests.reported_condition (migration 00038).
// functional_issue = equipment operates but issue observed (no condition change to equipment_assets).
// needs_repair / non_functional = condition synced to equipment_assets.condition.
const REPORTED_CONDITION_OPTIONS = [
  { value: 'functional_issue', label: 'Functional (issue observed)' },
  { value: 'needs_repair', label: 'Needs repair' },
  { value: 'non_functional', label: 'Non-functional' },
];

interface DuplicateInfo {
  blocker_type: 'maintenance_request' | 'work_order';
  id: string;
  number: string;
  status: string;
  urgency?: string;
  fault_description?: string;
}

export default function NewMaintenanceRequestPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const { profile } = useProfile(user?.id);
  const { roles, primaryRole } = useRole();
  const [assets, setAssets] = useState<EquipmentAsset[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [offlineResult, setOfflineResult] = useState<OfflineActionRunResult | null>(null);
  const [form, setForm] = useState(() => {
    const source = searchParams.get('source') ?? '';
    const type = searchParams.get('type');
    const urgency = searchParams.get('urgency') as Urgency | null;
    // reportedCondition from URL may be an equipment condition value ('needs_repair', 'non_functional').
    // Map 'functional' → 'functional_issue' for the DB enum; leave others as-is.
    const rawReportedCond = searchParams.get('reportedCondition') ?? '';
    const VALID_REPORTED = ['functional_issue', 'needs_repair', 'non_functional'];
    const reported_condition = rawReportedCond === 'functional'
      ? 'functional_issue'
      : VALID_REPORTED.includes(rawReportedCond) ? rawReportedCond : '';
    return {
      asset_id: searchParams.get('assetId') ?? searchParams.get('asset_id') ?? '',
      urgency: urgency && ['low', 'medium', 'high', 'critical'].includes(urgency) ? urgency : 'medium' as Urgency,
      fault_description: searchParams.get('description') ?? '',
      reported_condition,
      source,
      notes: source === 'command-center' || source === 'equipment'
        ? ['Source: ' + (source === 'equipment' ? 'Equipment page' : 'Command Center'), type ? `Request type: ${type}` : null].filter(Boolean).join('\n')
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

  // Check for duplicate open request when asset changes
  const checkForDuplicate = useCallback(async (assetId: string) => {
    if (!assetId) {
      setDuplicateInfo(null);
      return;
    }
    setCheckingDuplicate(true);
    const existing = await getActiveCorrectiveBlockerForAsset(assetId);
    setCheckingDuplicate(false);
    if (existing) {
      setDuplicateInfo({
        blocker_type: existing.blocker_type,
        id: existing.id,
        number: existing.blocker_type === 'maintenance_request'
          ? existing.request_number
          : existing.work_order_number,
        status: existing.status,
        urgency: existing.blocker_type === 'maintenance_request' ? existing.urgency : existing.priority,
        fault_description: existing.blocker_type === 'maintenance_request' ? existing.fault_description : undefined,
      });
    } else {
      setDuplicateInfo(null);
    }
  }, []);

  // Check on initial load if assetId was pre-filled from URL
  useEffect(() => {
    if (form.asset_id) {
      void Promise.resolve().then(() => checkForDuplicate(form.asset_id));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleAssetChange(assetId: string) {
    setForm((prev) => ({ ...prev, asset_id: assetId }));
    checkForDuplicate(assetId);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Guard: server action will also block this, but provide immediate UI feedback
    if (duplicateInfo) {
      toast('warning', `${duplicateInfo.number} is still active for this equipment. Open it instead.`);
      return;
    }

    const parsed = maintenanceRequestSchema.safeParse(form);
    if (!parsed.success) {
      toast('warning', parsed.error.issues[0]?.message ?? 'Invalid request details');
      return;
    }

    const selectedAsset = assets.find((item) => item.id === form.asset_id);
    if (!selectedAsset?.department_id && navigator.onLine) {
      toast('error', 'Selected asset does not have a department');
      return;
    }

    setSubmitting(true);
    const actionPayload = {
      asset_id: form.asset_id,
      requested_by: null,
      department_id: selectedAsset?.department_id ?? profile?.department_id ?? null,
      fault_description: parsed.data.fault_description.trim(),
      urgency: parsed.data.urgency,
      status: 'pending',
      notes: parsed.data.notes?.trim() || null,
      reported_condition: form.reported_condition || null,
      reported_condition_source: form.source || 'manual',
    };
    const result = await runOfflineCapableAction({
      actionType: form.source === 'department' ? 'department_issue.report' : 'maintenance_request.create',
      entityType: 'maintenance_requests',
      entityId: null,
      assetId: form.asset_id,
      payload: actionPayload,
      createdByProfileId: profile?.id ?? null,
      roleName: primaryRole,
      roleNames: roles,
      sourceRoute: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/maintenance/requests/new',
      executeOnline: () => createMaintenanceRequestAction(actionPayload),
      metadata: { form: 'maintenance_request_new', request_source: form.source || 'manual' },
    });
    setSubmitting(false);
    setOfflineResult(result);

    if (result.status === 'queued') {
      toast('success', 'Saved offline — will sync when connection returns.');
      return;
    }

    if (result.status === 'failed') {
      // Handle duplicate prevented by server action (race condition or direct POST)
      const resultData = (result as { data?: { reason?: string; existingRequestId?: string; existingRequestNumber?: string; existingRequestStatus?: string; existingWorkOrderId?: string; existingWorkOrderNumber?: string; existingWorkOrderStatus?: string } }).data;
      if (resultData?.reason === 'duplicate_open_request' && resultData.existingRequestId) {
        toast('warning', `Duplicate prevented: ${resultData.existingRequestNumber ?? 'open request'} already exists for this equipment.`);
        router.push(`/maintenance/requests/${resultData.existingRequestId}?duplicatePrevented=1`);
        return;
      }
      if (resultData?.reason === 'active_work_order' && resultData.existingWorkOrderId) {
        toast('warning', `Duplicate prevented: ${resultData.existingWorkOrderNumber ?? 'active work order'} is still active for this equipment.`);
        router.push(`/maintenance/work-orders/${resultData.existingWorkOrderId}`);
        return;
      }
      toast('error', result.error ?? 'Failed to create maintenance request');
      return;
    }

    if (result.status === 'success') {
      const created = result.data as {
        data?: {
          id?: string;
          condition_sync_warning?: string;
          notification_warning?: string;
          notification_warning_detail?: string | null;
        };
      };
      const id = created.data?.id;
      const warning = created.data?.condition_sync_warning;
      if (warning) {
        // R5: request was created but equipment condition could not be synced.
        // Show this honestly instead of letting the asset's condition silently
        // disagree with the request's reported_condition.
        toast('warning', `Request created. Equipment condition could not be updated: ${warning}`);
      } else if (created.data?.notification_warning) {
        toast('warning', created.data.notification_warning_detail
          ? `Request created. Notification delivery needs review: ${created.data.notification_warning_detail}`
          : 'Request created, but notification delivery needs review.');
      } else {
        toast('success', 'Maintenance request created');
      }
      publishNotificationsUpdated('maintenance-request-created');
      router.push(id ? `/maintenance/requests/${id}` : '/requests');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Maintenance Request"
        description="Submit a corrective maintenance request for equipment support."
        actions={
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        }
      />

      {/* Duplicate warning panel */}
      {duplicateInfo && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-300">
                Active corrective work already exists for this equipment
              </p>
              <p className="mt-1 text-xs text-amber-200/80">
                <strong>{duplicateInfo.number}</strong> is currently{' '}
                <strong>{formatRequestStatus(duplicateInfo.status)}</strong>.{' '}
                {duplicateInfo.fault_description
                  ? `Reported issue: "${duplicateInfo.fault_description.slice(0, 120)}${duplicateInfo.fault_description.length > 120 ? '…' : ''}"`
                  : 'Open the active work item to review progress before submitting another request.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => router.push(duplicateInfo.blocker_type === 'maintenance_request'
                    ? `/maintenance/requests/${duplicateInfo.id}`
                    : `/maintenance/work-orders/${duplicateInfo.id}`)}
                >
                  Open Active Item
                </Button>
                <Button size="sm" variant="outline" onClick={() => router.back()}>
                  Back
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Request Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <OfflineSubmitBanner actionLabel="Maintenance request" />
            <OfflineActionResult result={offlineResult} />
            <div className="relative">
              <Select
                label="Equipment Asset *"
                placeholder="Select asset"
                value={form.asset_id}
                onChange={(e) => handleAssetChange(e.target.value)}
                options={assets.map((asset) => ({
                  value: asset.id,
                  label: `${asset.asset_code} - ${asset.name}`,
                }))}
              />
              {checkingDuplicate && (
                <span className="absolute right-3 top-8 text-xs text-[var(--text-muted)]">Checking…</span>
              )}
            </div>
            <Select
              label="Reported Equipment Condition *"
              placeholder="Select current condition"
              value={form.reported_condition}
              onChange={(e) => setForm((prev) => ({ ...prev, reported_condition: e.target.value }))}
              options={REPORTED_CONDITION_OPTIONS}
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
              <Button
                type="submit"
                loading={submitting}
                disabled={!!duplicateInfo || checkingDuplicate}
              >
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
