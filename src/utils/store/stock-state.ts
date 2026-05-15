// Canonical stock-state classification for the Store User role.
//
// Definitions (consistent everywhere Store User sees stock):
//   - Stockout       : current_stock <= 0
//   - Low stock      : 0 < current_stock <= reorder_level
//   - Healthy        : current_stock > reorder_level
//   - Reorder deficit: max(0, reorder_level - current_stock)
//
// Open procurement statuses (replenishment in flight):
//   requested, approved, ordered, in_transit
// Delivered means received from supplier — Store User still has to receive it
// into stock.

export type StockState = 'healthy' | 'low' | 'stockout';

export interface StockLike {
  current_stock?: number | null;
  reorder_level?: number | null;
}

export function classifyStock(part: StockLike): StockState {
  const current = Number(part.current_stock ?? 0);
  const reorder = Number(part.reorder_level ?? 0);
  if (current <= 0) return 'stockout';
  if (current <= reorder) return 'low';
  return 'healthy';
}

export function stockDeficit(part: StockLike): number {
  const current = Number(part.current_stock ?? 0);
  const reorder = Number(part.reorder_level ?? 0);
  return Math.max(0, reorder - current);
}

export const OPEN_PROCUREMENT_STATUSES: ReadonlySet<string> = new Set([
  'requested',
  'approved',
  'ordered',
  'in_transit',
]);

export function isOpenProcurement(status: string | null | undefined): boolean {
  return OPEN_PROCUREMENT_STATUSES.has((status ?? '').toLowerCase());
}

export function isDeliveredProcurement(status: string | null | undefined): boolean {
  return (status ?? '').toLowerCase() === 'delivered';
}

export function isDelayedProcurement(status: string | null | undefined): boolean {
  return (status ?? '').toLowerCase() === 'delayed';
}

export function stockStateBadgeClass(state: StockState): string {
  switch (state) {
    case 'stockout':
      return 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
    case 'low':
      return 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
    default:
      return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
  }
}

export function stockStateLabel(state: StockState): string {
  switch (state) {
    case 'stockout':
      return 'Stockout';
    case 'low':
      return 'Low stock';
    default:
      return 'Healthy';
  }
}
