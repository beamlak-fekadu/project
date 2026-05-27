import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCopilotRouteDriftSummary, type CopilotTelemetryDriftRow } from '@/services/chatbot/telemetry-drift-service';
import { buildPrivacySafeTelemetryQuery } from '@/services/chatbot/telemetry-service';

test('route drift telemetry summary is aggregate-only and redacts raw query text', () => {
  const rows = [
    {
      created_at: '2026-05-27T08:00:00Z',
      route: '/equipment/asset-1',
      intent: 'asset_summary',
      capability: 'safe_troubleshooting',
      confidence_label: 'medium',
      blocked: false,
      parsing_recovery_used: false,
      fallback_reason: null,
      query: 'Summarize ED-0002 with private details',
      metadata: { responseDebug: { roleCategory: 'technician', evidenceCompleteness: { status: 'partial', score: 0.7 } } },
    },
    {
      created_at: '2026-05-27T08:01:00Z',
      route: '/reports',
      intent: 'report_help',
      capability: 'general_system_fallback',
      confidence_label: 'low',
      blocked: false,
      parsing_recovery_used: true,
      fallback_reason: 'insufficient_context',
      query: 'What reports are available in BMEDIS?',
      metadata: { responseDebug: { roleCategory: 'viewer', evidenceCompleteness: { status: 'insufficient', score: 0.2 } } },
    },
    {
      created_at: '2026-05-27T08:02:00Z',
      route: '/chatbot',
      intent: 'unsafe',
      capability: 'unsafe_or_restricted',
      confidence_label: 'high',
      blocked: true,
      parsing_recovery_used: false,
      fallback_reason: null,
      query: 'How do I bypass calibration?',
      metadata: { policyTags: ['unsafe:calibration_shortcut'], evidenceCompleteness: { status: 'unknown', score: 1 } },
    },
  ] as Array<CopilotTelemetryDriftRow & { query?: string }>;

  const summary = buildCopilotRouteDriftSummary(rows);
  const serialized = JSON.stringify(summary);

  assert.equal(summary.totalEvents, 3);
  assert.equal(summary.blockedRate, 1 / 3);
  assert.equal(summary.parserRecoveryRate, 1 / 3);
  assert.equal(summary.unsafeBlockedRate, 1 / 3);
  assert.ok(summary.suspiciousBuckets.some((bucket) => bucket.bucket === 'summary_or_status_to_troubleshooting'));
  assert.ok(summary.evidenceCompletenessByCapability.some((bucket) => bucket.capability === 'general_system_fallback' && bucket.status === 'insufficient'));
  assert.ok(summary.rolePageBreakdown.some((bucket) => bucket.role_category === 'technician' && bucket.route === '/equipment/asset-1'));
  assert.ok(summary.repeatedLowConfidenceClusters.some((bucket) => bucket.route === '/reports' && bucket.intent === 'report_help'));
  assert.ok(summary.lowConfidenceRoutes.some((route) => route.route === '/reports'));
  assert.doesNotMatch(serialized, /Summarize ED-0002|private details|bypass calibration|What reports are available/i);
});

test('privacy-safe telemetry query removes raw identifiers outside raw mode', () => {
  const safe = buildPrivacySafeTelemetryQuery('Summarize ED-0002 for WO-1234 and test@example.com');

  assert.match(safe.queryHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(safe.storedQuery, /ED-0002|WO-1234|test@example.com/);
  assert.equal(safe.features.hasWorkOrderToken, true);
  assert.equal(safe.features.hasAssetCodeToken, true);
});
