'use client';

import { useMemo, useState } from 'react';
import { ClipboardList, PackagePlus, Save, Wrench } from 'lucide-react';
import { createCalibrationRequestAction } from '@/actions/calibration.actions';
import { createMaintenanceEventAction, createMaintenanceRequestAction } from '@/actions/maintenance.actions';
import { createProcurementRequestAction } from '@/actions/procurement.actions';
import { createTrainingRequestAction } from '@/actions/training.actions';
import { OfflineActionResult } from '@/components/offline/OfflineActionResult';
import OfflineSubmitBanner from '@/components/offline/OfflineSubmitBanner';
import { Button, Input, Textarea } from '@/components/ui';
import { runOfflineCapableAction } from '@/lib/offline/queue';
import type { QrProfileContext, QrRoleCategory } from '@/services/qr-context.service';
import type { OfflineActionRunResult } from '@/types/offline';

type Props = {
  asset: {
    id: string;
    assetCode: string;
    name: string;
    departmentId?: string | null;
    qrToken?: string | null;
  };
  profile: QrProfileContext;
  roleCategory: QrRoleCategory;
  assignedWorkOrderId?: string | null;
  stockPartId?: string | null;
  stockPartName?: string | null;
};

function sourceRoute() {
  return typeof window === 'undefined' ? '/qr/a/[token]' : window.location.pathname + window.location.search;
}

