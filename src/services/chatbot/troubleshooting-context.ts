import type { ChatEvidence } from '@/types/chatbot';

export interface Tier1TroubleshootingBundle {
  checklist: string[];
  hypothesis_buckets: string[];
  evidence_used: string[];
}

export function buildTier1TroubleshootingBundle(
  evidence: ChatEvidence,
  extras?: { openWorkOrderOnAsset?: boolean; userMessage?: string }
): Tier1TroubleshootingBundle {
  const evidence_used: string[] = [];
  const checklist: string[] = [
    'Verify primary power: outlet live, breaker/fuse, equipment power switch, and any UPS or isolation transformer indicators.',
    'Inspect cables and connectors for damage, bent pins, and full seating (including network/USB where applicable).',
    'Confirm accessories and consumables (probes, sensors, media, batteries, electrodes) are correct for the asset and within service life.',
    'Review recent user-reported symptoms against normal startup/self-test behavior for this asset class.',
  ];

  const eq = evidence.equipment as Record<string, unknown> | null;
  if (eq) {
    const code = typeof eq.asset_code === 'string' ? eq.asset_code : '';
    const name = typeof eq.name === 'string' ? eq.name : '';
    checklist.push(`Cross-check CMMS record (${[code, name].filter(Boolean).join(' — ') || 'asset'}) for condition, status, and location notes.`);
    evidence_used.push('equipment');
  }

  if (evidence.maintenanceHistory.length > 0) {
    checklist.push('Scan recent maintenance_events for repeat failures, recurring symptoms, or incomplete closures.');
    evidence_used.push('maintenanceHistory');
  }

  if (evidence.pmSnapshot) {
    checklist.push('Check PM compliance snapshot: overdue or slipping PM can correlate with drift, alarms, or intermittent faults.');
    evidence_used.push('pmSnapshot');
  }

  if (evidence.calibrationStatus) {
    checklist.push('Confirm calibration status (last result, next due): expired or marginal calibration can affect quantitative outputs.');
    evidence_used.push('calibrationStatus');
  }

  if (evidence.manualOrSopTexts.length > 0) {
    checklist.push('Use only manufacturer-approved snippets already in context; do not invent undocumented service steps.');
    evidence_used.push('manualOrSopTexts');
  }

  if (extras?.openWorkOrderOnAsset) {
    checklist.push('Align with the open work order owner before duplicating on-site checks or parts swaps.');
    evidence_used.push('openWorkOrder');
  }

  checklist.push(
    'After checks, classify the issue bucket when possible: user/setup, accessory/consumable, environment (power/interference/temperature), or likely device fault—then escalate internal device work per local policy.'
  );

  const msg = (extras?.userMessage ?? '').toLowerCase();
  if (/\bpatient monitor|central station|ecg\b/i.test(msg)) {
    checklist.splice(
      1,
      0,
      'For monitors: confirm lead/SpO2/pressure interfaces, lead-off indicators, and whether the issue is on one bedside vs central display.'
    );
    evidence_used.push('user_message:monitor');
  } else if (/\bultrasound|transducer|probe|doppler\b/i.test(msg)) {
    checklist.splice(1, 0, 'For ultrasound: verify probe type/preset, coupling/gel, cable strain relief, and compare image on secondary display (if any) to isolate path.');
    evidence_used.push('user_message:ultrasound');
  }

  return {
    checklist,
    hypothesis_buckets: ['user_side', 'accessory', 'environment', 'device_side'],
    evidence_used,
  };
}
