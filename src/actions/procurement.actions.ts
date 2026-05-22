'use server';

import { z } from 'zod';
import { getActionContextForCapability, logServerAuditEvent, refreshDecisionSupportSnapshotsBestEffort, revalidateMany, actionError, nullIfEmpty, interpretMissingMutationResult, type ActionResult } from './_shared';
import {
  NOTIFICATION_DELIVERY_REVIEW_WARNING,
  createNotificationEvent,
  makeFailedNotificationResult,
  notificationDeliveryNeedsReview,
  notificationProcessSnapshot,
  notificationReviewDetail,
} from '@/services/notifications/notification-engine';

const procurementPaths = ['/procurement', '/logistics', '/calendar', '/command'];
const procurementStatus = z.enum(['requested', 'approved', 'ordered', 'in_transit', 'delivered', 'canceled']);
const requestedQuantitySchema = z.preprocess((value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : value;
}, z.number().int().positive().optional().nullable());

export async function createProcurementRequestAction(payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('procurement.request');
    if (error || !profile) return { success: false, error };
    const parsed = z.object({
      title: z.string().trim().min(5),
      justification: z.string().trim().min(15),
      status: procurementStatus.optional(),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      requested_by: z.string().optional().nullable(),
      department_id: z.string().optional().nullable(),
      expected_delivery_date: z.string().optional().nullable(),
      spare_part_id: z.string().uuid().optional().nullable(),
      part_id: z.string().uuid().optional().nullable(),
      requested_quantity: requestedQuantitySchema,
      // R32: when launched from /replacement/[assetId] evidence panel.
      source_replacement_score_id: z.string().uuid().optional().nullable(),
    }).parse(payload);
    const data = {
      title: parsed.title,
      justification: parsed.justification,
      request_number: `PR-${Date.now().toString(36).toUpperCase()}`,
      requested_by: nullIfEmpty(parsed.requested_by) ?? profile.id,
      department_id: nullIfEmpty(parsed.department_id) ?? profile.department_id,
      status: parsed.status ?? 'requested',
      priority: parsed.priority ?? 'medium',
      expected_delivery_date: nullIfEmpty(parsed.expected_delivery_date),
      spare_part_id: nullIfEmpty(parsed.spare_part_id ?? parsed.part_id),
      requested_quantity: parsed.requested_quantity ?? null,
      source_replacement_score_id: nullIfEmpty(parsed.source_replacement_score_id),
    };
    const result = await supabase.from('procurement_requests').insert(data as never).select('*').single();
    if (result.error) return { success: false, error: result.error.message };
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'procurement_request.create', entityType: 'procurement_requests', entityId: (result.data as { id?: string }).id ?? null, newValues: result.data as Record<string, unknown> });
    await refreshDecisionSupportSnapshotsBestEffort({
      supabase,
      profileId: profile.id,
      reason: 'procurement_request.create',
      entityType: 'procurement_requests',
      entityId: (result.data as { id?: string }).id ?? null,
    }).catch(() => undefined);
    revalidateMany(procurementPaths);
    return { success: true, data: result.data };
  } catch (err) {
    return actionError(err, 'Failed to create procurement request');
  }
}

