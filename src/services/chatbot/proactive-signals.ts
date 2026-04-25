import type { CapabilityId } from '@/types/chatbot';

const PROACTIVE_CAPABILITIES = new Set<CapabilityId>([
  'prioritize_tasks',
  'summarize_alerts',
  'summarize_department_readiness',
]);

export function buildProactiveSignals(params: {
  capability: CapabilityId;
  shared: Record<string, unknown>;
  riskAnalytics: Record<string, unknown>;
}): string[] {
  if (!PROACTIVE_CAPABILITIES.has(params.capability)) return [];

  const out: string[] = [];
  const overduePm = (params.shared.overduePm as Record<string, unknown>[]) ?? [];
  const severePm = overduePm.filter((row) => Number(row.days_overdue ?? 0) >= 14);
  if (severePm.length > 0) {
    out.push(`${severePm.length} preventive maintenance plan(s) are overdue by 14+ days—review scheduling and staffing.`);
  }

  const flags = (params.riskAnalytics.recommendationFlags as Record<string, unknown>[]) ?? [];
  const criticalOpen = flags.filter((row) => ['high', 'critical'].includes(String(row.severity ?? '')));
  if (criticalOpen.length > 0) {
    out.push(`${criticalOpen.length} high/critical recommendation flags remain unacknowledged.`);
  }

  const countsByAsset = new Map<string, number>();
  for (const row of flags) {
    const assetId = typeof row.asset_id === 'string' ? row.asset_id : '';
    if (!assetId) continue;
    countsByAsset.set(assetId, (countsByAsset.get(assetId) ?? 0) + 1);
  }
  for (const [assetId, count] of countsByAsset) {
    if (count >= 2) {
      out.push(`Asset ${assetId.slice(0, 8)}… has ${count} concurrent flags—consider coordinated triage.`);
    }
    if (out.length >= 5) break;
  }

  const workOrders = (params.shared.assignedWorkOrders as Record<string, unknown>[]) ?? [];
  const blocked = workOrders.filter((wo) => String(wo.status ?? '') === 'on_hold');
  if (blocked.length > 0) {
    out.push(`${blocked.length} work order(s) are on hold—confirm whether holds are blocking downstream maintenance.`);
  }

  return out.slice(0, 6);
}

export function buildCrossModuleSnapshot(params: {
  workOrders: Record<string, unknown>[];
  flags: Record<string, unknown>[];
  lowStockParts: Record<string, unknown>[];
  procurementPipeline: Record<string, unknown>[];
}) {
  const assetIds = new Set(
    params.workOrders.map((wo) => (typeof wo.asset_id === 'string' ? wo.asset_id : '')).filter(Boolean)
  );
  const flagsForBusyAssets = params.flags.filter((f) => assetIds.has(typeof f.asset_id === 'string' ? f.asset_id : ''));
  return {
    openWorkOrderAssetCount: assetIds.size,
    flagsLinkedToOpenWorkOrderAssets: flagsForBusyAssets.slice(0, 8),
    lowStockCount: params.lowStockParts.length,
    procurementInFlight: params.procurementPipeline.filter((row) =>
      ['requested', 'under_review', 'ordered'].includes(String(row.status ?? ''))
    ).length,
  };
}

export function buildAlertSynthesis(flags: Record<string, unknown>[]) {
  const countsBySeverity: Record<string, number> = {};
  for (const row of flags) {
    const sev = String(row.severity ?? 'unknown');
    countsBySeverity[sev] = (countsBySeverity[sev] ?? 0) + 1;
  }
  return {
    countsBySeverity,
    recent: flags.slice(0, 10),
  };
}
