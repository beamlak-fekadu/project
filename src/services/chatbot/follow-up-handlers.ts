/**
 * Follow-up deterministic handlers for the BMEDIS Copilot (Phase 3).
 *
 * These keep short, pronoun-y follow-ups ("Why?", "Explain simply.", "Where
 * did you get that?", "What if I ignore it?", "Is that safe?", "What should I
 * do next?") feeling like the same conversation rather than disconnected
 * prompts.
 *
 * The orchestrator runs these BEFORE the workflow explainer / capability
 * builders so a short follow-up doesn't get misclassified as a new generic
 * question. Each handler returns a structured AssistantContent skeleton
 * grounded in the prior turn's title, evidence, and source tables — never
 * inventing record-level facts.
 */

import type {
  AssistantContent,
  CapabilityId,
  ChatDecision,
  UserChatProfile,
} from '@/types/chatbot';

export type FollowUpKind =
  | 'why'
  | 'why_that_one'
  | 'next_step'
  | 'explain_simply'
  | 'where_did_you_get_that'
  | 'what_if_i_ignore_it'
  | 'is_that_safe'
  | 'what_happens_next'
  | 'can_you_draft_it';

const FOLLOW_UP_PATTERNS: Array<{ kind: FollowUpKind; patterns: RegExp[] }> = [
  {
    kind: 'why_that_one',
    patterns: [
      /^\s*why\s+(that one|this one|it|that)\s*\??\s*$/i,
      /^\s*why\s+(that|this)\s+(specifically|first|now)\s*\??\s*$/i,
      /\bwhy\s+(that one|this one|it)\s+(first|now|specifically)\b/i,
    ],
  },
  {
    kind: 'why',
    patterns: [
      /^\s*why\s*\??\s*$/i,
      /^\s*why\s+do\s+you\s+say\s+that\s*\??\s*$/i,
      /^\s*why\s+is\s+that\s*\??\s*$/i,
    ],
  },
  {
    kind: 'explain_simply',
    patterns: [
      /\bexplain (simply|in plain english|in simple terms|like i'?m\s*\d+|for a manager|for management)\b/i,
      /\bsay (this )?in plain english\b/i,
      /\bsimpler please\b/i,
      /\bmake (this|that) shorter\b/i,
    ],
  },
  {
    kind: 'where_did_you_get_that',
    patterns: [
      /\bwhere did you get (that|this|those)\b/i,
      /\bwhat (table|source|view|data|evidence) (is this|did you use|backs this|did you read)\b/i,
      /\bwhat tool (did|do) you (use|read)\b/i,
      /\bsource of (this|that|the data|the answer)\b/i,
    ],
  },
  {
    kind: 'what_if_i_ignore_it',
    patterns: [
      /\bwhat (if|happens if) (i|we) ignore (this|that|it)\b/i,
      /\bwhat (if|happens if) (i|we) (do nothing|skip this|defer this)\b/i,
      /\bwhat happens if i don'?t (do|act on|address) (this|that|it)\b/i,
    ],
  },
  {
    kind: 'is_that_safe',
    patterns: [
      /\bis (that|this) safe\b/i,
      /\bwill (that|this) be safe\b/i,
      /\bis it safe to (do|continue|proceed)\b/i,
    ],
  },
  {
    kind: 'what_happens_next',
    patterns: [
      /^\s*what happens next\s*\??\s*$/i,
      /\bwhat happens after (this|that|i complete|i submit|i confirm)\b/i,
      /\bwhat does (this|that|completing this|submitting this) trigger\b/i,
    ],
  },
  {
    kind: 'can_you_draft_it',
    patterns: [
      /\bcan you draft (it|that|this|one)\b/i,
      /\bplease draft (it|that|this|one)\b/i,
      /\bgo ahead and draft\b/i,
    ],
  },
  {
    kind: 'next_step',
    patterns: [
      /^\s*what should i (do|tackle|work on) next\s*\??\s*$/i,
      /^\s*next step\s*\??\s*$/i,
      /^\s*and (then|after that)\s*\??\s*$/i,
    ],
  },
];

export interface FollowUpMemoryContext {
  /** Short rolling summary of the conversation so far. */
  shortSummary?: string;
  /** Last topic/capability the assistant was working on. */
  activeCapability?: CapabilityId;
  /** Last entity labels the assistant referenced. */
  lastEntityLabels?: string[];
  /** Last evidence_used array from the prior assistant turn. */
  lastEvidenceUsed?: string[];
  /** Last source_tables array from the prior assistant turn. */
  lastSourceTables?: string[];
  /** Last data_freshness sentence from the prior assistant turn. */
  lastDataFreshness?: string;
  /** Last data_mode tag from the prior assistant turn. */
  lastDataMode?: NonNullable<AssistantContent['data_mode']>;
  /** Evidence completeness from the prior assistant turn. */
  lastEvidenceCompleteness?: {
    status?: string;
    score?: number;
    requiredMissing?: string[];
  };
  /** Confidence that memory is recent and entity-grounded enough for follow-up routing. */
  memoryConfidence?: 'high' | 'medium' | 'low';
  /** Number of turns since the prior assistant anchor. */
  memoryAgeTurns?: number;
  /** Last assistant title (for back-reference phrasing). */
  lastTitle?: string;
  /** Last assistant summary (for the short-paraphrase path). */
  lastSummary?: string;
  /** Whether the prior turn carried an action draft. */
  hadActionDraft?: boolean;
}

export interface FollowUpHandlerInput {
  message: string;
  profile?: Pick<UserChatProfile, 'roleNames' | 'departmentId'> | null;
  memory?: FollowUpMemoryContext;
  decision?: ChatDecision;
}

export interface FollowUpHandlerResult {
  kind: FollowUpKind;
  answer: AssistantContent;
  /** True when the handler could not find enough memory context to be useful. */
  needsClarification?: boolean;
}

export function detectFollowUpKind(message: string): FollowUpKind | null {
  const normalized = message.trim();
  if (normalized.length === 0) return null;
  // Short prompts are far more likely to be follow-ups; long prompts almost
  // certainly aren't, so we early-exit when the message is verbose.
  if (normalized.length > 160) return null;
  for (const entry of FOLLOW_UP_PATTERNS) {
    if (entry.patterns.some((p) => p.test(normalized))) return entry.kind;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const CLARIFY_SUMMARY =
  'I am missing the earlier topic to anchor this follow-up. Tell me which asset, work order, request, report, or notification you mean, or open it in BMEDIS and ask again.';

function baseAnswer(
  kind: FollowUpKind,
  title: string,
  summary: string,
  decision: ChatDecision,
  parts: Partial<AssistantContent> = {},
): AssistantContent {
  return {
    decision,
    title,
    intelligence_mode: 'standard',
    summary,
    key_findings: parts.key_findings ?? [],
    recommended_actions: parts.recommended_actions ?? [],
    priority_reasoning: parts.priority_reasoning ?? [],
    likely_causes: parts.likely_causes ?? [],
    troubleshooting_steps: parts.troubleshooting_steps ?? [],
    maintenance_tips: parts.maintenance_tips ?? [],
    required_tools_or_parts: parts.required_tools_or_parts ?? [],
    actions: parts.actions ?? [],
    insights: parts.insights ?? [],
    recommendations: parts.recommendations ?? [],
    entities_referenced: parts.entities_referenced ?? [],
    follow_up_suggestions: parts.follow_up_suggestions ?? [],
    proactive_signals: parts.proactive_signals ?? [],
    routing_explanation: parts.routing_explanation ?? [`Follow-up handler: ${kind}.`],
    evidence_used: parts.evidence_used ?? [],
    links: parts.links ?? [],
    limitations: parts.limitations ?? [],
    missingDataFlags: parts.missingDataFlags ?? [],
    data_freshness: parts.data_freshness,
    data_mode: parts.data_mode,
    data_age_label: parts.data_age_label,
    source_tables: parts.source_tables ?? [],
    action_drafts: parts.action_drafts ?? [],
    answer_basis: parts.answer_basis ?? 'system_data',
    confidence: parts.confidence ?? 'medium',
    escalation_required: parts.escalation_required ?? false,
    escalation_recommendation: parts.escalation_recommendation,
    escalation_guidance: parts.escalation_guidance,
    reason_for_limit: parts.reason_for_limit,
  };
}

function hasUsefulMemory(memory?: FollowUpMemoryContext): memory is FollowUpMemoryContext {
  if (!memory) return false;
  if (memory.memoryConfidence === 'low') return false;
  if ((memory.memoryAgeTurns ?? 0) > 8) return false;
  if (memory.lastEvidenceCompleteness?.status === 'insufficient' || memory.lastEvidenceCompleteness?.status === 'denied') {
    return false;
  }
  return Boolean(
    (memory.activeCapability && memory.memoryConfidence === 'high') ||
      (memory.lastEntityLabels?.length ?? 0) > 0 ||
      memory.lastTitle ||
      memory.lastSummary,
  );
}

function clarify(kind: FollowUpKind, decision: ChatDecision): FollowUpHandlerResult {
  return {
    kind,
    needsClarification: true,
    answer: baseAnswer(kind, 'Need a bit more context', CLARIFY_SUMMARY, decision, {
      recommended_actions: [
        'Open the related asset, work order, request, report, or notification first.',
        'Or tell me the specific record (e.g., "this work order", "this calibration record") so I can ground the follow-up.',
      ],
      answer_basis: 'insufficient_data',
      confidence: 'low',
      reason_for_limit: 'No prior conversation topic was available to anchor the follow-up.',
    }),
  };
}

function topicLabel(memory: FollowUpMemoryContext): string {
  if (memory.lastTitle) return memory.lastTitle;
  if (memory.lastEntityLabels && memory.lastEntityLabels.length > 0) {
    return memory.lastEntityLabels[0];
  }
  if (memory.activeCapability) {
    return memory.activeCapability.replace(/_/g, ' ');
  }
  return 'the previous topic';
}

/* ------------------------------------------------------------------ */
/* Handlers                                                           */
/* ------------------------------------------------------------------ */

function handleWhy(input: FollowUpHandlerInput, kind: FollowUpKind): FollowUpHandlerResult {
  const decision: ChatDecision = input.decision ?? 'answer';
  if (!hasUsefulMemory(input.memory)) return clarify(kind, decision);
  const memory = input.memory!;
  const topic = topicLabel(memory);
  return {
    kind,
    answer: baseAnswer(
      kind,
      `Why — ${topic}`,
      `${memory.lastSummary ? `${memory.lastSummary.trim()} ` : ''}The reasoning is grounded in the evidence and source tables surfaced in the last answer. If you want a different angle (priority, risk, evidence), say which.`,
      decision,
      {
        priority_reasoning: memory.lastEvidenceUsed && memory.lastEvidenceUsed.length > 0
          ? memory.lastEvidenceUsed.slice(0, 5).map((e) => `Evidence: ${e}`)
          : [
              'Reasoning is based on the previous answer; no fresh evidence was retrieved for this follow-up.',
            ],
        evidence_used: memory.lastEvidenceUsed ?? [],
        source_tables: memory.lastSourceTables ?? [],
        data_freshness: memory.lastDataFreshness,
        data_mode: memory.lastDataMode,
        follow_up_suggestions: ['Explain simply.', 'Where did you get that?', 'What should I do next?'],
      },
    ),
  };
}

function handleExplainSimply(input: FollowUpHandlerInput): FollowUpHandlerResult {
  const decision: ChatDecision = input.decision ?? 'answer';
  if (!hasUsefulMemory(input.memory)) return clarify('explain_simply', decision);
  const memory = input.memory!;
  const topic = topicLabel(memory);
  const short = memory.lastSummary?.trim() ?? '';
  // Strip jargon-ish parentheticals to make a manager-friendly paraphrase.
  const simple = short
    .replace(/\(([^)]+)\)/g, '')
    .replace(/\b(RPN|RPI|MTBF|MTTR|FMEA|PMC|RBAC)\b/g, (m) => {
      switch (m) {
        case 'RPN':
          return 'risk priority number';
        case 'RPI':
          return 'replacement priority';
        case 'MTBF':
          return 'time between failures';
        case 'MTTR':
          return 'time to repair';
        case 'FMEA':
          return 'failure analysis';
        case 'PMC':
          return 'PM compliance';
        case 'RBAC':
          return 'role permissions';
        default:
          return m;
      }
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return {
    kind: 'explain_simply',
    answer: baseAnswer(
      'explain_simply',
      `In plain terms — ${topic}`,
      simple || `${topic}: I do not have a shorter way to put it without losing accuracy. Tell me which part is unclear and I will rephrase that piece.`,
      decision,
      {
        recommended_actions: [
          'If you need a one-line version for management, ask "give me the management one-liner."',
          'If you need a deeper version, ask "explain the formula" or "explain the workflow."',
        ],
        follow_up_suggestions: ['Where did you get that?', 'What should I do next?'],
      },
    ),
  };
}

function handleWhereDidYouGetThat(input: FollowUpHandlerInput): FollowUpHandlerResult {
  const decision: ChatDecision = input.decision ?? 'answer';
  const memory = input.memory ?? {};
  const sources = memory.lastSourceTables ?? [];
  const evidence = memory.lastEvidenceUsed ?? [];
  const summary =
    sources.length === 0 && evidence.length === 0
      ? 'The last answer did not retrieve fresh BMEDIS evidence; it was either a workflow / formula explanation or used only page context. If you need an evidence-backed answer, open the relevant record (asset, work order, PM, calibration, report) and ask again.'
      : `That answer came from BMEDIS records. Source tables: ${sources.length ? sources.join(', ') : '(none recorded)'}.${evidence.length ? ` Evidence used: ${evidence.slice(0, 6).join('; ')}.` : ''}`;
  return {
    kind: 'where_did_you_get_that',
    answer: baseAnswer('where_did_you_get_that', 'Source of the previous answer', summary, decision, {
      source_tables: sources,
      evidence_used: evidence,
      data_freshness: memory.lastDataFreshness,
      data_mode: memory.lastDataMode,
      answer_basis: sources.length || evidence.length ? 'system_data' : 'insufficient_data',
      confidence: sources.length || evidence.length ? 'high' : 'low',
      recommended_actions: [
        'Open the linked record / report directly in BMEDIS to verify.',
        sources.length === 0 && evidence.length === 0
          ? 'Ask the question again from the record page so retrieval can run.'
          : '',
      ].filter(Boolean) as string[],
    }),
  };
}

function handleWhatIfIIgnoreIt(input: FollowUpHandlerInput): FollowUpHandlerResult {
  const decision: ChatDecision = input.decision ?? 'answer';
  if (!hasUsefulMemory(input.memory)) return clarify('what_if_i_ignore_it', decision);
  const memory = input.memory!;
  const topic = topicLabel(memory);
  const capability = memory.activeCapability;
  // Capability-aware downstream effects. These are generic but honest — no
  // invented numbers.
  let consequences: string[] = [];
  switch (capability) {
    case 'summarize_work_order':
    case 'prioritize_tasks':
      consequences = [
        'The work order stays open and ages; aging WOs surface as Critical Action Score.',
        'Reliability metrics (MTTR / MTBF / availability) for the asset will not change without reliability evidence.',
        'Requester / department keeps receiving status notifications until the WO closes.',
      ];
      break;
    case 'explain_pm_status':
      consequences = [
        'PM compliance for the department / asset drops with each missed schedule.',
        'Overdue PM is picked up by the scheduled notification rule and resurfaces.',
        'Risk detectability may not refresh until PM completes.',
      ];
      break;
    case 'logistics_status':
      consequences = [
        'The blocked work order stays on-hold and surfaces as a stock blocker on Command Center.',
        'Stockout / low-stock notifications keep firing within their dedupe window.',
        'Procurement delay scoring keeps escalating against expected_delivery_date.',
      ];
      break;
    case 'explain_equipment_risk':
      consequences = [
        'RPN / RPI snapshots remain at the last refresh until decision-support is refreshed.',
        'High-risk assets keep appearing on the replacement watch and risk strip.',
      ];
      break;
    case 'qr_asset_context':
      consequences = [
        'Revoked / needs-replacement labels stay reported under QR coverage.',
        'Continuing to scan a revoked token keeps firing qr.revoked_scanned to the BME Head.',
      ];
      break;
    case 'offline_sync_status':
      consequences = [
        'Conflict rows stay open in /offline-sync until resolved or discarded.',
        'Stale cached read views can mislead operational decisions.',
      ];
      break;
    case 'report_summary':
      consequences = [
        'The dashboard / report misalignment keeps showing the old snapshot until refresh.',
        'Stakeholders may quote a stale generated_at timestamp.',
      ];
      break;
    default:
      consequences = [
        'The pending workflow continues to age and resurfaces in triage / notifications until acted on.',
        'Downstream evidence (audit, reliability, compliance) cannot update without the corresponding action.',
      ];
  }
  return {
    kind: 'what_if_i_ignore_it',
    answer: baseAnswer(
      'what_if_i_ignore_it',
      `If you ignore ${topic}`,
      'Nothing breaks immediately, but BMEDIS surfaces the downstream consequences listed below until the workflow is acted on. These are general consequences for this workflow type — they are not record-specific predictions.',
      decision,
      {
        key_findings: consequences,
        recommended_actions: [
          'Acknowledge or convert the signal so it stops resurfacing.',
          'If you cannot act now, defer / mark under review so the audit trail is honest.',
        ],
        follow_up_suggestions: ['What should I do next?', 'Is that safe?'],
      },
    ),
  };
}

function handleIsThatSafe(input: FollowUpHandlerInput): FollowUpHandlerResult {
  const decision: ChatDecision = input.decision ?? 'answer';
  if (!hasUsefulMemory(input.memory)) return clarify('is_that_safe', decision);
  const memory = input.memory!;
  const topic = topicLabel(memory);
  return {
    kind: 'is_that_safe',
    answer: baseAnswer(
      'is_that_safe',
      `Safety check — ${topic}`,
      'The Copilot suggests safe first-line steps and BMEDIS workflows only. Safety for the patient and operator depends on the physical state of the device — if anything looks unsafe (alarm, smoke, overheating, fluid ingress, sharp edges, electrical fault), remove the equipment from clinical use first.',
      decision,
      {
        troubleshooting_steps: [
          'Visually inspect power, cable, accessories, and ventilation before any action.',
          'If the device is alarming or showing a safety fault, remove it from clinical use.',
          'Log the issue in BMEDIS and escalate to the BME Head or vendor.',
          'Never bypass alarms, disable interlocks, or open the device.',
        ],
        recommended_actions: [
          'Confirm the BMEDIS workflow (work order / request) is the right vehicle for this action.',
          'If you are unsure, escalate before acting.',
        ],
        escalation_recommendation: 'When in doubt, escalate to a qualified biomedical engineer or vendor.',
      },
    ),
  };
}

function handleWhatHappensNext(input: FollowUpHandlerInput): FollowUpHandlerResult {
  const decision: ChatDecision = input.decision ?? 'answer';
  if (!hasUsefulMemory(input.memory)) return clarify('what_happens_next', decision);
  const memory = input.memory!;
  const topic = topicLabel(memory);
  return {
    kind: 'what_happens_next',
    answer: baseAnswer(
      'what_happens_next',
      `What happens next — ${topic}`,
      'The chain depends on which workflow this is part of. Ask for the specific workflow ("work order completion chain", "PM lifecycle", "stock receipt chain", etc.) and I will walk through the exact sequence of records, notifications, and metric updates.',
      decision,
      {
        recommended_actions: [
          'Ask "explain the [WO completion / PM / calibration / stock / QR / offline] lifecycle" for the full chain.',
          'Or open the linked record and ask "what happens after I confirm this?".',
        ],
        follow_up_suggestions: ['Explain the work order lifecycle.', 'Explain the PM lifecycle.'],
      },
    ),
  };
}

function handleCanYouDraftIt(input: FollowUpHandlerInput): FollowUpHandlerResult {
  const decision: ChatDecision = input.decision ?? 'answer';
  const isViewer = input.profile?.roleNames.includes('viewer') ?? false;
  if (isViewer) {
    return {
      kind: 'can_you_draft_it',
      answer: baseAnswer(
        'can_you_draft_it',
        'Viewer is read-only',
        'Viewer access cannot create or update BMEDIS records. I can explain the workflow, but the request itself has to come from a role with mutation rights (Department Head/User, Technician, Store, BME Head).',
        'refuse',
        {
          recommended_actions: [
            'Ask the appropriate role to create the record (e.g., department staff for a maintenance request).',
            'Or ask me to summarize the situation so you can hand it off cleanly.',
          ],
          answer_basis: 'insufficient_data',
          confidence: 'low',
          reason_for_limit: 'Viewer role is read-only.',
        },
      ),
    };
  }
  return {
    kind: 'can_you_draft_it',
    answer: baseAnswer(
      'can_you_draft_it',
      'Draft request',
      'Yes — tell me which kind of record (maintenance request, calibration request, training request, reorder request, event note) and the asset / part / work order it should attach to. I will surface a draft card you can review and confirm before anything is created.',
      decision,
      {
        recommended_actions: [
          'Open the related asset, work order, or part page first so the draft attaches the correct record.',
          'Then say "draft a maintenance request" / "draft a reorder" / "log a maintenance event".',
        ],
      },
    ),
  };
}

function handleNextStep(input: FollowUpHandlerInput): FollowUpHandlerResult {
  const decision: ChatDecision = input.decision ?? 'answer';
  if (!hasUsefulMemory(input.memory)) return clarify('next_step', decision);
  const memory = input.memory!;
  const topic = topicLabel(memory);
  return {
    kind: 'next_step',
    answer: baseAnswer(
      'next_step',
      `Next step — ${topic}`,
      'Pick the most concrete next step from the prior answer. If it was a priority list, act on the first item. If it was a workflow explanation, the next step is to open the exact record and run that action.',
      decision,
      {
        recommended_actions: [
          'Open the highest-priority linked record from the last answer.',
          'If multiple records were listed, address the first one before re-asking.',
        ],
        follow_up_suggestions: ['What if I ignore it?', 'Is that safe?'],
      },
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                        */
/* ------------------------------------------------------------------ */

export function handleFollowUp(input: FollowUpHandlerInput): FollowUpHandlerResult | null {
  const kind = detectFollowUpKind(input.message);
  if (!kind) return null;
  switch (kind) {
    case 'why':
    case 'why_that_one':
      return handleWhy(input, kind);
    case 'explain_simply':
      return handleExplainSimply(input);
    case 'where_did_you_get_that':
      return handleWhereDidYouGetThat(input);
    case 'what_if_i_ignore_it':
      return handleWhatIfIIgnoreIt(input);
    case 'is_that_safe':
      return handleIsThatSafe(input);
    case 'what_happens_next':
      return handleWhatHappensNext(input);
    case 'can_you_draft_it':
      return handleCanYouDraftIt(input);
    case 'next_step':
      return handleNextStep(input);
    default:
      return null;
  }
}
