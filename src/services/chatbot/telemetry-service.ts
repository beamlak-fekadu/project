import type { SupabaseClient } from '@supabase/supabase-js';
import type { TelemetryEvent } from '@/types/chatbot';
import { createHash } from 'crypto';

function queryTelemetryMode() {
  const configured = (process.env.COPILOT_TELEMETRY_QUERY_MODE ?? '').toLowerCase();
  if (configured === 'raw' || configured === 'redacted' || configured === 'hash_only') return configured;
  return process.env.NODE_ENV === 'production' ? 'hash_only' : 'redacted';
}

function hashQuery(query: string) {
  return createHash('sha256').update(query.trim().toLowerCase()).digest('hex');
}

function redactQuery(query: string) {
  return query
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[uuid]')
    .replace(/\bWO[-\s]?[A-Z0-9]{3,}\b/gi, '[work_order]')
    .replace(/\b[A-Z]{1,4}-\d{3,6}\b/g, '[asset_code]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .slice(0, 180);
}

function intentFeatures(query: string) {
  return {
    length: query.length,
    hasWorkOrderToken: /\bWO[-\s]?[A-Z0-9]{3,}\b/i.test(query),
    hasAssetCodeToken: /\b[A-Z]{1,4}-\d{3,6}\b/.test(query),
    asksStatus: /\bstatus|summar|history|which|list\b/i.test(query),
    asksTroubleshooting: /\btroubleshoot|check first|not working|no power|alarm\b/i.test(query),
    asksUnsafe: /\bbypass|disable|hidden|service mode|firmware|calibration shortcut|ignore.*alarm\b/i.test(query),
  };
}

export function buildPrivacySafeTelemetryQuery(query: string) {
  const mode = queryTelemetryMode();
  const queryHash = hashQuery(query);
  const redactedPreview = redactQuery(query);
  return {
    mode,
    queryHash,
    redactedPreview,
    features: intentFeatures(query),
    storedQuery: mode === 'raw' ? query : mode === 'redacted' ? redactedPreview : `[sha256:${queryHash.slice(0, 16)}]`,
  };
}

export async function logCopilotTelemetry(
  supabase: SupabaseClient,
  event: TelemetryEvent
) {
  try {
    const privacy = buildPrivacySafeTelemetryQuery(event.query);
    await supabase
      .from('chat_telemetry_events')
      .insert({
        session_id: event.sessionId,
        query: privacy.storedQuery,
        intent: event.intent,
        capability: event.capability,
        confidence_score: event.confidenceScore,
        confidence_label: event.confidenceLabel,
        decision: event.decision,
        blocked: event.blocked,
        fallback_reason: event.fallbackReason ?? null,
        role_names: event.roleNames,
        module_label: event.moduleLabel ?? null,
        route: event.route ?? null,
        evidence_signals: event.evidenceSignals,
        grounded_by: event.groundedBy ?? null,
        parsing_recovery_used: event.parsingRecoveryUsed ?? false,
        classifier_candidates: event.classifierCandidates ?? null,
        resolved_entities: event.resolvedEntities ?? null,
        latency_ms: event.latencyMs ?? null,
        metadata: {
          ...(event.metadata ?? {}),
          queryPrivacy: {
            mode: privacy.mode,
            queryHash: privacy.queryHash,
            redactedPreview: privacy.mode === 'hash_only' ? undefined : privacy.redactedPreview,
            features: privacy.features,
          },
        },
      })
      .throwOnError();
  } catch {
    // Telemetry should never break user-facing request handling.
  }
}
