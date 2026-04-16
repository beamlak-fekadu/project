import type { CapabilityId, ChatIntent, ClassifiedRequest, ConfidenceLevel } from '@/types/chatbot';

const OUT_OF_SCOPE_PATTERNS = [
  /\bdiagnos(is|e)\b/i,
  /\btreatment\b/i,
  /\bprescrib(e|ing|ed)\b/i,
  /\bmedication\b/i,
  /\bdrug dose\b/i,
  /\bpatient (diagnosis|treatment|therapy|prescription)\b/i,
  /\bclinical diagnosis\b/i,
];

const UNSAFE_PATTERNS = [
  /\bbypass\b/i,
  /\boverride\b/i,
  /\bdisable safety\b/i,
  /\bhack\b/i,
  /\bservice mode\b/i,
  /\bboard[-\s]?level\b/i,
  /\bfirmware patch\b/i,
  /\boverride.*alarm\b/i,
  /\bdisable.*protection\b/i,
  /\brepair.*internal board\b/i,
  /\binternal board.*without documentation\b/i,
];

const TOO_DETAILED_PATTERNS = [
  /\bexact error code\b/i,
  /\bwhat does.*error code\b/i,
  /\bwhich board\b/i,
  /\bwhich .*board\b/i,
  /\bexact .*board\b/i,
  /\bcalibrate this model\b/i,
  /\benter service mode\b/i,
  /\bmanufacturer procedure\b/i,
  /\bexact service procedure\b/i,
  /\bcalibration sequence\b/i,
  /\bdiagnostic code\b/i,
  /\breplace component\b/i,
];

const SAFE_GENERAL_TROUBLESHOOTING_PATTERNS = [
  /\bsafe first[-\s]?line troubleshooting\b/i,
  /\bwhat should i check first\b/i,
  /\bbasic checks?\b/i,
  /\bbefore escalation\b/i,
  /\blikely causes?\b/i,
  /\bintermittent failure\b/i,
  /\bnot powering on\b/i,
  /\breduce repeat failures?\b/i,
];

const SPECIFIC_TECHNICAL_TROUBLESHOOTING_PATTERNS = [
  /\bexact\b/i,
  /\berror code\b/i,
  /\bboard\b/i,
  /\bservice mode\b/i,
  /\bcalibration sequence\b/i,
  /\bfirmware\b/i,
  /\bdiagnostic code\b/i,
  /\binternal board\b/i,
  /\breplace component\b/i,
  /\bthis model\b/i,
];

const INTENT_PATTERNS: Array<{ intent: ChatIntent; patterns: RegExp[] }> = [
  {
    intent: 'maintenance_tip',
    patterns: [/\bpm\b/i, /\bpreventive maintenance\b/i, /\bmaintenance tips?\b/i, /\bchecklist\b/i],
  },
  {
    intent: 'troubleshooting',
    patterns: [
      /\btroubleshoot/i,
      /\bfault\b/i,
      /\bnot working\b/i,
      /\bfailure\b/i,
      /\bfirst[-\s]?line checks?\b/i,
      /\bwhat should i check (next|first)\b/i,
      /\blikely causes?\b/i,
      /\bescalat(e|ion)\b/i,
    ],
  },
  {
    intent: 'work_order_help',
    patterns: [
      /\bwork order\b/i,
      /\bsummarize\b.*\b(work order|wo|maintenance event|technician notes?|closure notes?)\b/i,
      /\bdraft note\b/i,
      /\bmaintenance note\b/i,
      /\bclosure note\b/i,
      /\btechnician handoff\b/i,
      /\bnext step\b/i,
    ],
  },
  {
    intent: 'equipment_lookup',
    patterns: [/\bequipment status\b/i, /\basset\b/i, /\bdevice status\b/i],
  },
  {
    intent: 'analytics_explanation',
    patterns: [
      /\bmttr\b/i,
      /\bmtbf\b/i,
      /\bavailability\b/i,
      /\brisk\b/i,
      /\brpn\b/i,
      /\breplacement priority\b/i,
      /\bpm compliance\b/i,
      /\bpriority score\b/i,
      /\bwhy is .* high risk\b/i,
      /\boverdue pm\b/i,
      /\bdecision support\b/i,
    ],
  },
  {
    intent: 'calibration_or_logistics',
    patterns: [/\bcalibration\b/i, /\blogistics\b/i, /\bspare parts?\b/i, /\bstock\b/i, /\bprocurement\b/i],
  },
];

