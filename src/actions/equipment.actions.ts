'use server';

import { z } from 'zod';
import { recomputeAssetAnalytics } from './analytics.actions';
import { getActionContext, logServerAuditEvent, revalidateMany, actionError, nullIfEmpty, type ActionResult } from './_shared';

const equipmentSchema = z.object({
  asset_code: z.string().trim().min(1),
  serial_number: z.string().optional().nullable(),
  name: z.string().trim().min(1),
  category_id: z.string().min(1),
  department_id: z.string().min(1),
  manufacturer_id: z.string().optional().nullable(),
  model_id: z.string().optional().nullable(),
  vendor_id: z.string().optional().nullable(),
  supplier_id: z.string().optional().nullable(),
  installation_date: z.string().optional().nullable(),
  warranty_expiry: z.string().optional().nullable(),
  service_contract_expiry: z.string().optional().nullable(),
  condition: z.enum(['functional', 'needs_repair', 'non_functional', 'under_maintenance', 'decommissioned']),
  status: z.enum(['active', 'inactive', 'disposed', 'in_storage']).default('active'),
  purchase_date: z.string().optional().nullable(),
  purchase_cost: z.coerce.number().nullable().optional(),
  source: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  photo_url: z.string().optional().nullable(),
});

const equipmentRevalidatePaths = ['/equipment', '/inventory', '/command', '/reports/equipment'];

function normalizeEquipment(payload: Record<string, unknown>) {
  const parsed = equipmentSchema.parse(payload);
  return {
    ...parsed,
    asset_code: parsed.asset_code.trim().toUpperCase(),
    name: parsed.name.trim(),
    serial_number: nullIfEmpty(parsed.serial_number),
    manufacturer_id: nullIfEmpty(parsed.manufacturer_id),
    model_id: nullIfEmpty(parsed.model_id),
    vendor_id: nullIfEmpty(parsed.vendor_id),
    supplier_id: nullIfEmpty(parsed.supplier_id),
    installation_date: nullIfEmpty(parsed.installation_date),
    warranty_expiry: nullIfEmpty(parsed.warranty_expiry),
    service_contract_expiry: nullIfEmpty(parsed.service_contract_expiry),
    purchase_date: nullIfEmpty(parsed.purchase_date),
    purchase_cost: parsed.purchase_cost ?? null,
    source: nullIfEmpty(parsed.source),
    notes: nullIfEmpty(parsed.notes),
    photo_url: nullIfEmpty(parsed.photo_url),
  };
}

export async function createEquipmentAction(payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContext(['admin', 'bme_head', 'technician']);
    if (error || !profile) return { success: false, error };
    const data = normalizeEquipment(payload);

    const { data: duplicate } = await supabase
      .from('equipment_assets')
      .select('id')
      .eq('asset_code', data.asset_code)
      .is('deleted_at', null)
      .limit(1);
    if (duplicate && duplicate.length > 0) return { success: false, error: 'Duplicate asset code detected. Please use a unique code.' };

    const result = await supabase.from('equipment_assets').insert(data as never).select('*').single();
    if (result.error) return { success: false, error: result.error.message };

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'equipment.create',
      entityType: 'equipment_assets',
      entityId: (result.data as { id?: string }).id ?? null,
      newValues: result.data as Record<string, unknown>,
    });
    const assetId = (result.data as { id?: string }).id;
    if (assetId) await recomputeAssetAnalytics(assetId).catch(() => undefined);
    revalidateMany(equipmentRevalidatePaths);
    return { success: true, data: result.data };
  } catch (err) {
    return actionError(err, 'Failed to create equipment');
  }
}

export async function updateEquipmentAction(id: string, payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContext(['admin', 'bme_head', 'technician']);
    if (error || !profile) return { success: false, error };
    const data = normalizeEquipment(payload);
    const oldRow = await supabase.from('equipment_assets').select('*').eq('id', id).maybeSingle();
    const result = await supabase.from('equipment_assets').update(data as never).eq('id', id).select('*').single();
    if (result.error) return { success: false, error: result.error.message };

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'equipment.update',
      entityType: 'equipment_assets',
      entityId: id,
      oldValues: oldRow.data as Record<string, unknown> | null,
      newValues: result.data as Record<string, unknown>,
    });
    await recomputeAssetAnalytics(id).catch(() => undefined);
    revalidateMany([...equipmentRevalidatePaths, `/equipment/${id}`, `/inventory/${id}`]);
    return { success: true, data: result.data };
  } catch (err) {
    return actionError(err, 'Failed to update equipment');
  }
}

export async function softDeleteEquipmentAction(id: string): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContext(['admin', 'bme_head', 'technician']);
    if (error || !profile) return { success: false, error };
    const oldRow = await supabase.from('equipment_assets').select('*').eq('id', id).maybeSingle();
    const result = await supabase
      .from('equipment_assets')
      .update({ deleted_at: new Date().toISOString() } as never)
      .eq('id', id)
      .select('id')
      .single();
    if (result.error) return { success: false, error: result.error.message };

    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'equipment.delete',
      entityType: 'equipment_assets',
      entityId: id,
      oldValues: oldRow.data as Record<string, unknown> | null,
      newValues: { deleted_at: true },
    });
    revalidateMany(equipmentRevalidatePaths);
    return { success: true, data: result.data };
  } catch (err) {
    return actionError(err, 'Failed to delete equipment');
  }
}
