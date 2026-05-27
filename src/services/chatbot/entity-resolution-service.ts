import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatContextRefs, ChatModuleContext, MemorySnapshot, ResolvedEntity, UserChatProfile } from '@/types/chatbot';
import { requiresDepartmentScope } from './copilot-rbac';

interface ResolveParams {
  supabase: SupabaseClient;
  message: string;
  contextRefs?: ChatContextRefs;
  moduleContext?: ChatModuleContext;
  memory?: MemorySnapshot;
  profile: UserChatProfile;
}

export interface EntityResolutionWarning {
  type: 'ambiguous_text_match' | 'out_of_department_text_match' | 'no_scoped_match' | 'context_conflict';
  reason: string;
  detail?: string;
}

export interface EntityResolutionResult {
  resolved: ResolvedEntity[];
  warnings: EntityResolutionWarning[];
}

function parseWorkOrderNumber(message: string) {
  const match = message.match(/\bWO[-\s]?([A-Z0-9]{3,})\b/i);
  return match ? `WO-${match[1].toUpperCase()}` : null;
}

function asksForPriorReference(message: string) {
  return (
    /\b(it|that|this one|that one|this asset|this wo|this work order|previous|earlier|last (one|time)|the one we discussed|the (monitor|unit|device|machine) (we |)(discussed|looked at))\b/i.test(
      message
    ) || /\bwhat about (this|that|it)\b/i.test(message) || /\b(compare|compared) to the (other|last)\b/i.test(message)
  );
}

export async function resolveEntities(params: ResolveParams): Promise<ResolvedEntity[]> {
  const result = await resolveEntitiesDetailed(params);
  return result.resolved;
}