const CAPABILITY_KEYWORDS: Array<{ capability: CapabilityId; patterns: RegExp[]; baseScore: number }> = [
  {
    capability: 'my_tasks',
    patterns: [/\bmy tasks?\b/i, /\bto-?do\b/i, /\bwhat.*pending\b/i, /\bassigned to me\b/i],
    baseScore: 0.72,
  },
  {
    capability: 'prioritize_tasks',
    patterns: [/\bprioriti[sz]e\b/i, /\bwhat should i do first\b/i, /\bmost urgent\b/i, /\btop priorities?\b/i],
    baseScore: 0.74,
  },
  {
    capability: 'summarize_work_order',
    patterns: [/\bsummari[sz]e\b.*\bwork order\b/i, /\bwo[-\s]?\d+\b/i, /\bclosure notes?\b/i],
    baseScore: 0.75,
  },
  {
    capability: 'explain_equipment_risk',
    patterns: [/\bhigh risk\b/i, /\brpn\b/i, /\bmtbf\b/i, /\bmttr\b/i, /\bwhy is .* risk\b/i],
    baseScore: 0.78,
  },
  {
    capability: 'explain_pm_status',
    patterns: [/\boverdue pm\b/i, /\bpm status\b/i, /\bpm compliance\b/i, /\bpreventive maintenance status\b/i],
    baseScore: 0.74,
  },
  {
    capability: 'safe_troubleshooting',
    patterns: [/\btroubleshoot/i, /\bcheck first\b/i, /\bintermittent\b/i, /\bfailure\b/i],
    baseScore: 0.7,
  },
  {
    capability: 'maintenance_guidance',
    patterns: [/\bmaintenance guidance\b/i, /\bmaintenance tips?\b/i, /\bpreventive\b/i],
    baseScore: 0.68,
  },
  {
    capability: 'logistics_status',
    patterns: [/\blogistics\b/i, /\blow stock\b/i, /\bspare parts?\b/i, /\bprocurement\b/i, /\binventory\b/i],
    baseScore: 0.76,
  },
  {
    capability: 'approval_tasks',
    patterns: [/\bapprovals?\b/i, /\bpending approvals?\b/i, /\bawaiting approval\b/i],
    baseScore: 0.74,
  },
  {
    capability: 'alerts_and_escalations',
    patterns: [/\balerts?\b/i, /\bescalat(e|ion)\b/i, /\bcritical flags?\b/i],
    baseScore: 0.73,
  },
  {
    capability: 'decision_support_analysis',
    patterns: [/\bdecision support\b/i, /\btriage\b/i, /\breadiness\b/i, /\bworkload\b/i],
    baseScore: 0.8,
  },
];

const INTENT_TO_CAPABILITY: Record<ChatIntent, CapabilityId> = {
  maintenance_tip: 'maintenance_guidance',
  troubleshooting: 'safe_troubleshooting',
  work_order_help: 'summarize_work_order',
  equipment_lookup: 'maintenance_guidance',
  analytics_explanation: 'decision_support_analysis',
  calibration_or_logistics: 'logistics_status',
  too_detailed: 'safe_troubleshooting',
  unsafe: 'safe_troubleshooting',
  out_of_scope: 'general_fallback',
};

function toConfidenceLabel(score: number): ConfidenceLevel {
  if (score >= 0.82) return 'high';
  if (score >= 0.62) return 'medium';
  return 'low';
}