export default function QrOfflineActions({
  asset,
  profile,
  roleCategory,
  assignedWorkOrderId,
  stockPartId,
  stockPartName,
}: Props) {
  const [note, setNote] = useState('');
  const [requestText, setRequestText] = useState('');
  const [trainingText, setTrainingText] = useState('');
  const [partText, setPartText] = useState(stockPartName ?? '');
  const [quantity, setQuantity] = useState('1');
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [result, setResult] = useState<OfflineActionRunResult | null>(null);

  const roleNames = useMemo(() => profile.roleNames ?? [], [profile.roleNames]);
  const canTechnician = roleCategory === 'technician';
  const canDepartment = roleCategory === 'department_head' || roleCategory === 'department_user';
  const canStore = roleCategory === 'store_user';
  const canDraftNote = roleCategory === 'bme_head';

  if (!canTechnician && !canDepartment && !canStore && !canDraftNote) {
    return null;
  }

  async function capture(actionName: string, runner: () => Promise<OfflineActionRunResult>) {
    setSubmitting(actionName);
    const next = await runner();
    setSubmitting(null);
    setResult(next);
    return next;
  }

  async function handleMaintenanceNote() {
    if (note.trim().length < 3) return;
    const payload = {
      asset_id: asset.id,
      work_order_id: assignedWorkOrderId ?? null,
      qr_token: asset.qrToken ?? null,
      event_type: 'inspection',
      action_taken: canDraftNote ? 'QR draft note' : 'QR maintenance note',
      note: note.trim(),
      notes: note.trim(),
      timestamp: new Date().toISOString(),
      source: 'qr-scan',
    };
    const next = await capture('note', () => runOfflineCapableAction({
      actionType: canDraftNote ? 'qr_note.create' : 'maintenance_event.log',
      entityType: 'maintenance_events',
      entityId: assignedWorkOrderId ?? null,
      assetId: asset.id,
      qrToken: asset.qrToken ?? null,
      payload,
      createdByProfileId: profile.id,
      roleName: roleCategory,
      roleNames,
      sourceRoute: sourceRoute(),
      executeOnline: () => createMaintenanceEventAction(payload),
      metadata: { form: 'qr_offline_note', role_category: roleCategory },
    }));
    if (next.status === 'queued' || next.status === 'success') setNote('');
  }

  async function handlePartsNeeded() {
    if (partText.trim().length < 2) return;
    const payload = {
      asset_id: asset.id,
      work_order_id: assignedWorkOrderId ?? null,
      qr_token: asset.qrToken ?? null,
      event_type: 'corrective',
      action_taken: 'Parts needed / awaiting parts',
      note: partText.trim(),
      notes: `Parts needed: ${partText.trim()}`,
      parts_needed: { description: partText.trim(), quantity: Number(quantity) || 1 },
      timestamp: new Date().toISOString(),
      source: 'qr-scan',
    };
    const next = await capture('parts', () => runOfflineCapableAction({
      actionType: 'maintenance_event.log',
      entityType: 'maintenance_events',
      entityId: assignedWorkOrderId ?? null,
      assetId: asset.id,
      qrToken: asset.qrToken ?? null,
      payload,
      createdByProfileId: profile.id,
      roleName: roleCategory,
      roleNames,
      sourceRoute: sourceRoute(),
      executeOnline: () => createMaintenanceEventAction(payload),
      metadata: { form: 'qr_parts_needed', role_category: roleCategory },
    }));
    if (next.status === 'queued' || next.status === 'success') setPartText('');
  }

  async function handleMaintenanceRequest() {
    if (requestText.trim().length < 10) return;
    const payload = {
      asset_id: asset.id,
      qr_token: asset.qrToken ?? null,
      requested_by: null,
      department_id: profile.department_id ?? asset.departmentId ?? null,
      fault_description: requestText.trim(),
      urgency: 'medium',
      status: 'pending',
      reported_condition: 'functional_issue',
      reported_condition_source: 'qr_offline_phase2',
      notes: `Source: QR scan\nAsset: ${asset.assetCode}`,
    };
    const actionType = canDepartment ? 'department_issue.report' : 'maintenance_request.create';
    const next = await capture('request', () => runOfflineCapableAction({
      actionType,
      entityType: 'maintenance_requests',
      assetId: asset.id,
      qrToken: asset.qrToken ?? null,
      payload,
      createdByProfileId: profile.id,
      roleName: roleCategory,
      roleNames,
      sourceRoute: sourceRoute(),
      executeOnline: () => createMaintenanceRequestAction(payload),
      metadata: { form: 'qr_corrective_request', role_category: roleCategory },
    }));
    if (next.status === 'queued' || next.status === 'success') setRequestText('');
  }

  async function handleCalibrationRequest() {
    const payload = {
      asset_id: asset.id,
      qr_token: asset.qrToken ?? null,
      requested_by: null,
      calibration_type_id: null,
      urgency: 'medium',
      status: 'pending',
      notes: requestText.trim() || `Calibration requested from QR scan for ${asset.assetCode}`,
      submitted_by_profile_id: profile.id,
      department_id: profile.department_id ?? asset.departmentId ?? null,
    };
    await capture('calibration', () => runOfflineCapableAction({
      actionType: 'calibration_request.create',
      entityType: 'calibration_requests',
      assetId: asset.id,
      qrToken: asset.qrToken ?? null,
      payload,
      createdByProfileId: profile.id,
      roleName: roleCategory,
      roleNames,
      sourceRoute: sourceRoute(),
      executeOnline: () => createCalibrationRequestAction(payload),
      metadata: { form: 'qr_calibration_request', role_category: roleCategory },
    }));
  }

  async function handleTrainingRequest() {
    const description = trainingText.trim() || `Training requested for safe operation of ${asset.name}`;
    if (description.length < 10) return;
    const payload = {
      asset_id: asset.id,
      qr_token: asset.qrToken ?? null,
      requested_by: null,
      department_id: profile.department_id ?? asset.departmentId ?? null,
      training_type: 'equipment_operation',
      description,
      status: 'pending',
      notes: `Source: QR scan\nAsset: ${asset.assetCode}`,
      submitted_by_profile_id: profile.id,
    };
    const next = await capture('training', () => runOfflineCapableAction({
      actionType: 'training_request.create',
      entityType: 'training_requests',
      assetId: asset.id,
      qrToken: asset.qrToken ?? null,
      payload,
      createdByProfileId: profile.id,
      roleName: roleCategory,
      roleNames,
      sourceRoute: sourceRoute(),
      executeOnline: () => createTrainingRequestAction(payload),
      metadata: { form: 'qr_training_request', role_category: roleCategory },
    }));
    if (next.status === 'queued' || next.status === 'success') setTrainingText('');
  }

  async function handleStoreReorder() {
    const requestedQuantity = Number(quantity) || 1;
    const partName = partText.trim() || stockPartName || 'spare part';
    const payload = {
      part_id: stockPartId ?? null,
      part_name: partName,
      part_description: partName,
      requested_quantity: requestedQuantity,
      quantity: requestedQuantity,
      reason: `Offline reorder draft from QR scan for ${asset.assetCode}`,
      title: `Procure ${partName}`,
      justification: `Offline reorder draft from QR scan for ${asset.assetCode}\nAsset: ${asset.name}\nRequested quantity: ${requestedQuantity}`,
      status: 'requested',
      priority: 'medium',
      expected_delivery_date: null,
      qr_token: asset.qrToken ?? null,
    };
    const next = await capture('reorder', () => runOfflineCapableAction({
      actionType: 'store_reorder.create',
      entityType: 'procurement_requests',
      assetId: asset.id,
      qrToken: asset.qrToken ?? null,
      payload,
      createdByProfileId: profile.id,
      roleName: roleCategory,
      roleNames,
      sourceRoute: sourceRoute(),
      executeOnline: () => createProcurementRequestAction(payload),
      metadata: { form: 'qr_store_reorder', role_category: roleCategory, stock_part_id: stockPartId ?? null },
    }));
    if (next.status === 'queued' || next.status === 'success') setPartText(stockPartName ?? '');
  }

  return (
    <section className="mt-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Offline-Capable Capture
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          These actions save intent locally when the network is unavailable and sync only after server validation.
        </p>
      </div>
      <OfflineSubmitBanner actionLabel="QR offline action" />
      <OfflineActionResult result={result} />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {(canTechnician || canDraftNote) && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Wrench className="h-4 w-4" />
              Maintenance Note
            </div>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Observation, troubleshooting note, or draft comment" />
            <Button className="mt-3" size="sm" onClick={handleMaintenanceNote} loading={submitting === 'note'} disabled={note.trim().length < 3}>
              <Save className="h-4 w-4" />
              Save Note
            </Button>
          </div>
        )}

        {(canTechnician || canDepartment) && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <ClipboardList className="h-4 w-4" />
              Request Capture
            </div>
            <Textarea value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="Describe the problem or request context" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={handleMaintenanceRequest} loading={submitting === 'request'} disabled={requestText.trim().length < 10}>
                Report Problem
              </Button>
              {canDepartment && (
                <Button size="sm" variant="outline" onClick={handleCalibrationRequest} loading={submitting === 'calibration'}>
                  Request Calibration
                </Button>
              )}
            </div>
          </div>
        )}

        {canTechnician && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <PackagePlus className="h-4 w-4" />
              Parts Needed Note
            </div>
            <Input value={partText} onChange={(event) => setPartText(event.target.value)} placeholder="Part description" />
            <Input className="mt-2" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            <Button className="mt-3" size="sm" onClick={handlePartsNeeded} loading={submitting === 'parts'} disabled={partText.trim().length < 2}>
              Save Parts Note
            </Button>
          </div>
        )}

        {canDepartment && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <ClipboardList className="h-4 w-4" />
              Training Request
            </div>
            <Textarea value={trainingText} onChange={(event) => setTrainingText(event.target.value)} placeholder="Describe the training need" />
            <Button className="mt-3" size="sm" onClick={handleTrainingRequest} loading={submitting === 'training'}>
              Request Training
            </Button>
          </div>
        )}

        {canStore && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <PackagePlus className="h-4 w-4" />
              Reorder Draft
            </div>
            <Input value={partText} onChange={(event) => setPartText(event.target.value)} placeholder="Part name or description" />
            <Input className="mt-2" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            <Button className="mt-3" size="sm" onClick={handleStoreReorder} loading={submitting === 'reorder'} disabled={partText.trim().length < 2 && !stockPartId}>
              Save Reorder Draft
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