export async function resolveEntitiesDetailed(params: ResolveParams): Promise<EntityResolutionResult> {
  const { supabase, message, contextRefs, moduleContext, memory, profile } = params;
  const resolved: ResolvedEntity[] = [];
  const warnings: EntityResolutionWarning[] = [];
  const departmentScopedRole = requiresDepartmentScope(profile);
  const profileDepartmentId = profile.departmentId ?? null;

  if (contextRefs?.equipmentId) {
    const { data } = await supabase
      .from('equipment_assets')
      .select('id, asset_code, name, department_id')
      .eq('id', contextRefs.equipmentId)
      .maybeSingle();
    if (data?.id) {
      const deptId = (data.department_id as string | null) ?? null;
      if (departmentScopedRole && profileDepartmentId && deptId && deptId !== profileDepartmentId) {
        warnings.push({
          type: 'out_of_department_text_match',
          reason: 'explicit_context_equipment_out_of_department',
          detail: 'Explicit equipment context points to an asset outside your department.',
        });
        // Do NOT leak the asset code/name into the resolved set.
      } else {
        resolved.push({
          type: 'equipment',
          id: data.id as string,
          label: `${(data.asset_code as string) ?? ''} ${(data.name as string) ?? ''}`.trim(),
          source: 'explicit_context',
          confidence: 0.88,
          freshness: 'current',
        });
      }
    }
  }

  if (contextRefs?.workOrderId) {
    const { data } = await supabase
      .from('work_orders')
      .select('id, work_order_number, asset_id, equipment_assets:asset_id(department_id)')
      .eq('id', contextRefs.workOrderId)
      .maybeSingle();
    if (data?.id) {
      const deptId =
        ((data as Record<string, unknown>).equipment_assets as { department_id?: string | null } | null)?.department_id ?? null;
      if (departmentScopedRole && profileDepartmentId && deptId && deptId !== profileDepartmentId) {
        warnings.push({
          type: 'out_of_department_text_match',
          reason: 'explicit_context_work_order_out_of_department',
          detail: 'Explicit work-order context points to a record outside your department.',
        });
      } else {
        resolved.push({
          type: 'work_order',
          id: data.id as string,
          label: (data.work_order_number as string) ?? 'Work order',
          source: 'explicit_context',
          confidence: 0.88,
          freshness: 'current',
        });
      }
    }
  }

  if (contextRefs?.departmentId) {
    if (departmentScopedRole && profileDepartmentId && contextRefs.departmentId !== profileDepartmentId) {
      warnings.push({
        type: 'out_of_department_text_match',
        reason: 'explicit_context_department_mismatch',
        detail: 'Explicit department context does not match your scope.',
      });
    } else {
      const { data } = await supabase.from('departments').select('id, name').eq('id', contextRefs.departmentId).maybeSingle();
      if (data?.id) {
        resolved.push({
          type: 'department',
          id: data.id as string,
          label: (data.name as string) ?? 'Department',
          source: 'explicit_context',
          confidence: 0.86,
          freshness: 'current',
        });
      }
    }
  }

  if (!resolved.find((item) => item.type === 'department') && profile.departmentId) {
    const { data } = await supabase.from('departments').select('id, name').eq('id', profile.departmentId).maybeSingle();
    if (data?.id) {
      resolved.push({
        type: 'department',
        id: data.id as string,
        label: (data.name as string) ?? 'Department',
        source: 'module_context',
        confidence: 0.72,
        freshness: 'unknown',
      });
    }
  }

  if ((!resolved.length || asksForPriorReference(message)) && memory?.lastEntities?.length) {
    for (const entity of memory.lastEntities.slice(0, 3)) {
      if (!resolved.find((item) => item.type === entity.type && item.id === entity.id)) {
        resolved.push({
          ...entity,
          source: 'memory_context',
          confidence: Math.min(entity.confidence ?? 0.58, 0.58),
          freshness: entity.freshness ?? 'unknown',
        });
      }
    }
  }

  const routeHint = `${moduleContext?.pathname ?? ''} ${moduleContext?.moduleLabel ?? ''}`.toLowerCase();
  const prefersWorkOrderContext = routeHint.includes('work-order') || routeHint.includes('maintenance');
  const prefersEquipmentContext = routeHint.includes('inventory') || routeHint.includes('equipment');
  if (prefersWorkOrderContext && !resolved.find((item) => item.type === 'work_order') && memory?.lastEntities?.length) {
    const previousWorkOrder = memory.lastEntities.find((item) => item.type === 'work_order');
    if (previousWorkOrder) resolved.push({ ...previousWorkOrder, source: 'module_context', confidence: 0.62, freshness: 'unknown' });
  }
  if (prefersEquipmentContext && !resolved.find((item) => item.type === 'equipment') && memory?.lastEntities?.length) {
    const previousEquipment = memory.lastEntities.find((item) => item.type === 'equipment');
    if (previousEquipment) resolved.push({ ...previousEquipment, source: 'module_context', confidence: 0.62, freshness: 'unknown' });
  }

  const workOrderNumber = parseWorkOrderNumber(message);
  if (workOrderNumber) {
    let woQuery = supabase
      .from('work_orders')
      .select('id, work_order_number, asset_id, equipment_assets:asset_id(department_id)')
      .ilike('work_order_number', `${workOrderNumber}%`)
      .limit(2);
    if (departmentScopedRole && profileDepartmentId) {
      // Only resolve work orders whose asset belongs to the user's department.
      // The .filter on a foreign key is enforced at the DB layer too (RLS),
      // but we make the scope explicit so we don't accept silently-empty
      // ambiguous matches when permission is the cause.
      woQuery = woQuery.filter('equipment_assets.department_id', 'eq', profileDepartmentId);
    }
    const { data: rows } = await woQuery;
    const rowList = (rows ?? []) as Array<Record<string, unknown>>;
    if (rowList.length === 0) {
      if (departmentScopedRole && profileDepartmentId) {
        warnings.push({
          type: 'no_scoped_match',
          reason: 'work_order_text_no_department_match',
          detail: `No work order matching "${workOrderNumber}" is available in your department.`,
        });
      }
    } else if (rowList.length > 1) {
      warnings.push({
        type: 'ambiguous_text_match',
        reason: 'work_order_text_ambiguous',
        detail: `Multiple work orders match "${workOrderNumber}"; please share the full work-order number or open the record from the Work Orders page.`,
      });
    } else {
      const row = rowList[0];
      const deptId =
        ((row as Record<string, unknown>).equipment_assets as { department_id?: string | null } | null)?.department_id ?? null;
      if (departmentScopedRole && profileDepartmentId && deptId && deptId !== profileDepartmentId) {
        warnings.push({
          type: 'out_of_department_text_match',
          reason: 'work_order_text_out_of_department',
          detail: 'The matched work order is outside your department.',
        });
      } else {
        const existingWorkOrder = resolved.find((item) => item.type === 'work_order');
        const textResolved: ResolvedEntity = {
          type: 'work_order',
          id: row.id as string,
          label: row.work_order_number as string,
          source: 'text_match',
          confidence: 0.96,
          freshness: 'current',
        };
        if (existingWorkOrder && existingWorkOrder.id !== textResolved.id) {
          warnings.push({
            type: 'context_conflict',
            reason: 'work_order_text_overrode_context',
            detail: `The message names ${workOrderNumber}, which differs from the current page or memory work order. I used the explicitly named work order.`,
          });
          const index = resolved.findIndex((item) => item.type === 'work_order');
          resolved.splice(index, 1, { ...textResolved, conflictReason: 'Explicit work-order text overrode page or memory context.' });
        } else if (!existingWorkOrder) {
          resolved.push(textResolved);
        }
      }
    }
  }

  {
    const equipmentToken = message.match(/\basset\s+([A-Z0-9-]{3,})\b/i)?.[1];
    if (equipmentToken) {
      let assetQuery = supabase
        .from('equipment_assets')
        .select('id, asset_code, name, department_id')
        .ilike('asset_code', `${equipmentToken}%`)
        .limit(2);
      if (departmentScopedRole && profileDepartmentId) {
        assetQuery = assetQuery.eq('department_id', profileDepartmentId);
      }
      const { data: rows } = await assetQuery;
      const rowList = (rows ?? []) as Array<Record<string, unknown>>;
      if (rowList.length === 0) {
        if (departmentScopedRole && profileDepartmentId) {
          warnings.push({
            type: 'no_scoped_match',
            reason: 'equipment_text_no_department_match',
            detail: `No asset matching "${equipmentToken}" is available in your department.`,
          });
        }
      } else if (rowList.length > 1) {
        warnings.push({
          type: 'ambiguous_text_match',
          reason: 'equipment_text_ambiguous',
          detail: `Multiple assets match "${equipmentToken}"; please share the full asset code or open the asset from the Equipment list.`,
        });
      } else {
        const row = rowList[0];
        const deptId = (row.department_id as string | null) ?? null;
        if (departmentScopedRole && profileDepartmentId && deptId && deptId !== profileDepartmentId) {
          warnings.push({
            type: 'out_of_department_text_match',
            reason: 'equipment_text_out_of_department',
            detail: 'The matched asset is outside your department.',
          });
        } else {
          const existingEquipment = resolved.find((item) => item.type === 'equipment');
          const textResolved: ResolvedEntity = {
            type: 'equipment',
            id: row.id as string,
            label: `${(row.asset_code as string) ?? ''} ${(row.name as string) ?? ''}`.trim(),
            source: 'text_match',
            confidence: 0.94,
            freshness: 'current',
          };
          if (existingEquipment && existingEquipment.id !== textResolved.id) {
            warnings.push({
              type: 'context_conflict',
              reason: 'equipment_text_overrode_context',
              detail: `The message names asset ${equipmentToken}, which differs from the current page or memory asset. I used the explicitly named asset.`,
            });
            const index = resolved.findIndex((item) => item.type === 'equipment');
            resolved.splice(index, 1, { ...textResolved, conflictReason: 'Explicit asset text overrode page or memory context.' });
          } else if (!existingEquipment) {
            resolved.push(textResolved);
          }
        }
      }
    }
  }

  return { resolved, warnings };
}