export function classifyChatRequest(message: string): ClassifiedRequest {
  const reasons: string[] = [];
  const matchedSignals: string[] = [];
  const normalized = message.trim();

  const capabilityCandidates = CAPABILITY_KEYWORDS.map((candidate) => {
    const matchCount = candidate.patterns.filter((pattern) => pattern.test(normalized)).length;
    const confidence = Math.min(0.96, candidate.baseScore + matchCount * 0.07);
    return {
      capability: candidate.capability,
      confidence: matchCount > 0 ? confidence : 0,
      reasons: matchCount > 0 ? [`Matched ${matchCount} keyword signal(s).`] : [],
    };
  }).filter((candidate) => candidate.confidence > 0);

  const sortedCandidates = capabilityCandidates.sort((a, b) => b.confidence - a.confidence);
  const topCandidate = sortedCandidates[0];
  const secondCandidate = sortedCandidates[1];
  const ambiguous = Boolean(topCandidate && secondCandidate && topCandidate.confidence - secondCandidate.confidence < 0.08);

  const buildResult = (intent: ChatIntent, details: Partial<ClassifiedRequest>): ClassifiedRequest => {
    const fallbackCapability = details.capability ?? INTENT_TO_CAPABILITY[intent] ?? 'general_fallback';
    const confidence = details.confidence ?? topCandidate?.confidence ?? 0.45;
    const confidenceLabel = details.confidenceLabel ?? toConfidenceLabel(confidence);
    const candidates =
      details.candidates ??
      (sortedCandidates.length
        ? sortedCandidates
        : [{ capability: fallbackCapability, confidence, reasons: ['No strong lexical match; intent fallback applied.'] }]);

    const fallbackReason =
      details.fallbackReason ??
      (confidenceLabel === 'low' || ambiguous ? 'low_confidence_match' : undefined);

    return {
      intent,
      capability: confidenceLabel === 'low' ? 'general_fallback' : fallbackCapability,
      reasons,
      troubleshootingSubtype: details.troubleshootingSubtype ?? 'none',
      specificity: details.specificity ?? 'general',
      matchedSignals: details.matchedSignals ?? matchedSignals,
      confidence,
      confidenceLabel,
      ambiguous,
      fallbackReason,
      candidates,
    };
  };

  if (OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    reasons.push('Detected patient-care or diagnosis language.');
    matchedSignals.push('out_of_scope_pattern');
    return buildResult('out_of_scope', {
      capability: 'general_fallback',
      confidence: 0.98,
      confidenceLabel: 'high',
      specificity: 'unsafe',
      fallbackReason: 'out_of_scope',
    });
  }

  if (UNSAFE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    reasons.push('Detected unsafe internal repair or bypass language.');
    matchedSignals.push('unsafe_pattern');
    return buildResult('unsafe', {
      capability: 'safe_troubleshooting',
      confidence: 0.97,
      confidenceLabel: 'high',
      troubleshootingSubtype: 'unsafe_internal_or_bypass_troubleshooting',
      specificity: 'unsafe',
      fallbackReason: 'unsafe_query',
    });
  }

  if (TOO_DETAILED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    reasons.push('Detected request for unsupported model-specific technical detail.');
    matchedSignals.push('too_detailed_pattern');
    return buildResult('too_detailed', {
      capability: 'safe_troubleshooting',
      confidence: 0.9,
      confidenceLabel: 'high',
      troubleshootingSubtype: 'specific_technical_troubleshooting',
      specificity: 'specific',
    });
  }

  for (const intentPattern of INTENT_PATTERNS) {
    if (intentPattern.patterns.some((pattern) => pattern.test(normalized))) {
      reasons.push(`Matched heuristic for ${intentPattern.intent}.`);

      if (intentPattern.intent === 'troubleshooting') {
        const specificTechnical = SPECIFIC_TECHNICAL_TROUBLESHOOTING_PATTERNS.some((pattern) => pattern.test(normalized));
        const safeGeneral = SAFE_GENERAL_TROUBLESHOOTING_PATTERNS.some((pattern) => pattern.test(normalized));
        if (specificTechnical) {
          matchedSignals.push('specific_technical_troubleshooting');
          return buildResult(intentPattern.intent, {
            capability: topCandidate?.capability ?? 'safe_troubleshooting',
            troubleshootingSubtype: 'specific_technical_troubleshooting',
            specificity: 'specific',
          });
        }

        if (safeGeneral) {
          matchedSignals.push('safe_general_troubleshooting');
          return buildResult(intentPattern.intent, {
            capability: topCandidate?.capability ?? 'safe_troubleshooting',
            troubleshootingSubtype: 'safe_general_troubleshooting',
            specificity: 'general',
          });
        }

        matchedSignals.push('generic_troubleshooting');
        return buildResult(intentPattern.intent, {
          capability: topCandidate?.capability ?? 'safe_troubleshooting',
          troubleshootingSubtype: 'safe_general_troubleshooting',
          specificity: 'general',
        });
      }

      return buildResult(intentPattern.intent, {
        capability: topCandidate?.capability ?? INTENT_TO_CAPABILITY[intentPattern.intent] ?? 'general_fallback',
        specificity: 'general',
      });
    }
  }

  reasons.push('Defaulted to maintenance_tip for operational guidance.');
  matchedSignals.push('default_maintenance_tip');
  return buildResult('maintenance_tip', {
    capability: 'general_fallback',
    confidence: Math.max(0.38, topCandidate?.confidence ?? 0.4),
    confidenceLabel: 'low',
    specificity: 'general',
    fallbackReason: 'no_capability_match',
  });
}
