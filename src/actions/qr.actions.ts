'use server';

// QR identity server actions (Phase 1).
//
// All QR administration actions are gated to the equipment.edit capability,
// which in the CAPABILITY_MATRIX currently resolves to:
//   developer, admin (legacy), bme_head
// This intentionally mirrors who can already manage equipment metadata. QR
// admin is not a separate authorization plane from equipment admin.
//
// QR scanning, scan logging UI, and role-aware scan experiences are not in
// scope here; those land in later phases.

import { z } from 'zod';
import {
  getActionContextForCapability,
  logServerAuditEvent,
  revalidateMany,
  actionError,
  type ActionResult,
} from './_shared';
import {
  ensureAssetQrToken,
  regenerateAssetQrToken,
  markQrLabelPrinted,
  markQrLabelAttached,
  markQrLabelNeedsReplacement,
  revokeAssetQrToken,
  bulkGenerateMissingQrTokens,
  bulkMarkQrLabelsPrinted,
  bulkMarkQrLabelsAttached,
  bulkMarkQrLabelsNeedsReplacement,
  getAssetQrScanSummary,
  type EnsureQrTokenResult,
  type BulkGenerateResult,
  type BulkLabelUpdateResult,
} from '@/services/qr.service';
import type { AssetQrScanSummary } from '@/types/qr';

// Zod v4 .uuid() enforces RFC 4122 version nibble [1-8], rejecting the custom
// seed IDs (e.g. a0000001-0000-0000-0000-000000000001) whose nibble is 0.
const UUID_FORMAT = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const assetIdSchema = z.string().regex(UUID_FORMAT, 'Invalid asset id');
const assetIdentifierSchema = z.string().trim().min(1, 'Asset id is required');
const reasonSchema = z.string().trim().max(500).optional().nullable();

const qrRevalidatePaths = ['/equipment', '/inventory', '/developer-lab', '/command', '/equipment/qr-labels', '/equipment/qr-coverage'];

function pathsForAsset(assetId: string) {
  return [...qrRevalidatePaths, `/equipment/${assetId}`, `/inventory/${assetId}`];
}

function failure<T>(message: string): ActionResult<T> {
  return { success: false, error: message };
}

function actionFailureFrom<T>(err: unknown, fallback: string): ActionResult<T> {
  if (typeof err === 'string') return failure<T>(err);
  if (err && typeof err === 'object' && 'message' in err) {
    return failure<T>(String((err as { message: unknown }).message));
  }
  return failure<T>(fallback);
}

async function resolveAssetId(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  assetIdentifier: string,
) {
  const candidate = assetIdentifierSchema.parse(assetIdentifier);
  const parsed = assetIdSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  const { data, error } = await supabase
    .from('equipment_assets')
    .select('id')
    .eq('asset_code', candidate)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const resolved = (data as { id?: string } | null)?.id;
  if (!resolved) throw new Error('Invalid asset id');
  return resolved;
}

export async function ensureAssetQrTokenAction(
  assetId: string,
): Promise<ActionResult<EnsureQrTokenResult>> {
  try {
    const parsedId = assetIdSchema.parse(assetId);
    const { supabase, profile, error } = await getActionContextForCapability('equipment.edit');
    if (error || !profile) return { success: false, error };

    const result = await ensureAssetQrToken(parsedId, supabase);

    if (result.created) {
      await logServerAuditEvent({
        supabase,
        profileId: profile.id,
        action: 'qr.token.generate',
        entityType: 'equipment_assets',
        entityId: parsedId,
        details: { status: 'generated' },
      });
    }

    revalidateMany(pathsForAsset(parsedId));
    return { success: true, data: result };
  } catch (err) {
    return actionFailureFrom<EnsureQrTokenResult>(err, 'Failed to generate QR token');
  }
}

export async function regenerateAssetQrTokenAction(
  assetId: string,
  reason?: string | null,
): Promise<ActionResult<EnsureQrTokenResult>> {
  try {
    const parsedId = assetIdSchema.parse(assetId);
    const parsedReason = reasonSchema.parse(reason ?? null);
    const { supabase, profile, error } = await getActionContextForCapability('equipment.edit');
    if (error || !profile) return { success: false, error };

    const result = await regenerateAssetQrToken(parsedId, supabase);

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'qr.token.regenerate',
      entityType: 'equipment_assets',
      entityId: parsedId,
      details: { reason: parsedReason ?? null },
    });

    revalidateMany(pathsForAsset(parsedId));
    return { success: true, data: result };
  } catch (err) {
    return actionFailureFrom<EnsureQrTokenResult>(err, 'Failed to regenerate QR token');
  }
}

export async function markQrLabelPrintedAction(assetId: string): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('equipment.edit');
    if (error || !profile) return { success: false, error };
    const parsedId = await resolveAssetId(supabase, assetId);

    await markQrLabelPrinted(parsedId, supabase);

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'qr.label.printed',
      entityType: 'equipment_assets',
      entityId: parsedId,
    });

    revalidateMany(pathsForAsset(parsedId));
    return { success: true };
  } catch (err) {
    return actionError(err, 'Failed to mark QR label printed');
  }
}

