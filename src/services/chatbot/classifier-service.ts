import type {
  CapabilityId,
  ChatIntent,
  ClassifiedRequest,
  ConfidenceLevel,
  MemoryRoutingHint,
} from '@/types/chatbot';

const OUT_OF_SCOPE_PATTERNS = [
  /\bdiagnos(is|e)\b/i,
  /\btreatment\b/i,
  /\bprescrib(e|ing|ed)\b/i,
  /\bmedication\b/i,
  /\bdrug dose\b/i,
  /\bpatient (diagnosis|treatment|therapy|prescription)\b/i,
  /\bclinical diagnosis\b/i,
];

const GENERAL_CONVERSATION_PATTERNS = [
  /\btell me a joke\b/i,
  /\blove life\b/i,
  /\bwrite (an|a) (email|message)\b/i,
  /\bmotivate me\b/i,
  /\borganize my day\b/i,
  /\bexplain (stress|anxiety|confidence)\b/i,
  /\bgeneral advice\b/i,
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
  /\bwhich (main|mother|circuit|control|logic) board\b/i,
  /\bwhich .* (main|mother) board\b/i,
  /\bexact .* (main|mother|logic) board\b/i,
  /\bcalibrate this model\b/i,
  /\benter service mode\b/i,
  /\bmanufacturer procedure\b/i,
  /\bexact service procedure\b/i,
  /\bcalibration sequence\b/i,
  /\bdiagnostic code\b/i,
  /\breplace component\b/i,
  /\breplace the main board\b/i,
];

const SAFE_GENERAL_TROUBLESHOOTING_PATTERNS = [
  /\bsafe first[-\s]?line troubleshooting\b/i,
  /\bwhat should i check first\b/i,
  /\bbasic checks?\b/i,
  /\bbefore escalation\b/i,
  /\blikely causes?\b/i,
  /\bintermittent failure\b/i,
  /\bnot powering on\b/i,
  /\bnot powering\b/i,
  /\bwon'?t power\b/i,
  /\bno power\b/i,
  /\bimage quality\b/i,
  /\b(fuzzy|artifact|artefact|noise|resolution|noisy|blurry|black screen|blank screen)\b/i,
  /\breduce repeat failures?\b/i,
];

const SPECIFIC_TECHNICAL_TROUBLESHOOTING_PATTERNS = [
  /\bexact\b.*\b(error|code|calibration|procedure)\b/i,
  /\b(error|fault)\s*code\b/i,
  /\bE\d{3,4}\b/i,
  /\b(mother|main|circuit|control|logic)\s*board\s+(replacement|swap|solder|trace)\b/i,
  /\bservice mode\b/i,
  /\bcalibration sequence\b/i,
  /\bflash(ing)?\s+firmware|firmware (flash|update|downgrade|patch)\b/i,
  /\bdiagnostic code\b/i,
  /\binternal (board|repair|pcb)\b/i,
  /\breplace (the|a)\s*(main|mother|logic|power)\s*board\b/i,
  /\bthis model\'?s?\s+exact (calibration|alignment|tuning)\b/i,
  /\bwhich board\b.*\b(replace|swap)\b/i,
];

