import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatContextRefs, ChatModuleContext, MemorySnapshot, ResolvedEntity, UserChatProfile } from '@/types/chatbot';

interface ResolveParams {
  supabase: SupabaseClient;
  message: string;
  contextRefs?: ChatContextRefs;
  moduleContext?: ChatModuleContext;
  memory?: MemorySnapshot;
  profile: UserChatProfile;
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
  const { supabase, message, contextRefs, moduleContext, memory, profile } = params;
  const resolved: ResolvedEntity[] = [];

  if (contextRefs?.equipmentId) {
    const { data } = await supabase.from('equipment_assets').select('id, asset_code, name').eq('id', contextRefs.equipmentId).maybeSingle();
    if (data?.id) {
      resolved.push({
        type: 'equipment',
        id: data.id as string,
        label: `${(data.asset_code as string) ?? ''} ${(data.name as string) ?? ''}`.trim(),
        source: 'explicit_context',
      });
    }
  }

  if (contextRefs?.workOrderId) {
    const { data } = await supabase.from('work_orders').select('id, work_order_number').eq('id', contextRefs.workOrderId).maybeSingle();
    if (data?.id) {
      resolved.push({
        type: 'work_order',
        id: data.id as string,
        label: (data.work_order_number as string) ?? 'Work order',
        source: 'explicit_context',
      });
    }
  }

  if (contextRefs?.departmentId) {
    const { data } = await supabase.from('departments').select('id, name').eq('id', contextRefs.departmentId).maybeSingle();
    if (data?.id) {
      resolved.push({
        type: 'department',
        id: data.id as string,
        label: (data.name as string) ?? 'Department',
        source: 'explicit_context',
      });
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
      });
    }
  }

  if ((!resolved.length || asksForPriorReference(message)) && memory?.lastEntities?.length) {
    for (const entity of memory.lastEntities.slice(0, 3)) {
      if (!resolved.find((item) => item.type === entity.type && item.id === entity.id)) {
        resolved.push({
          ...entity,
          source: 'memory_context',
        });
      }
    }
  }

  const routeHint = `${moduleContext?.pathname ?? ''} ${moduleContext?.moduleLabel ?? ''}`.toLowerCase();
  const prefersWorkOrderContext = routeHint.includes('work-order') || routeHint.includes('maintenance');
  const prefersEquipmentContext = routeHint.includes('inventory') || routeHint.includes('equipment');
  if (prefersWorkOrderContext && !resolved.find((item) => item.type === 'work_order') && memory?.lastEntities?.length) {
    const previousWorkOrder = memory.lastEntities.find((item) => item.type === 'work_order');
    if (previousWorkOrder) resolved.push({ ...previousWorkOrder, source: 'module_context' });
  }
  if (prefersEquipmentContext && !resolved.find((item) => item.type === 'equipment') && memory?.lastEntities?.length) {
    const previousEquipment = memory.lastEntities.find((item) => item.type === 'equipment');
    if (previousEquipment) resolved.push({ ...previousEquipment, source: 'module_context' });
  }

  const workOrderNumber = parseWorkOrderNumber(message);
  if (workOrderNumber && !resolved.find((item) => item.type === 'work_order')) {
    const { data } = await supabase
      .from('work_orders')
      .select('id, work_order_number')
      .ilike('work_order_number', `${workOrderNumber}%`)
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      resolved.push({
        type: 'work_order',
        id: data.id as string,
        label: data.work_order_number as string,
        source: 'text_match',
      });
    }
  }

  if (!resolved.find((item) => item.type === 'equipment')) {
    const equipmentToken = message.match(/\basset\s+([A-Z0-9-]{3,})\b/i)?.[1];
    if (equipmentToken) {
      const { data } = await supabase
        .from('equipment_assets')
        .select('id, asset_code, name')
        .ilike('asset_code', `${equipmentToken}%`)
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        resolved.push({
          type: 'equipment',
          id: data.id as string,
          label: `${(data.asset_code as string) ?? ''} ${(data.name as string) ?? ''}`.trim(),
          source: 'text_match',
        });
      }
    }
  }

  return resolved;
}
