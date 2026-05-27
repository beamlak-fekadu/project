import type { SupabaseClient } from '@supabase/supabase-js';

export interface CopilotTelemetryDriftRow {
  created_at?: string | null;
  route?: string | null;
  intent?: string | null;
  capability?: string | null;
  confidence_score?: number | string | null;
  confidence_label?: string | null;
  blocked?: boolean | null;
  fallback_reason?: string | null;
  parsing_recovery_used?: boolean | null;
  role_names?: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface CopilotRouteDriftSummary {
  totalEvents: number;
  fallbackRate: number;
  parserRecoveryRate: number;
  blockedRate: number;
  unsafeBlockedRate: number;
  capabilityByRoute: Array<{ route: string; capability: string; count: number }>;
  lowConfidenceRoutes: Array<{ route: string; count: number }>;
  evidenceCompletenessByCapability: Array<{ capability: string; status: string; count: number; averageScore: number }>;
  rolePageBreakdown: Array<{ role_category: string; route: string; count: number }>;
  suspiciousBuckets: Array<{ bucket: string; count: number; examples: Array<{ route: string; intent: string; capability: string }> }>;
  repeatedLowConfidenceClusters: Array<{ route: string; intent: string; capability: string; count: number }>;
  recentTelemetry: Array<{
    created_at: string;
    route: string;
    intent: string;
    capability: string;
    confidence_label: string;
    blocked: boolean;
    fallback_reason: string | null;
    parsing_recovery_used: boolean;
    role_category: string | null;
  }>;
}

const KNOWN_CONTEXT_ROUTES = [/^\/equipment\b/, /^\/maintenance\/work-orders\b/, /^\/command\b/, /^\/reports\b/];
const SUMMARY_STATUS_INTENTS = new Set([
  'asset_summary',
  'inventory_search',
  'equipment_history',
  'work_order_status',
  'report_help',
  'dashboard_summary',
  'decision_support',
]);

function safeString(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 160) : fallback;
}

function routeOf(row: CopilotTelemetryDriftRow) {
  return safeString(row.route, 'unknown_route');
}

function intentOf(row: CopilotTelemetryDriftRow) {
  return safeString(row.intent, 'unknown_intent');
}

function capabilityOf(row: CopilotTelemetryDriftRow) {
  return safeString(row.capability, 'unknown_capability');
}

function roleCategoryOf(row: CopilotTelemetryDriftRow) {
  const responseDebug = row.metadata?.responseDebug;
  if (!responseDebug || typeof responseDebug !== 'object') return null;
  const roleCategory = (responseDebug as { roleCategory?: unknown }).roleCategory;
  return typeof roleCategory === 'string' ? roleCategory.slice(0, 80) : null;
}

function evidenceCompletenessOf(row: CopilotTelemetryDriftRow) {
  const responseDebug = row.metadata?.responseDebug;
  const debugCompleteness =
    responseDebug && typeof responseDebug === 'object'
      ? (responseDebug as { evidenceCompleteness?: unknown }).evidenceCompleteness
      : null;
  const directCompleteness = row.metadata?.evidenceCompleteness;
  const value = directCompleteness ?? debugCompleteness;
  if (!value || typeof value !== 'object') return { status: 'unknown', score: 0 };
  const status = safeString((value as { status?: unknown }).status, 'unknown');
  const scoreRaw = (value as { score?: unknown }).score;
  const score = typeof scoreRaw === 'number' ? scoreRaw : Number(scoreRaw ?? 0);
  return { status, score: Number.isFinite(score) ? score : 0 };
}