const INTENT_PATTERNS: Array<{ intent: ChatIntent; patterns: RegExp[] }> = [
  {
    intent: 'general_conversation',
    patterns: [/^thanks?$/i, /^thank you$/i, /^ok(ay)?$/i, /^cool$/i, /^great$/i, /\bhow are you\b/i],
  },
  {
    intent: 'off_topic_safe',
    patterns: GENERAL_CONVERSATION_PATTERNS,
  },
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
      /\bultrasound\b/i,
      /\bpatient monitor\b/i,
      /\bmonitor (issue|problem|fault|not powering|won't|wont|no power|powering)\b/i,
      /\bnot powering|won'?t power|no power|black screen|blank screen|image quality|artifact|artefact\b/i,
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
    capability: 'summarize_equipment',
    patterns: [/\bsummari[sz]e\b.*\b(equipment|asset|device)\b/i, /\bstatus of this (asset|device|equipment)\b/i],
    baseScore: 0.74,
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
    capability: 'maintenance_tips',
    patterns: [/\bpm tips?\b/i, /\bmaintenance tips?\b/i, /\bpreventive maintenance tips?\b/i],
    baseScore: 0.72,
  },
  {
    capability: 'logistics_status',
    patterns: [/\blogistics\b/i, /\blow stock\b/i, /\bspare parts?\b/i, /\bprocurement\b/i, /\binventory\b/i],
    baseScore: 0.76,
  },
  {
    capability: 'procurement_status',
    patterns: [/\bprocurement\b/i, /\bpipeline\b/i, /\bexpected delivery\b/i, /\bpurchase request\b/i],
    baseScore: 0.75,
  },
  {
    capability: 'summarize_alerts',
    patterns: [/\balerts?\b/i, /\bescalat(e|ion)\b/i, /\bcritical flags?\b/i, /\bwhat alerts need attention\b/i],
    baseScore: 0.75,
  },
  {
    capability: 'general_conversation',
    patterns: [/^thanks?$/i, /^thank you$/i, /^ok(ay)?$/i, /^cool$/i, /^great$/i],
    baseScore: 0.72,
  },
  {
    capability: 'off_topic_safe',
    patterns: GENERAL_CONVERSATION_PATTERNS,
    baseScore: 0.82,
  },
  {
    capability: 'summarize_department_readiness',
    patterns: [/\bdepartment readiness\b/i, /\breadiness snapshot\b/i, /\bclinical readiness\b/i, /\bdepartment operational readiness\b/i],
    baseScore: 0.78,
  },
  {
    capability: 'training_status',
    patterns: [/\btraining status\b/i, /\bstaff training\b/i, /\btraining requests?\b/i, /\btraining sessions?\b/i, /\bequipment training\b/i],
    baseScore: 0.76,
  },
  {
    capability: 'disposal_status',
    patterns: [/\bdisposal status\b/i, /\bdisposal requests?\b/i, /\basset disposal\b/i, /\bend of life\b/i],
    baseScore: 0.76,
  },
];

const ASSISTANT_INTRO_PATTERNS = [
  /^(hi|hello|hey|howdy|greetings|good (morning|afternoon|evening))\b[\s!.,?-]*$/i,
  /^(hi|hello|hey|howdy)\b[\s!.,-]*\b(there|you|all)\b[\s!.,?-]*$/i,
  /^\bhelp\b[\s!.,?-]*$/i,
  /\b(what|how) (can|do) you (help|do)(\s+me)?(\s+with|\s+about)?\?*\s*$/i,
  /\bwhat (are )?you(r)?\s+capab(ilit(ies|y)|lities)/i,
  /^(get started|start here|start guide|overview|introduction)\b/i,
  /\b(what|which) (can|could) you (help|do)( me| us)?\b/i,
  /\bwhat (are|is) (you|this|the) (able|for) to (help|do)\b/i,
  /\bwhat can you help me (with|about)\b/i,
];

const FOLLOW_UP_PRIORITIZE = /\bwhy\b.*\b(high priority|highest|urgent|top of|ranked|critical)\b/i;
const FOLLOW_UP_NEXT = /\bwhat should i (do|tackle) next\b/i;
const TASK_LIST = /\bturn (that|this|it) into a (task|to-?do|todo) list\b/i;
const HOW_TASK_LIST = /\bhow (do i|to) (turn|make|build)\b.*\b(list|plan)\b/i;

const INTENT_TO_CAPABILITY: Record<ChatIntent, CapabilityId> = {
  assistant_intro: 'assistant_intro',
  general_conversation: 'general_conversation',
  off_topic_safe: 'off_topic_safe',
  maintenance_tip: 'maintenance_tips',
  troubleshooting: 'safe_troubleshooting',
  work_order_help: 'summarize_work_order',
  equipment_lookup: 'summarize_equipment',
  analytics_explanation: 'summarize_department_readiness',
  calibration_or_logistics: 'logistics_status',
  too_detailed: 'unsafe_or_restricted',
  unsafe: 'unsafe_or_restricted',
  out_of_scope: 'unsafe_or_restricted',
};

function toConfidenceLabel(score: number): ConfidenceLevel {
  if (score >= 0.82) return 'high';
  if (score >= 0.62) return 'medium';
  return 'low';
}

function isShortFollowUp(message: string) {
  return message.trim().length < 72 && message.trim().split(/\s+/).length <= 10;
}