export async function updateProcurementStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('procurement.status_update');
    if (error || !profile) return { success: false, error };
    const parsedStatus = procurementStatus.parse(status);
    const oldRow = await supabase.from('procurement_requests').select('*').eq('id', id).maybeSingle();
    // SHAPE-01: maybeSingle handles RLS-filtered rows cleanly.
    const result = await supabase.from('procurement_requests').update({ status: parsedStatus } as never).eq('id', id).select('*').maybeSingle();
    if (result.error) return { success: false, error: result.error.message };
    if (!result.data) {
      return interpretMissingMutationResult({
        entity: 'procurement request',
        entityId: id,
        attempted: `status=${parsedStatus}`,
        profileId: profile.id,
      });
    }
    await logServerAuditEvent({ supabase, profileId: profile.id, action: 'procurement_request.status_update', entityType: 'procurement_requests', entityId: id, oldValues: oldRow.data as Record<string, unknown> | null, newValues: result.data as Record<string, unknown> });

    let notificationWarning: string | null = null;
    let notificationResult: Record<string, unknown> | null = null;
    if (parsedStatus === 'delivered') {
      try {
        const row = result.data as Record<string, unknown>;
        const description = (row.description as string) ?? (row.title as string) ?? 'Procurement request';

        // R21: delivered does NOT auto-update spare_parts.current_stock.
        // The dedicated 'procurement.delivered_pending_receipt' event links
        // Store User to a prefilled stock-receipt form. The structured
        // spare_part_id/requested_quantity fields added in migration 00075
        // make that handoff exact while keeping stock mutation in receipt.
        // receipt action then transactionally bumps stock AND persists
        // stock_receipts.procurement_id so future queries can answer
        // "what came of procurement X" without guessing.
        const sparePartId = (row.spare_part_id as string | null) ?? null;
        const requestedQuantity = typeof row.requested_quantity === 'number' ? row.requested_quantity : null;
        const receiptParams = new URLSearchParams({
          action: 'record-receipt',
          procurement_id: id,
          source: 'procurement-delivery',
        });
        if (sparePartId) receiptParams.set('partId', sparePartId);
        if (requestedQuantity) receiptParams.set('quantity', String(requestedQuantity));
        const pendingReceiptNotification = await createNotificationEvent({
          event_type: 'procurement.delivered_pending_receipt',
          source_table: 'procurement_requests',
          source_id: id,
          priority: 'medium',
          payload: {
            description,
            status: parsedStatus,
            request_number: (row.request_number as string | null) ?? null,
            spare_part_id: sparePartId,
            part_id: sparePartId,
            requested_quantity: requestedQuantity,
            // Action link for the notification deep-link. Store User clicks
            // through to /spare-parts with the receipt modal prefilled.
            stock_receipt_prefill_href: `/spare-parts?${receiptParams.toString()}`,
          },
        });
        if (notificationDeliveryNeedsReview(pendingReceiptNotification)) {
          notificationWarning = NOTIFICATION_DELIVERY_REVIEW_WARNING;
          notificationResult = {
            ...notificationProcessSnapshot(pendingReceiptNotification),
            detail: notificationReviewDetail(pendingReceiptNotification),
          };
        }

        // Existing event preserved for downstream consumers that already
        // subscribe to the legacy name. The pending-receipt event above is
        // the new signal Store User should act on.
        await createNotificationEvent({
          event_type: 'procurement.delivered',
          source_table: 'procurement_requests',
          source_id: id,
          priority: 'medium',
          payload: {
            description,
            status: parsedStatus,
          },
        });
      } catch (e) {
        console.error('[notifications] procurement.delivered emit failed:', e);
        const failed = makeFailedNotificationResult('procurement.delivered', e);
        if (notificationDeliveryNeedsReview(failed)) {
          notificationWarning = NOTIFICATION_DELIVERY_REVIEW_WARNING;
          notificationResult = { ...notificationProcessSnapshot(failed), detail: notificationReviewDetail(failed) };
        }
      }
    }

    await refreshDecisionSupportSnapshotsBestEffort({
      supabase,
      profileId: profile.id,
      reason: `procurement_request.status_update.${parsedStatus}`,
      entityType: 'procurement_requests',
      entityId: id,
    }).catch(() => undefined);
    revalidateMany(procurementPaths);
    return {
      success: true,
      data: {
        ...(result.data as Record<string, unknown>),
        ...(notificationWarning
          ? { notification_warning: notificationWarning, notification_result: notificationResult }
          : {}),
      },
    };
  } catch (err) {
    return actionError(err, 'Failed to update procurement status');
  }
}