function unsafeCategoryOf(row: CopilotTelemetryDriftRow) {
  const tags = row.metadata?.policyTags ?? row.metadata?.responseDebug;
  if (Array.isArray(tags)) {
    const unsafe = tags.find((tag) => typeof tag === 'string' && tag.startsWith('unsafe:'));
    return typeof unsafe === 'string' ? unsafe : null;
  }
  const responseDebug = row.metadata?.responseDebug;
  if (responseDebug && typeof responseDebug === 'object') {
    const policyCategory = (responseDebug as { safetyPolicyCategory?: unknown }).safetyPolicyCategory;
    return typeof policyCategory === 'string' && policyCategory.includes('unsafe') ? policyCategory : null;
  }
  return null;
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topCounts(map: Map<string, number>, limit: number) {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function bucketFor(row: CopilotTelemetryDriftRow) {
  const route = routeOf(row);
  const intent = intentOf(row);
  const capability = capabilityOf(row);
  if (SUMMARY_STATUS_INTENTS.has(intent) && capability === 'safe_troubleshooting') return 'summary_or_status_to_troubleshooting';
  if ((intent === 'assistant_intro' || intent === 'general_conversation') && capability === 'maintenance_tips') return 'general_to_maintenance_tips';
  if (capability === 'general_system_fallback' && KNOWN_CONTEXT_ROUTES.some((pattern) => pattern.test(route))) return 'known_route_to_general_fallback';
  const responseDebug = row.metadata?.responseDebug;
  const debug = responseDebug && typeof responseDebug === 'object' ? responseDebug as Record<string, unknown> : {};
  const memoryConfidence = String(debug.memoryConfidence ?? row.metadata?.memoryConfidence ?? '');
  const evidenceCompleteness = evidenceCompletenessOf(row);
  if (/follow.?up/i.test(String(row.metadata?.answerType ?? '')) && capability === 'general_system_fallback') return 'ambiguous_followup_to_fallback';
  if (Array.isArray((debug.evidenceCompleteness as { conflictSignals?: unknown } | undefined)?.conflictSignals) && ((debug.evidenceCompleteness as { conflictSignals?: unknown[] }).conflictSignals ?? []).length > 0) return 'followup_entity_conflict';
  if (memoryConfidence === 'low') return 'memory_context_low_confidence';
  if (SUMMARY_STATUS_INTENTS.has(intent) && capability === 'safe_troubleshooting') return 'summary_followup_to_troubleshooting';
  if (evidenceCompleteness.status === 'insufficient' || evidenceCompleteness.status === 'denied') return `evidence_${evidenceCompleteness.status}`;
  if (row.confidence_label === 'low') return 'low_confidence';
  if (row.parsing_recovery_used === true) return 'parser_recovery';
  return null;
}

export function buildCopilotRouteDriftSummary(rows: CopilotTelemetryDriftRow[]): CopilotRouteDriftSummary {
  const totalEvents = rows.length;
  const routeCapabilityCounts = new Map<string, number>();
  const lowConfidenceCounts = new Map<string, number>();
  const bucketCounts = new Map<string, number>();
  const bucketExamples = new Map<string, Array<{ route: string; intent: string; capability: string }>>();
  const evidenceCompletenessCounts = new Map<string, { count: number; scoreSum: number }>();
  const rolePageCounts = new Map<string, number>();
  const lowConfidenceClusters = new Map<string, number>();

  for (const row of rows) {
    const route = routeOf(row);
    const capability = capabilityOf(row);
    const intent = intentOf(row);
    increment(routeCapabilityCounts, `${route}\u0000${capability}`);
    if (row.confidence_label === 'low') increment(lowConfidenceCounts, route);
    if (row.confidence_label === 'low') increment(lowConfidenceClusters, `${route}\u0000${intent}\u0000${capability}`);
    const roleCategory = roleCategoryOf(row) ?? 'unknown_role';
    increment(rolePageCounts, `${roleCategory}\u0000${route}`);
    const completeness = evidenceCompletenessOf(row);
    const completenessKey = `${capability}\u0000${completeness.status}`;
    const completenessBucket = evidenceCompletenessCounts.get(completenessKey) ?? { count: 0, scoreSum: 0 };
    completenessBucket.count += 1;
    completenessBucket.scoreSum += completeness.score;
    evidenceCompletenessCounts.set(completenessKey, completenessBucket);

    const bucket = bucketFor(row);
    if (bucket) {
      increment(bucketCounts, bucket);
      const examples = bucketExamples.get(bucket) ?? [];
      if (examples.length < 3) examples.push({ route, intent: intentOf(row), capability });
      bucketExamples.set(bucket, examples);
    }
  }

  return {
    totalEvents,
    fallbackRate: totalEvents ? rows.filter((row) => row.fallback_reason).length / totalEvents : 0,
    parserRecoveryRate: totalEvents ? rows.filter((row) => row.parsing_recovery_used === true).length / totalEvents : 0,
    blockedRate: totalEvents ? rows.filter((row) => row.blocked === true).length / totalEvents : 0,
    unsafeBlockedRate: totalEvents ? rows.filter((row) => row.blocked === true && unsafeCategoryOf(row)).length / totalEvents : 0,
    capabilityByRoute: topCounts(routeCapabilityCounts, 10).map(({ key, count }) => {
      const [route, capability] = key.split('\u0000');
      return { route, capability, count };
    }),
    lowConfidenceRoutes: topCounts(lowConfidenceCounts, 8).map(({ key, count }) => ({ route: key, count })),
    evidenceCompletenessByCapability: Array.from(evidenceCompletenessCounts.entries())
      .map(([key, value]) => {
        const [capability, status] = key.split('\u0000');
        return {
          capability,
          status,
          count: value.count,
          averageScore: value.count ? Math.round((value.scoreSum / value.count) * 100) / 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count || a.capability.localeCompare(b.capability))
      .slice(0, 12),
    rolePageBreakdown: topCounts(rolePageCounts, 12).map(({ key, count }) => {
      const [role_category, route] = key.split('\u0000');
      return { role_category, route, count };
    }),
    suspiciousBuckets: topCounts(bucketCounts, 8).map(({ key, count }) => ({
      bucket: key,
      count,
      examples: bucketExamples.get(key) ?? [],
    })),
    repeatedLowConfidenceClusters: topCounts(lowConfidenceClusters, 8).map(({ key, count }) => {
      const [route, intent, capability] = key.split('\u0000');
      return { route, intent, capability, count };
    }),
    recentTelemetry: rows.slice(0, 12).map((row) => ({
      created_at: safeString(row.created_at, ''),
      route: routeOf(row),
      intent: intentOf(row),
      capability: capabilityOf(row),
      confidence_label: safeString(row.confidence_label, 'unknown'),
      blocked: row.blocked === true,
      fallback_reason: typeof row.fallback_reason === 'string' ? row.fallback_reason.slice(0, 120) : null,
      parsing_recovery_used: row.parsing_recovery_used === true,
      role_category: roleCategoryOf(row),
    })),
  };
}

export async function getCopilotRouteDriftSummary(supabase: SupabaseClient): Promise<CopilotRouteDriftSummary> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('chat_telemetry_events')
    .select('created_at, route, intent, capability, confidence_score, confidence_label, blocked, fallback_reason, parsing_recovery_used, role_names, metadata')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) return buildCopilotRouteDriftSummary([]);
  return buildCopilotRouteDriftSummary((data ?? []) as CopilotTelemetryDriftRow[]);
}
