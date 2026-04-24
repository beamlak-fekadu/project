import type { SupabaseClient } from '@supabase/supabase-js';
import { loadLogistics } from './task-data-loaders';

export async function getProcurementStatus(supabase: SupabaseClient) {
  const logistics = await loadLogistics(supabase);
  return {
    procurementPipeline: logistics.procurementPipeline,
    lowStockCount: logistics.lowStockParts.length,
  };
}
