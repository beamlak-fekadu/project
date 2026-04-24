import type { SupabaseClient } from '@supabase/supabase-js';
import { loadLogistics } from './task-data-loaders';

export async function getInventoryLogisticsStatus(supabase: SupabaseClient) {
  const logistics = await loadLogistics(supabase);
  return {
    lowStockParts: logistics.lowStockParts,
    topProcurement: logistics.procurementPipeline.slice(0, 6),
  };
}
