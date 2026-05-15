// Store-User read-only / store-safe link helpers.
//
// All non-store mutation flows route through these helpers so Store User
// pages never accidentally surface a Create Work Order / Approve / Assign
// path. Reorder/receive/issue links carry source=store-console so the target
// page can prefill correctly.

export function storePartDetail(partId: string): string {
  return `/spare-parts?partId=${encodeURIComponent(partId)}&source=store-console`;
}

export function storeProcurementDetail(procurementId: string): string {
  return `/command/drilldown/procurement/${procurementId}`;
}

export function storeWorkOrderEvidence(workOrderId: string): string {
  return `/maintenance/work-orders/${workOrderId}`;
}

export function storeEquipmentDetail(assetId: string): string {
  return `/equipment/${assetId}`;
}

export function storeReceiveLink(procurementId?: string | null): string {
  const params = new URLSearchParams({ source: 'store-console' });
  if (procurementId) params.set('procurementId', procurementId);
  return `/logistics?workflow=receiving&${params.toString()}`;
}

export function storeIssueLink(partId?: string | null): string {
  const params = new URLSearchParams({ source: 'store-console' });
  if (partId) params.set('partId', partId);
  return `/logistics?workflow=issue&${params.toString()}`;
}

export function storeBinCardLink(partId?: string | null): string {
  const params = new URLSearchParams({ source: 'store-console' });
  if (partId) params.set('partId', partId);
  return `/logistics?workflow=bin-card&${params.toString()}`;
}

// Reorder request prefill — Store User's primary mutation. Carries enough
// context for the procurement-request creation flow to populate item, reason,
// linked part, and desired quantity from canonical stock data.
export function storeCreateReorderLink(part: { id: string; name?: string | null; part_code?: string | null; reorder_level?: number | null; current_stock?: number | null }): string {
  const reorderLevel = Number(part.reorder_level ?? 0);
  const current = Number(part.current_stock ?? 0);
  const desired = Math.max(reorderLevel - current, reorderLevel, 1);
  const itemName = part.part_code && part.name ? `${part.part_code} ${part.name}` : part.name ?? part.part_code ?? 'spare part';
  const reason = current <= 0
    ? `Stockout for ${itemName}. Reorder to restore stock to reorder_level.`
    : `Low stock for ${itemName}. Current ${current} ≤ reorder ${reorderLevel}.`;
  const params = new URLSearchParams({
    source: 'store-console',
    partId: part.id,
    itemName,
    quantity: String(desired),
    reason,
  });
  return `/procurement/requests/new?${params.toString()}`;
}

export function storeReport(reportType: string): string {
  return `/reports/${reportType}`;
}