export function classifyChatRequest(message: string, hint?: MemoryRoutingHint): ClassifiedRequest {
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
    const fallbackCapability = details.capability ?? INTENT_TO_CAPABILITY[intent] ?? 'general_system_fallback';
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
      capability: fallbackCapability,
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
      capability: 'unsafe_or_restricted',
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
      capability: 'unsafe_or_restricted',
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
      capability: 'unsafe_or_restricted',
      confidence: 0.9,
      confidenceLabel: 'high',
      troubleshootingSubtype: 'specific_technical_troubleshooting',
      specificity: 'specific',
    });
  }

  if (ASSISTANT_INTRO_PATTERNS.some((pattern) => pattern.test(normalized))) {
    reasons.push('Matched BMERMS assistant intro / help intent.');
    matchedSignals.push('assistant_intro');
    return buildResult('assistant_intro', {
      capability: 'assistant_intro',
      confidence: 0.95,
      confidenceLabel: 'high',
      fallbackReason: undefined,
      candidates: [{ capability: 'assistant_intro', confidence: 0.95, reasons: ['BMERMS assistant intro heuristics.'] }],
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
          capability: topCandidate?.capability ?? INTENT_TO_CAPABILITY[intentPattern.intent] ?? 'general_system_fallback',
        specificity: 'general',
      });
    }
  }

  if (FOLLOW_UP_PRIORITIZE.test(normalized) && (hint?.activeCapability || isShortFollowUp(normalized))) {
    reasons.push('Follow-up: priority explanation; bias to prioritize_tasks.');
    matchedSignals.push('follow_up_priority');
    return buildResult('analytics_explanation', {
      capability: 'prioritize_tasks',
      confidence: 0.84,
      confidenceLabel: 'high',
      fallbackReason: undefined,
    });
  }

  if (FOLLOW_UP_NEXT.test(normalized) && (hint?.activeCapability || isShortFollowUp(normalized))) {
    reasons.push('Follow-up: next steps; bias to prioritize_tasks.');
    matchedSignals.push('follow_up_next');
    return buildResult('maintenance_tip', {
      capability: 'prioritize_tasks',
      confidence: 0.82,
      confidenceLabel: 'high',
    });
  }

  if (TASK_LIST.test(normalized) || HOW_TASK_LIST.test(normalized)) {
    reasons.push('User asked to structure actions as a task list; bias to prioritize_tasks.');
    matchedSignals.push('task_list_synthesis');
    return buildResult('work_order_help', {
      capability: 'prioritize_tasks',
      confidence: 0.8,
      confidenceLabel: 'high',
    });
  }

  reasons.push('Defaulted to maintenance_tip for operational guidance.');
  matchedSignals.push('default_maintenance_tip');

  if (hint?.activeCapability && isShortFollowUp(normalized) && ambiguous) {
    matchedSignals.push('memory_capability_bias');
    return buildResult(hint.threadIntent ?? 'maintenance_tip', {
      capability: hint.activeCapability,
      confidence: Math.max(0.55, topCandidate?.confidence ?? 0.52),
      confidenceLabel: 'medium',
      specificity: 'general',
      fallbackReason: 'low_confidence_match',
    });
  }

  const defaultConfidence = Math.max(0.38, topCandidate?.confidence ?? 0.4);
  const defaultCapability = topCandidate?.capability ?? 'general_system_fallback';
  const defaultLabel = toConfidenceLabel(defaultConfidence);

  return buildResult('maintenance_tip', {
    capability: defaultCapability,
    confidence: defaultConfidence,
    confidenceLabel: defaultLabel,
    specificity: 'general',
    fallbackReason:
      defaultCapability === 'general_system_fallback'
        ? 'no_capability_match'
        : ambiguous || defaultLabel === 'low'
          ? 'low_confidence_match'
          : undefined,
  });
}

export function buildRoutingExplanation(classified: ClassifiedRequest): string[] {
  const lines = [
    `Selected capability: ${classified.capability}`,
    `Matcher confidence: ${classified.confidenceLabel} (${classified.confidence.toFixed(2)})`,
  ];
  if (classified.ambiguous) lines.push('Multiple capabilities scored closely; the top match still drives retrieval.');
  if (classified.fallbackReason) lines.push(`Routing flag: ${classified.fallbackReason}`);
  if (classified.troubleshootingSubtype && classified.troubleshootingSubtype !== 'none') {
    lines.push(`Troubleshooting subtype: ${classified.troubleshootingSubtype}`);
  }
  const top = classified.candidates.slice(0, 4).map((c) => `${c.capability}:${c.confidence.toFixed(2)}`);
  if (top.length) lines.push(`Top candidates: ${top.join(', ')}`);
  return lines;
}