export async function markQrLabelAttachedAction(assetId: string): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('equipment.edit');
    if (error || !profile) return { success: false, error };
    const parsedId = await resolveAssetId(supabase, assetId);

    await markQrLabelAttached(parsedId, supabase);

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'qr.label.attached',
      entityType: 'equipment_assets',
      entityId: parsedId,
    });

    revalidateMany(pathsForAsset(parsedId));
    return { success: true };
  } catch (err) {
    return actionError(err, 'Failed to mark QR label attached');
  }
}

export async function markQrLabelNeedsReplacementAction(
  assetId: string,
): Promise<ActionResult> {
  try {
    const parsedId = assetIdSchema.parse(assetId);
    const { supabase, profile, error } = await getActionContextForCapability('equipment.edit');
    if (error || !profile) return { success: false, error };

    await markQrLabelNeedsReplacement(parsedId, supabase);

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'qr.label.needs_replacement',
      entityType: 'equipment_assets',
      entityId: parsedId,
    });

    try {
      const { data: asset } = await supabase
        .from('equipment_assets')
        .select('name, asset_code, department_id')
        .eq('id', parsedId)
        .maybeSingle();
      const row = (asset ?? null) as { name?: string | null; asset_code?: string | null; department_id?: string | null } | null;
      const { emitNotificationEvent } = await import('@/services/notifications/notification-engine');
      await emitNotificationEvent({
        event_type: 'qr.label_needs_replacement',
        source_table: 'equipment_assets',
        source_id: parsedId,
        asset_id: parsedId,
        department_id: row?.department_id ?? null,
        priority: 'medium',
        payload: {
          asset_name: row?.name ?? null,
          asset_code: row?.asset_code ?? null,
        },
      });
    } catch (e) {
      console.error('[notifications] qr.label_needs_replacement emit failed:', e);
    }

    revalidateMany(pathsForAsset(parsedId));
    return { success: true };
  } catch (err) {
    return actionError(err, 'Failed to flag QR label for replacement');
  }
}

export async function revokeQrTokenAction(assetId: string): Promise<ActionResult> {
  try {
    const parsedId = assetIdSchema.parse(assetId);
    const { supabase, profile, error } = await getActionContextForCapability('equipment.edit');
    if (error || !profile) return { success: false, error };

    await revokeAssetQrToken(parsedId, supabase);

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'qr.token.revoke',
      entityType: 'equipment_assets',
      entityId: parsedId,
    });

    revalidateMany(pathsForAsset(parsedId));
    return { success: true };
  } catch (err) {
    return actionError(err, 'Failed to revoke QR token');
  }
}

const assetIdArraySchema = z
  .array(z.string().regex(UUID_FORMAT, 'Invalid asset id in selection'))
  .min(1, 'Select at least one asset');

async function runBulkLabelAction(
  assetIds: string[],
  auditAction: string,
  handler: (ids: string[], supabase: Parameters<typeof bulkMarkQrLabelsPrinted>[1]) => Promise<BulkLabelUpdateResult>,
): Promise<ActionResult<BulkLabelUpdateResult>> {
  try {
    const parsed = assetIdArraySchema.parse(assetIds);
    const { supabase, profile, error } = await getActionContextForCapability('equipment.edit');
    if (error || !profile) return { success: false, error };

    const result = await handler(parsed, supabase);

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: auditAction,
      entityType: 'equipment_assets',
      details: { count: parsed.length, ...result },
    });

    revalidateMany([...qrRevalidatePaths, '/equipment/qr-labels']);
    return { success: true, data: result };
  } catch (err) {
    return actionFailureFrom<BulkLabelUpdateResult>(err, 'Bulk label update failed');
  }
}

export async function markQrLabelsPrintedBulkAction(assetIds: string[]) {
  return runBulkLabelAction(assetIds, 'qr.label.printed.bulk', bulkMarkQrLabelsPrinted);
}

export async function markQrLabelsAttachedBulkAction(assetIds: string[]) {
  return runBulkLabelAction(assetIds, 'qr.label.attached.bulk', bulkMarkQrLabelsAttached);
}

export async function markQrLabelsNeedsReplacementBulkAction(assetIds: string[]) {
  return runBulkLabelAction(assetIds, 'qr.label.needs_replacement.bulk', bulkMarkQrLabelsNeedsReplacement);
}

export async function bulkGenerateMissingQrTokensAction(): Promise<
  ActionResult<BulkGenerateResult>
> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('equipment.edit');
    if (error || !profile) return { success: false, error };

    const result = await bulkGenerateMissingQrTokens(supabase);

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'qr.token.bulk_generate',
      entityType: 'equipment_assets',
      details: result as unknown as Record<string, unknown>,
    });

    revalidateMany(qrRevalidatePaths);
    return { success: true, data: result };
  } catch (err) {
    return actionFailureFrom<BulkGenerateResult>(err, 'Failed to bulk generate QR tokens');
  }
}

export async function getAssetQrScanSummaryAction(
  assetId: string,
): Promise<ActionResult<AssetQrScanSummary>> {
  try {
    const parsedId = assetIdSchema.parse(assetId);
    const { supabase, profile, error } = await getActionContextForCapability('equipment.edit');
    if (error || !profile) return { success: false, error };

    const result = await getAssetQrScanSummary(parsedId, supabase);
    return { success: true, data: result };
  } catch (err) {
    return actionFailureFrom<AssetQrScanSummary>(err, 'Failed to load QR scan evidence');
  }
}
