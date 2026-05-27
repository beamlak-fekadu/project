/**
 * Workflow-chain, formula, notification, QR, offline, report, and validation
 * deterministic explainers for the BMEDIS Copilot (Phase 2).
 *
 * Each explainer is pure: it consumes only the prompt + page context + light
 * evidence hints, never invents record-level facts, and emits a structured
 * AssistantContent skeleton. The orchestrator uses the output both:
 *   1. as a deterministic grounding skeleton for Gemini, and
 *   2. as a final answer when the provider is unavailable or the usefulness
 *      guard prefers it.
 *
 * Source-of-truth references are the canonical BMEDIS tables / RPCs / audit
 * events / Phase 1–6 routes. No new tables are introduced here.
 */

import type {
  AssistantContent,
  CapabilityId,
  ChatContextRefs,
  ChatDecision,
  ChatEvidence,
  ChatModuleContext,
  UserChatProfile,
} from '@/types/chatbot';

export type WorkflowExplainerKey =
  // T3 — workflow chains
  | 'maintenance_request_lifecycle'
  | 'work_order_lifecycle'
  | 'work_order_completion_reliability'
  | 'pm_lifecycle'
  | 'calibration_lifecycle'
  | 'stock_procurement_lifecycle'
  | 'replacement_rpi_lifecycle'
  | 'qr_lifecycle'
  | 'offline_lifecycle'
  | 'notification_telegram_lifecycle'
  | 'report_lifecycle'
  // T4 — formulas / scores
  | 'formula_rpn'
  | 'formula_rpi'
  | 'formula_mttr'
  | 'formula_mtbf'
  | 'formula_availability'
  | 'formula_pm_compliance'
  | 'formula_calibration_compliance'
  | 'formula_equipment_health'
  | 'formula_department_readiness'
  | 'formula_critical_action_score'
  | 'formula_stock_blocker_priority'
  | 'formula_procurement_delay'
  | 'formula_technician_workload'
  | 'formula_offline_conflict_status'
  // T5 — notification / Telegram
  | 'notification_delivery_explainer'
  | 'telegram_eligibility_explainer'
  | 'notification_rule_explainer'
  | 'notification_dedupe_explainer'
  // T6 — QR / offline / report / validation
  | 'qr_explainer'
  | 'offline_can_i_do_this'
  | 'report_summary_explainer'
  | 'validation_readiness_explainer';

export interface WorkflowExplainerQuery {
  message: string;
  capability: CapabilityId;
  profile?: Pick<UserChatProfile, 'roleNames' | 'departmentId'> | null;
  contextRefs?: ChatContextRefs;
  moduleContext?: ChatModuleContext;
  evidence?: ChatEvidence;
  /** Optional decision hint from the safety service. */
  decision?: ChatDecision;
}

export interface WorkflowExplainerAnswer {
  key: WorkflowExplainerKey;
  title: string;
  summary: string;
  key_findings: string[];
  recommended_actions: string[];
  priority_reasoning: string[];
  source_tables: string[];
  evidence_used: string[];
  links: Array<{ label: string; href: string; type?: string }>;
  limitations: string[];
  data_mode: NonNullable<AssistantContent['data_mode']>;
  data_freshness: string;
}

/* ------------------------------------------------------------------ */
/* Detection                                                          */
/* ------------------------------------------------------------------ */

/** Phrase tables. First match wins per group. */
const KEY_PATTERNS: Array<{ key: WorkflowExplainerKey; patterns: RegExp[] }> = [
  // ----- T3 workflow chains
  {
    key: 'maintenance_request_lifecycle',
    patterns: [
      /\b(maintenance|corrective|repair)\s+request\s+(lifecycle|workflow|chain|process|flow)\b/i,
      /\bwhat happens (after|when) (i\s+)?(create|submit|raise|file|approve|reject)\s+(a\s+)?(maintenance|corrective|repair)\s+request\b/i,
      /\bhow (does|do)\s+(the\s+)?(maintenance|corrective|repair)\s+request\s+(get|reach|become)\s+(a\s+)?work order\b/i,
      /\bwho gets notified\s+(when|after)\s+(i\s+)?(create|submit)\s+(a\s+)?(maintenance|corrective|repair)\s+request\b/i,
    ],
  },
  {
    key: 'work_order_completion_reliability',
    patterns: [
      /\bcomplete\s+(this\s+)?work order\s+(without|with)\s+(reliability|evidence)\b/i,
      /\b(why|how)\s+(does|do|did)?\s*(MTTR|MTBF|availability)\s+(not\s+)?(change|update|move)\b/i,
      /\bwhat evidence\s+(does|do)\s+(work order\s+)?completion\s+need\b/i,
      /\brepair_duration_hours|downtime_start|downtime_end|failure_date\b/i,
      /\bwork order completion\s+(reliability|evidence|chain)\b/i,
    ],
  },
  {
    key: 'work_order_lifecycle',
    patterns: [
      /\bwork order\s+(lifecycle|workflow|chain|process|flow)\b/i,
      /\bwhat happens (after|when) (i\s+)?(start|assign|complete|close|cancel)\s+(this\s+)?work order\b/i,
      /\bwhat does (this|completing|closing|assigning)\s+(this\s+)?work order\s+update\b/i,
    ],
  },
  {
    key: 'pm_lifecycle',
    patterns: [
      /\b(pm|preventive maintenance)\s+(lifecycle|workflow|chain|process|flow|schedule\s+lifecycle)\b/i,
      /\bwhat happens (after|when) (i\s+)?(complete|skip|defer|schedule)\s+(this\s+)?pm\b/i,
      /\bhow does (this|the) pm\s+(affect|update|change)\s+(compliance|readiness)\b/i,
      /\bpm compliance.*(update|change|refresh|chain|workflow)\b/i,
    ],
  },
  {
    key: 'calibration_lifecycle',
    patterns: [
      /\bcalibration\s+(lifecycle|workflow|chain|process|flow)\b/i,
      /\bwhat happens (after|when) (i\s+)?(record|complete|schedule|approve|reject)\s+(a\s+)?calibration\b/i,
      /\bwhy did calibration failed notification fire\b/i,
      /\bwhat (does|happens) (after\s+)?a\s+(failed|adjusted|pass)\s+calibration\b/i,
    ],
  },
  {
    key: 'stock_procurement_lifecycle',
    patterns: [
      /\b(stock|spare\s*part|inventory)\s+(lifecycle|workflow|chain|process|flow)\b/i,
      /\b(procurement|delivery|receipt)\s+(lifecycle|workflow|chain|process|flow)\b/i,
      /\bwhat happens (after|when) (i\s+)?(issue|receive|order|deliver)\s+(stock|parts?|procurement)\b/i,
      /\bwhat (does|happens after)\s+(delivered_pending_receipt|delivered|restocked|stockout|low_stock|crossed_reorder)\b/i,
      /\bhow (does|do) (stock|stockout|restocked|reorder)\s+(notifications?\s+)?(fire|trigger|happen)\b/i,
    ],
  },
  {
    key: 'replacement_rpi_lifecycle',
    patterns: [
      /\b(replacement|rpi)\s+(lifecycle|workflow|chain|process|flow)\b/i,
      /\bwhat happens (after|when) (i\s+)?(approve|review|act on)\s+(a\s+)?(replacement|rpi)\b/i,
      /\bsource_replacement_score_id\b/i,
      /\bhow (does|do) replacement (drilldown|score)\s+(work|update|chain)\b/i,
    ],
  },
  {
    key: 'qr_lifecycle',
    patterns: [
      /\bqr\s+(lifecycle|workflow|chain|process|flow)\b/i,
      /\bwhat happens (after|when) (i\s+)?(scan|generate|print|attach|revoke)\s+(a\s+)?qr\b/i,
      /\bwhat happens if i scan twice\b/i,
      /\bwhy is\s+(this\s+)?token\s+revoked\b/i,
    ],
  },
  {
    key: 'offline_lifecycle',
    patterns: [
      /\boffline\s+(lifecycle|workflow|chain|process|flow|replay|sync\s+(workflow|chain))\b/i,
      /\bwhat happens (after|when) (i\s+)?(queue|go offline|sync|reconnect)\b/i,
      /\bforeground replay\b/i,
      /\bwill this sync if (i\s+)?close the browser\b/i,
    ],
  },
  {
    key: 'notification_telegram_lifecycle',
    patterns: [
      /\bnotification\s+(lifecycle|workflow|chain|process|flow)\b/i,
      /\btelegram\s+(lifecycle|workflow|chain|process|flow)\b/i,
      /\bwho gets notified\b/i,
    ],
  },
  {
    key: 'report_lifecycle',
    patterns: [
      /\breport\s+(lifecycle|workflow|chain|process|flow|pipeline)\b/i,
      /\bwhich report\s+(will|does)\s+(this\s+)?affect\b/i,
      /\bwhere does\s+(this\s+)?data come from\s+in\s+(the\s+)?report\b/i,
      /\bwhat is\s+data_snapshot_at\b/i,
      /\bwhat generated this report\b/i,
    ],
  },

  // ----- T4 formulas
  {
    key: 'formula_rpi',
    patterns: [
      /\brpi\b/i,
      /\breplacement priority index\b/i,
    ],
  },
  {
    key: 'formula_rpn',
    patterns: [
      /\brpn\b/i,
      /\bseverity\s*[xX×]\s*occurrence\s*[xX×]\s*detect/i,
      /\bfmea\b/i,
    ],
  },
  {
    key: 'formula_availability',
    patterns: [
      /\bavailability\b.*(formula|calculated|mean|computed)/i,
      /\bavailability\s*=/i,
      /\bMTBF\s*\/\s*\(\s*MTBF\s*\+\s*MTTR\s*\)/i,
    ],
  },
  {
    key: 'formula_mttr',
    patterns: [/\bMTTR\b/i, /\bmean time to repair\b/i],
  },
  {
    key: 'formula_mtbf',
    patterns: [/\bMTBF\b/i, /\bmean time between failures\b/i],
  },
  {
    key: 'formula_pm_compliance',
    patterns: [/\bPM compliance\b/i, /\bpreventive maintenance compliance\b/i],
  },
  {
    key: 'formula_calibration_compliance',
    patterns: [/\bcalibration (compliance|risk)\b/i],
  },
  {
    key: 'formula_equipment_health',
    patterns: [/\bequipment health\b/i, /\bhealth score\b/i],
  },
  {
    key: 'formula_department_readiness',
    patterns: [/\bdepartment readiness\b/i, /\bclinical readiness\b/i, /\breadiness score\b/i],
  },
  {
    key: 'formula_critical_action_score',
    patterns: [/\bcritical action score\b/i, /\bcritical actions?\b.*\b(rank|order|weight|why)\b/i],
  },
  {
    key: 'formula_stock_blocker_priority',
    patterns: [/\bstock blocker (priority|score|rank)\b/i, /\bblocker priority\b/i],
  },
  {
    key: 'formula_procurement_delay',
    patterns: [/\bprocurement delay (priority|score|rank)\b/i, /\bexpected_delivery_date\b/i],
  },
  {
    key: 'formula_technician_workload',
    patterns: [/\btechnician workload\b/i, /\boverloaded\b.*\b(technician|capacity)\b/i],
  },
  {
    key: 'formula_offline_conflict_status',
    patterns: [/\boffline conflict\b/i, /\bconflict_type\b/i, /\bresolution_status\b/i],
  },

  // ----- Validation must be checked before telegram_eligibility so prompts like
  // "How do I validate Telegram delivery?" stay in the validation bucket.
  {
    key: 'validation_readiness_explainer',
    patterns: [
      /\bhow do i validate (reliability|telegram|notifications?|qr|calibration|pm)\b/i,
      /\bvalidation readiness\b/i,
      /\bwhich validation fixture is missing\b/i,
    ],
  },

  // ----- T5 notification / telegram
  {
    key: 'telegram_eligibility_explainer',
    patterns: [
      /\b(no_chat_id|not_eligible)\b/i,
      /\bwhy didn['’]?t telegram\b/i,
      /\btelegram (eligible|eligibility|delivery|monitor)\b/i,
    ],
  },
  {
    key: 'notification_rule_explainer',
    patterns: [
      /\bnotification rule\b/i,
      /\brule check\b/i,
      /\bwhen was (the\s+)?rule check\b/i,
      /\bnotification_rule_logs\b/i,
    ],
  },
  {
    key: 'notification_dedupe_explainer',
    patterns: [
      /\bdedupe\b/i,
      /\bduplicate notification\b/i,
      /\bwhy did i get this notification\b.*\b(again|twice|duplicate)\b/i,
    ],
  },
  {
    key: 'notification_delivery_explainer',
    patterns: [
      /\bwhy did i get this notification\b/i,
      /\bwho else (was|got) notified\b/i,
      /\bnotification delivery\b/i,
    ],
  },

  // ----- T6 QR / offline / report / validation
  {
    key: 'qr_explainer',
    patterns: [
      /\bwhat does this qr (label )?status mean\b/i,
      /\bwas this scanned before\b/i,
      /\bwhat does qr coverage show\b/i,
      /\bwhich report proves qr\b/i,
      /\bwhat is this scanned asset\b/i,
    ],
  },
  {
    key: 'offline_can_i_do_this',
    patterns: [
      /\bcan i do this offline\b/i,
      /\bwill this work offline\b/i,
      /\bwhat actions are supported offline\b/i,
      /\bstale cached read view\b/i,
    ],
  },
  {
    key: 'report_summary_explainer',
    patterns: [
      /\bsummari[sz]e this report\b/i,
      /\bwhy does this differ from\s+(the\s+)?dashboard\b/i,
      /\bwhat should i check before presenting this report\b/i,
    ],
  },
  {
    key: 'validation_readiness_explainer',
    patterns: [
      /\bwhat should i test next\b/i,
      /\bwhich validation fixture is missing\b/i,
      /\bvalidation readiness\b/i,
      /\bbefore (bme )?evaluation\b/i,
      /\bhow do i validate (reliability|telegram|notifications?|qr|calibration|pm)\b/i,
    ],
  },
];

export function detectWorkflowExplainerKey(message: string): WorkflowExplainerKey | null {
  const normalized = message.trim();
  for (const entry of KEY_PATTERNS) {
    if (entry.patterns.some((p) => p.test(normalized))) return entry.key;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function link(label: string, href: string, type?: string) {
  return { label, href, type };
}

function answer(
  key: WorkflowExplainerKey,
  title: string,
  summary: string,
  parts: Partial<Omit<WorkflowExplainerAnswer, 'key' | 'title' | 'summary'>>,
): WorkflowExplainerAnswer {
  return {
    key,
    title,
    summary,
    key_findings: parts.key_findings ?? [],
    recommended_actions: parts.recommended_actions ?? [],
    priority_reasoning: parts.priority_reasoning ?? [],
    source_tables: parts.source_tables ?? [],
    evidence_used: parts.evidence_used ?? [],
    links: parts.links ?? [],
    limitations: parts.limitations ?? [],
    data_mode: parts.data_mode ?? 'unknown',
    data_freshness:
      parts.data_freshness ??
      'This is a workflow/concept explanation, not a live record query. Real numbers come from the linked module pages.',
  };
}

/* ------------------------------------------------------------------ */
/* T3 — Workflow chain builders                                       */
/* ------------------------------------------------------------------ */

function buildMaintenanceRequestLifecycle(): WorkflowExplainerAnswer {
  return answer(
    'maintenance_request_lifecycle',
    'Maintenance request lifecycle',
    'A corrective maintenance request is a BMEDIS intake row that flows from intake through approval and work-order creation, and ends when the WO is completed or the request is rejected/canceled.',
    {
      key_findings: [
        'Intake: Department User / Department Head / Technician / BME Head creates maintenance_requests. createMaintenanceRequestAction enforces the duplicate-open-request rule (at most one active corrective request per asset).',
        'Approval: BME Head reviews. createWorkOrderAction with request_id moves the request to "assigned" (when assigned_to is set) or "approved" (R17).',
        'Execution: Technician runs the work order. WO transitions need work_order.start / .complete / .hold / .add_event / .assign capabilities (R18).',
        'Closure: Completing the WO writes maintenance_events evidence (R2). Equipment condition syncs to the WO completion outcome.',
        'Notifications fire on create / status change / assignment via emitNotificationEvent (Phase 5 R6).',
      ],
      recommended_actions: [
        'Open exact request record at /maintenance/requests/[id].',
        'Track linked WO at /maintenance/work-orders/[id].',
        'Use Notification Center to see who was notified.',
      ],
      source_tables: ['maintenance_requests', 'work_orders', 'equipment_assets', 'notifications', 'audit_logs'],
      links: [
        link('Maintenance Center', '/maintenance', 'module'),
        link('Requests Hub', '/requests', 'module'),
      ],
      data_mode: 'live',
      data_freshness: 'Live workflow definition. Per-record state lives in maintenance_requests + work_orders.',
    },
  );
}

function buildWorkOrderLifecycle(): WorkflowExplainerAnswer {
  return answer(
    'work_order_lifecycle',
    'Work order lifecycle',
    'A work order goes open → assigned → in_progress → (completed | canceled | on_hold). Each transition is gated by a specific RBAC capability and triggers downstream evidence + notifications.',
    {
      key_findings: [
        'open → assigned: work_order.assign capability (technician/BME Head/admin/developer).',
        'assigned → in_progress: work_order.start. Sets started_at and updates the linked asset to under_maintenance.',
        'in_progress → completed: work_order.complete. Requires completion_outcome + final_equipment_condition. Corrective work orders always write one linked maintenance_events completion row; missing reliability fields are derived server-side where possible (R2).',
        '→ on_hold: work_order.hold. Used when blocked by parts or vendor.',
        'Stock blocker: declaring a work_order_parts_needed row marks the WO as a stock blocker without changing status.',
        'Notifications: work_order.assigned, work_order.stock_blocked, work_order.completed events fire to requester + BME Head + technician.',
      ],
      recommended_actions: [
        'Use /maintenance/work-orders/[id] to drive transitions.',
        'Declare parts-needed for any blocked WO (Phase 2 R19).',
        'Record reliability evidence on completion so MTTR/MTBF/availability actually change.',
      ],
      source_tables: ['work_orders', 'maintenance_events', 'work_order_parts_needed', 'audit_logs', 'notifications'],
      links: [link('Work Orders', '/work-orders', 'module')],
      data_mode: 'live',
    },
  );
}

function buildWorkOrderCompletionReliability(): WorkflowExplainerAnswer {
  return answer(
    'work_order_completion_reliability',
    'Work order completion → reliability evidence chain',
    'Completing a corrective work order writes linked maintenance_events completion evidence for MTTR, MTBF, and availability. User-entered reliability fields improve precision, and missing values are derived server-side from the work order/request timestamps where possible.',
    {
      key_findings: [
        'Required at completion: completion_outcome (resolved | partially_resolved | not_resolved | awaiting_parts_or_vendor) and final_equipment_condition.',
        'Optional user-entered reliability fields: repair_duration_hours, downtime_start, downtime_end, failure_date. The action still inserts or updates one completion-marked maintenance_events row for every corrective completion.',
        'A DB trigger (migration 00061) then derives a downtime_logs row keyed by event_id whenever both downtime_start and downtime_end are present.',
        'MTBF = operational_time / failure_count, MTTR = repair_time / repair_count, Availability = MTBF / (MTBF + MTTR) — all rely on the maintenance_events + downtime_logs rows.',
        'A reliability_evidence_warning is emitted only when the maintenance_events write itself fails, not merely because the user left optional fields blank.',
      ],
      recommended_actions: [
        'Fill repair_duration_hours, downtime_start, downtime_end, failure_date when known; otherwise review the server-derived evidence on the work order detail page.',
        'Use the work-order detail page (Reliability evidence subsection) before clicking Complete.',
        'Run analytics refresh from Developer Lab if you expect KPIs to update immediately.',
      ],
      source_tables: ['work_orders', 'maintenance_events', 'downtime_logs', 'equipment_reliability_metrics', 'audit_logs'],
      links: [link('Work Orders', '/work-orders', 'module'), link('Developer Lab', '/developer-lab', 'developer')],
      data_mode: 'live',
    },
  );
}

function buildPmLifecycle(): WorkflowExplainerAnswer {
  return answer(
    'pm_lifecycle',
    'PM lifecycle',
    'PM Plan defines a recurring rule. PM Schedule is one planned task. PM Completion is evidence that the task was performed. PM Compliance = completed scheduled tasks ÷ total scheduled tasks × 100.',
    {
      key_findings: [
        'PM Plan: recurring schedule (frequency_value + frequency_unit) in pm_plans.is_active.',
        'PM Schedule: one row in pm_schedules with scheduled_date, status (scheduled | in_progress | completed | overdue | deferred | skipped | canceled).',
        'Completion writes pm_completions, updates equipment condition, refreshes risk detectability via the recompute pipeline.',
        'Skipped/deferred are tracked separately — they do NOT count as completed for compliance.',
        '/pm is the planned-maintenance control center; /pm/schedules/[id] is the exact-record route.',
      ],
      recommended_actions: [
        'Open /pm/schedules/[id] before completing PM so the right plan/checklist is recorded.',
        'Run a Developer Lab refresh if PM compliance numbers look stale after completion.',
      ],
      source_tables: ['pm_plans', 'pm_schedules', 'pm_completions', 'pm_compliance_metrics', 'v_overdue_pm', 'audit_logs'],
      links: [link('PM Center', '/pm', 'module')],
      data_mode: 'snapshot',
      data_freshness: 'PM compliance is a snapshot metric refreshed by recompute_all_equipment_analytics().',
    },
  );
}

function buildCalibrationLifecycle(): WorkflowExplainerAnswer {
  return answer(
    'calibration_lifecycle',
    'Calibration lifecycle',
    'A calibration request is intake; a calibration record is evidence. A failed or adjusted result raises calibration risk and triggers a corrective-request shortcut.',
    {
      key_findings: [
        'Request: calibration_requests row, status pending → approved → in_progress → completed | rejected.',
        'Record: calibration_records row with result (pass | adjusted | fail), next_due_date, certificate_path.',
        'Fail / adjusted: createCalibrationRecordAction emits calibration.failed_or_adjusted notification (R6) and the UI surfaces a corrective-request shortcut.',
        'Compliance: calibration compliance counts pass results within the calibration_types.interval_months window.',
        'Scheduled scan: notification_rules can fire calibration.overdue based on v_calibration_due.',
      ],
      recommended_actions: [
        'For a failed/adjusted result, open a corrective maintenance request from /calibration/records/[id].',
        'Open /calibration to see due / overdue / failed-or-adjusted triage.',
      ],
      source_tables: ['calibration_requests', 'calibration_records', 'calibration_types', 'v_calibration_due', 'notifications'],
      links: [link('Calibration', '/calibration', 'module')],
      data_mode: 'live',
    },
  );
}

function buildStockProcurementLifecycle(): WorkflowExplainerAnswer {
  return answer(
    'stock_procurement_lifecycle',
    'Stock and procurement lifecycle',
    'Issuing stock can cross the reorder line or zero stock; both fire notifications. A delivered procurement does NOT auto-update current_stock — the Store User must record the receipt explicitly.',
    {
      key_findings: [
        'createStockIssueAction calls record_stock_issue RPC. It checks sufficient stock under a row lock and returns crossed_reorder + crossed_zero flags.',
        'crossed_zero → spare_part.stockout (high priority); crossed_reorder → spare_part.low_stock.',
        'work_order_parts_needed is the canonical "this WO is blocked by part X" signal (Phase 2 R19).',
        'Procurement delivered → procurement.delivered_pending_receipt notifies Store User with a deep-link that pre-opens the receipt modal (Phase 4 R21).',
        'createStockReceiptAction calls record_stock_receipt RPC. crossed_up = true means this receipt moved stock from at-or-below reorder to above it → spare_part.restocked notification (Phase 5 R9).',
      ],
      recommended_actions: [
        'Declare work_order_parts_needed for any WO blocked by parts so it surfaces on Command Center stock blockers.',
        'Use the deep-link in the Store User notification to record receipt from procurement.',
        'Procurement delay scoring uses expected_delivery_date — keep it accurate.',
      ],
      source_tables: ['spare_parts', 'stock_issues', 'stock_receipts', 'work_order_parts_needed', 'procurement_requests', 'notifications'],
      links: [link('Spare Parts', '/spare-parts', 'module'), link('Procurement', '/procurement', 'module')],
      data_mode: 'live',
    },
  );
}

function buildReplacementRpiLifecycle(): WorkflowExplainerAnswer {
  return answer(
    'replacement_rpi_lifecycle',
    'Replacement / RPI lifecycle',
    'RPI is an advisory snapshot score for asset replacement. BME Head reviews the drilldown, and any lifecycle action (disposal, procurement, specification) persists source_replacement_score_id so the decision is auditable.',
    {
      key_findings: [
        'replacement_priority_scores stores the canonical row (weights_profile_id IS NULL = computed) per asset.',
        '/command/drilldown/replacement/[assetId] renders evidence: criteria, weights, normalized values, generated reason.',
        'Lifecycle launchers (disposal / procurement / specification create flows) accept source_replacement_score_id and persist it on the resulting record (Phase 3 R32).',
        'RPI does NOT decide replacement on its own; BME Head approval drives it.',
      ],
      recommended_actions: [
        'Open /command/drilldown/replacement/[assetId] before approving any replacement action.',
        'Create disposal/procurement/spec from that page so source_replacement_score_id is captured.',
      ],
      source_tables: ['replacement_priority_scores', 'disposal_requests', 'procurement_requests', 'specification_requests'],
      links: [link('Replacement', '/replacement', 'module')],
      data_mode: 'snapshot',
      data_freshness: 'RPI is a snapshot score. Use Developer Lab refresh to recompute.',
    },
  );
}

function buildQrLifecycle(): WorkflowExplainerAnswer {
  return answer(
    'qr_lifecycle',
    'QR lifecycle',
    'QR tokens are generated, printed, attached, optionally revoked, and scanned. Scanning loads /qr/a/[token] with role-aware behavior; revoked tokens hide asset details and emit qr.revoked_scanned (Phase 5 R16).',
    {
      key_findings: [
        'Token generation: createEquipmentAction auto-generates a QR token at create time (Phase 4 R7); qr_label_status starts at "generated".',
        'Print → Attach → optionally Needs Replacement → Revoked. Lifecycle timestamps live on equipment_assets.',
        'Scan: /qr/a/[token] requires auth; revoked tokens show no asset details and fire qr.revoked_scanned (developer/admin/BME Head receive it).',
        'Scan dedup: logQrScan() dedupes "open_qr_landing" scans for the same asset + profile within 5 minutes (QR_SCAN_DEDUP_WINDOW_MINUTES).',
        'Reports: /reports/qr-coverage and /reports/qr-scan-evidence summarise coverage and scan activity.',
      ],
      recommended_actions: [
        'Open /equipment/qr-coverage to see ready-to-scan ratio and needs-replacement queue.',
        'For a revoked token, regenerate from the asset profile; do not re-print the old label.',
      ],
      source_tables: ['equipment_assets', 'equipment_qr_scans', 'audit_logs'],
      links: [
        link('QR Coverage', '/equipment/qr-coverage', 'qr'),
        link('QR Scan Report', '/reports/qr-scan-evidence', 'report'),
      ],
      data_mode: 'live',
    },
  );
}

function buildOfflineLifecycle(): WorkflowExplainerAnswer {
  return answer(
    'offline_lifecycle',
    'Offline workflow',
    'Offline-capable actions queue in IndexedDB while offline and replay on reconnect via foreground sync. There is no Background Sync API dependency — closing the browser tab pauses replay until the app is re-opened online.',
    {
      key_findings: [
        'Queue: IndexedDB store offline_actions. runOfflineCapableAction() enforces role gating; missing role fails closed (Phase 1 R12).',
        'Replay: handlers in src/lib/offline/handlers/* call syncOfflineQueuedActionAction. RBAC, validation, audit logging, and revalidation re-run server-side.',
        'Conflict types include duplicate_open_request, work_order_completed, insufficient_stock, department_scope_mismatch, asset_missing, qr_revoked, etc. Resolution statuses live in offline_sync_events.',
        'Sync Review Center: /offline-sync is the privileged review surface.',
        'Online-only: procurement / disposal approval, QR token admin, settings, security, analytics refresh, final assignment / final closure, replacement decisions.',
      ],
      recommended_actions: [
        'Use /offline-sync to retry, mark under review, manually resolve, or discard.',
        'See Developer Lab → Offline & Sync Diagnostics for queue + server-side evidence.',
      ],
      source_tables: ['offline_sync_events', 'audit_logs', 'IndexedDB (client-side)'],
      links: [link('Sync Review Center', '/offline-sync', 'offline')],
      data_mode: 'live',
      data_freshness: 'Client-side queue is live in IndexedDB; server-side offline_sync_events is also live.',
    },
  );
}

function buildNotificationTelegramLifecycle(): WorkflowExplainerAnswer {
  return answer(
    'notification_telegram_lifecycle',
    'Notification + Telegram lifecycle',
    'Each event → rule → recipient resolver → notification row → optional Telegram delivery → delivery log. Telegram is opt-in and never an authorization plane.',
    {
      key_findings: [
        'emitNotificationEvent writes notification_events. processNotificationEvent runs the rule fan-out into notifications rows (per recipient).',
        'Recipient resolution: notification rules pick role(s); department-scoped events filter by recipient department.',
        'Telegram eligibility: critical/high priority OR specific source types (work_order.assigned, work_order.stock_blocked, offline_sync.conflict, spare_part.stockout, qr.label_needs_replacement, qr.revoked_scanned, system.test_notification, notification.rule_failed) are always eligible. Otherwise TELEGRAM_MIN_PRIORITY governs.',
        'Telegram delivery: notification_deliveries.channel=telegram. Skip reasons: no_chat_id (recipient has no active telegram_connections), not_eligible (priority/source filtered), provider_failed (Telegram Bot API error).',
        'Dev monitor: when TELEGRAM_DEV_MONITOR_ENABLED, every Telegram-eligible notification also delivers a monitor copy with the real recipient masked.',
        'Dedupe: 10-minute cooldown keyed by recipient + event + source.',
      ],
      recommended_actions: [
        'Use /developer-lab#notification-diagnostics for the full delivery log and rule check history.',
        'For "Why didn\'t Telegram send?" check the eligibility evaluation in Developer Lab + each recipient\'s telegram_connections row.',
      ],
      source_tables: ['notification_events', 'notifications', 'notification_deliveries', 'notification_rule_logs', 'telegram_connections'],
      links: [
        link('Notification Center', '/notifications', 'report'),
        link('Developer Lab — Notification Diagnostics', '/developer-lab#notification-diagnostics', 'developer'),
      ],
      data_mode: 'live',
    },
  );
}

function buildReportLifecycle(): WorkflowExplainerAnswer {
  return answer(
    'report_lifecycle',
    'Report lifecycle',
    'A BMEDIS report combines live operational rows with refreshed snapshots. The generated_at timestamp is the moment the report fetcher ran; data_snapshot_at refers to the last analytics refresh.',
    {
      key_findings: [
        '/reports/[type] uses reports.service.ts to load rows under RLS, then buildReportKPIs builds the KPI strip using canonical-metrics.ts.',
        'Dashboard vs report: canonical-metrics shares compute between dashboards and reports so a value mismatch usually means one side is reading a stale snapshot.',
        'CSV/PDF exports include 4 metadata header rows: report, institution, snapshot generated, source.',
        'Privileged reports (audit-trail, offline-sync-evidence, qr-scan-evidence, qr-coverage) are server-rendered and admin-only.',
      ],
      recommended_actions: [
        'Always quote generated_at when presenting a report.',
        'If a report differs from the dashboard, run Developer Lab refresh and re-compare.',
      ],
      source_tables: ['canonical-metrics', 'reports.service', 'audit_logs'],
      links: [link('Reports', '/reports', 'report')],
      data_mode: 'snapshot',
    },
  );
}

/* ------------------------------------------------------------------ */
/* T4 — Formula explainers                                            */
/* ------------------------------------------------------------------ */

function buildFormulaRpn(): WorkflowExplainerAnswer {
  return answer(
    'formula_rpn',
    'RPN — Risk Priority Number',
    'RPN = Severity × Occurrence × Detectability. It is an FMEA-style score per failure mode and asset.',
    {
      key_findings: [
        'Severity (1–10): clinical/operational impact of the failure.',
        'Occurrence (1–10): how often the failure happens in service.',
        'Detectability (1–10): how easily the failure is detected before reaching a patient (higher = harder to detect).',
        'Source: equipment_risk_scores. computeRPN() in src/utils/analytics/formulas.ts. SQL equivalent in migration 00011.',
        'RPN ≠ RPI. RPN is failure-mode risk; RPI is replacement priority.',
      ],
      recommended_actions: ['Open /command (Risk) or /equipment/[id] for the live RPN.'],
      source_tables: ['equipment_risk_scores'],
      data_mode: 'snapshot',
    },
  );
}

function buildFormulaRpi(): WorkflowExplainerAnswer {
  return answer(
    'formula_rpi',
    'RPI — Replacement Priority Index',
    'RPI is a weighted sum of normalized criteria × 100. It is advisory; the BME Head still makes the call.',
    {
      key_findings: [
        'Weights: Availability 20%, Age 15%, Failure rate 15%, Maintenance burden 15%, Risk/RPN 15%, Spare parts 10%, Cost 10%.',
        'Normalization: min-max within the active asset pool.',
        'Stored in replacement_priority_scores. weights_profile_id IS NULL = canonical computed row.',
        'Decision thresholds (prototype): ≥0.70 strong, ≥0.55 review, <0.55 monitor.',
      ],
      recommended_actions: ['Open the per-asset evidence at /command/drilldown/replacement/[assetId].'],
      source_tables: ['replacement_priority_scores', 'v_replacement_decision'],
      data_mode: 'snapshot',
    },
  );
}

function buildFormulaMttr(): WorkflowExplainerAnswer {
  return answer(
    'formula_mttr',
    'MTTR — Mean Time To Repair',
    'MTTR = total repair time / number of repairs.',
    {
      key_findings: [
        'Sources: maintenance_events.repair_duration_hours rows linked to corrective work_orders.',
        'No reliability evidence on WO completion → MTTR for that asset will not change (Phase 2 R2).',
        'SQL: fn_compute_mttr in migration 00011.',
      ],
      recommended_actions: ['Always supply repair_duration_hours when completing corrective WOs.'],
      source_tables: ['maintenance_events', 'equipment_reliability_metrics'],
      data_mode: 'live',
    },
  );
}

function buildFormulaMtbf(): WorkflowExplainerAnswer {
  return answer(
    'formula_mtbf',
    'MTBF — Mean Time Between Failures',
    'MTBF = total operational time / number of failures.',
    {
      key_findings: [
        'Failure events come from maintenance_events with failure_date set.',
        'downtime_logs (derived by trigger from maintenance_events) provides the duration arithmetic.',
        'SQL: fn_compute_mtbf in migration 00011. MTBF date-extract bug fixed in 00020.',
      ],
      recommended_actions: ['Record failure_date + downtime_start/downtime_end on every corrective WO that completes.'],
      source_tables: ['maintenance_events', 'downtime_logs', 'equipment_reliability_metrics'],
      data_mode: 'live',
    },
  );
}

function buildFormulaAvailability(): WorkflowExplainerAnswer {
  return answer(
    'formula_availability',
    'Availability',
    'Availability = MTBF / (MTBF + MTTR). Expressed as a fraction or percentage.',
    {
      key_findings: [
        'Requires both MTBF and MTTR to be non-null; otherwise availability is left null.',
        'Stored in equipment_reliability_metrics (one row per asset).',
        '"100% (no failures)" is the right phrasing when failure_count = 0 — do not invent "0% availability".',
      ],
      recommended_actions: ['If availability is null, log a corrective WO with reliability evidence to seed MTBF/MTTR.'],
      source_tables: ['equipment_reliability_metrics', 'maintenance_events', 'downtime_logs'],
      data_mode: 'live',
    },
  );
}

function buildFormulaPmCompliance(): WorkflowExplainerAnswer {
  return answer(
    'formula_pm_compliance',
    'PM compliance',
    'PM Compliance = completed scheduled PM tasks ÷ total scheduled PM tasks × 100. Skipped or deferred PM is tracked separately and does NOT count as completed.',
    {
      key_findings: [
        'Per-department row in pm_compliance_metrics (grain enforced by unique constraint, dedupe in migration 00029).',
        'v_overdue_pm carries asset_id + department_id (migration 00044).',
        'Refresh: recompute_all_equipment_analytics() (migration 00027 baseline backfill).',
      ],
      recommended_actions: ['Open /pm to see compliance by department.'],
      source_tables: ['pm_compliance_metrics', 'pm_schedules', 'pm_completions', 'v_overdue_pm'],
      data_mode: 'snapshot',
    },
  );
}

function buildFormulaCalibrationCompliance(): WorkflowExplainerAnswer {
  return answer(
    'formula_calibration_compliance',
    'Calibration compliance / risk',
    'Compliance counts pass calibration_records within the calibration_types.interval_months window. Risk rises when results are fail / adjusted or when records are overdue.',
    {
      key_findings: [
        'Overdue derived from v_calibration_due (days_until_due < 0).',
        'Failed / adjusted: createCalibrationRecordAction emits calibration.failed_or_adjusted.',
      ],
      recommended_actions: ['Use /calibration triage tabs (overdue / failed-or-adjusted / awaiting action).'],
      source_tables: ['calibration_records', 'calibration_requests', 'v_calibration_due'],
      data_mode: 'live',
    },
  );
}

function buildFormulaEquipmentHealth(): WorkflowExplainerAnswer {
  return answer(
    'formula_equipment_health',
    'Equipment health',
    'Equipment health is a composite score combining condition, recent failures, PM compliance, calibration status, and reliability. Stored as a snapshot per asset.',
    {
      key_findings: [
        'Snapshot rows in equipment_reliability_metrics and equipment_risk_scores.',
        'Live signals: equipment_assets.condition + open work orders + open maintenance_requests.',
      ],
      recommended_actions: ['Open /equipment/[id] for the live composite view.'],
      source_tables: ['equipment_assets', 'equipment_risk_scores', 'equipment_reliability_metrics'],
      data_mode: 'snapshot',
    },
  );
}

function buildFormulaDepartmentReadiness(): WorkflowExplainerAnswer {
  return answer(
    'formula_department_readiness',
    'Department / clinical readiness',
    'Department readiness is the share of essential equipment that is functional in a department, derived from clinical_readiness_snapshots and live equipment_assets.',
    {
      key_findings: [
        'Source: clinical_readiness_snapshots (snapshot) + live equipment_assets condition for unrefreshed rows.',
        'Department-scoped: department_head and department_user see only their own row.',
      ],
      recommended_actions: ['Open /command or /command/triage for the live readiness view.'],
      source_tables: ['clinical_readiness_snapshots', 'equipment_assets'],
      data_mode: 'snapshot',
    },
  );
}

function buildFormulaCriticalActionScore(): WorkflowExplainerAnswer {
  return answer(
    'formula_critical_action_score',
    'Critical Action Score',
    'Critical Action Score blends category weight and urgency band. Order (high→low): corrective(100), needs_request(90), calibration(85), pm(75), stock(70), risk_watch(65), installation(60), replacement(55), procurement(45), training(35).',
    {
      key_findings: [
        'Urgency bands: ≥180 critical, ≥150 high, ≥100 medium, else low.',
        'Source: src/utils/analytics/critical-action-bands.ts (canonical, used by Command Center + tests + Copilot).',
        'Used by buildCriticalActions() in Command Center.',
      ],
      recommended_actions: ['Open /command — Critical Action Score drives the priority strip and triage list.'],
      source_tables: ['critical-action-bands.ts', 'command-center-data.ts'],
      data_mode: 'live',
    },
  );
}

function buildFormulaStockBlocker(): WorkflowExplainerAnswer {
  return answer(
    'formula_stock_blocker_priority',
    'Stock blocker priority',
    'Stock blockers are ranked primarily by declared work_order_parts_needed (open). Historical maintenance_parts_used linkage is a secondary signal.',
    {
      key_findings: [
        'Primary: open work_order_parts_needed rows linked to active corrective WOs.',
        'Secondary: low-stock or stockout rows from spare_parts (current_stock vs reorder_level).',
        'Procurement linkage closes the loop: specification_requests.procurement_request_id.',
      ],
      recommended_actions: ['Open /spare-parts → Stock Action Queue, or /command (Stock Blockers).'],
      source_tables: ['work_order_parts_needed', 'spare_parts', 'work_orders'],
      data_mode: 'live',
    },
  );
}

function buildFormulaProcurementDelay(): WorkflowExplainerAnswer {
  return answer(
    'formula_procurement_delay',
    'Procurement delay priority',
    'Procurement delay uses expected_delivery_date and the days past due. A 1-day-past-due request can outrank a 90-day-old request that is still future-dated.',
    {
      key_findings: [
        'scoreProcurementDelay() returns isDelayed, daysPastDue, ageDays, usedFallback, urgency, score (Phase 4 R10).',
        'Terminal statuses (delivered / canceled) score 0.',
        'If expected_delivery_date is missing, the scorer falls back to age and labels usedFallback=true.',
      ],
      recommended_actions: ['Keep expected_delivery_date accurate; it drives the delay score.'],
      source_tables: ['procurement_requests'],
      data_mode: 'live',
    },
  );
}

function buildFormulaTechnicianWorkload(): WorkflowExplainerAnswer {
  return answer(
    'formula_technician_workload',
    'Technician workload',
    'fetchCurrentTechnicianWorkload() in src/services/metrics/workload.service.ts is the single canonical source. Status thresholds: overloaded ≥6 open, busy ≥3, available <3.',
    {
      key_findings: [
        'Reads work_orders (open / assigned / in_progress / on_hold) joined to assignees.',
        'workload_capacity_snapshots is historical-trend-only and is not read by any service.',
        'Tests lock the thresholds (Phase 3 R29).',
      ],
      recommended_actions: ['Open /command (Workload Assignment) to see the live status per technician.'],
      source_tables: ['work_orders', 'profiles'],
      data_mode: 'live',
    },
  );
}

function buildFormulaOfflineConflictStatus(): WorkflowExplainerAnswer {
  return answer(
    'formula_offline_conflict_status',
    'Offline conflict & resolution status',
    'Conflict types map to resolution_status transitions. Each conflict row keeps the original payload — no destructive cleanup.',
    {
      key_findings: [
        'Conflict types: asset_missing, asset_deleted, department_scope_mismatch, duplicate_open_request, work_order_completed, work_order_status_changed, insufficient_stock, procurement_state_changed, stock_already_received, unsupported_action, permission_denied, stale_server_state, unknown_sync_error, invalid_payload, part_missing, part_inactive.',
        'Resolution statuses: conflict, under_review, resolved_synced, resolved_discarded, resolved_manual.',
        'Mapping to legacy sync_status: conflict/under_review/resolved_discarded → failed; resolved_synced + synced → synced.',
      ],
      recommended_actions: ['Open /offline-sync to review, retry, or discard.'],
      source_tables: ['offline_sync_events'],
      data_mode: 'live',
    },
  );
}

/* ------------------------------------------------------------------ */
/* T5 — Notification / Telegram                                       */
/* ------------------------------------------------------------------ */

function buildNotificationDeliveryExplainer(): WorkflowExplainerAnswer {
  return answer(
    'notification_delivery_explainer',
    'Why you got this notification',
    'A notification fires when an operational event matches a notification rule that targets your role (and department if scoped). The notification row records the event id, recipient, priority, category, and a deep-link action.',
    {
      key_findings: [
        'Trigger: server action emits a notification_events row via emitNotificationEvent.',
        'Fan-out: processNotificationEvent reads notification rules and writes one notifications row per matching recipient.',
        'Telegram (if eligible) is delivered through notification_deliveries.',
        '10-min dedupe key prevents repeats.',
      ],
      recommended_actions: ['Open /notifications and use the action link. Check Developer Lab → Notification Diagnostics for the full delivery log.'],
      source_tables: ['notification_events', 'notifications', 'notification_deliveries'],
      links: [link('Notification Center', '/notifications', 'report')],
      data_mode: 'live',
    },
  );
}

function buildTelegramEligibilityExplainer(): WorkflowExplainerAnswer {
  return answer(
    'telegram_eligibility_explainer',
    'Telegram delivery eligibility',
    'Telegram is an external delivery channel and never an authorization plane. Eligibility depends on env config, recipient connection, priority, and source type.',
    {
      key_findings: [
        'Env: TELEGRAM_NOTIFICATIONS_ENABLED, TELEGRAM_BOT_TOKEN must be set (server-only).',
        'Always-eligible source types: work_order.assigned, work_order.stock_blocked, offline_sync.conflict, spare_part.stockout, qr.label_needs_replacement, qr.revoked_scanned, system.test_notification, notification.rule_failed.',
        'Otherwise: priority ≥ TELEGRAM_MIN_PRIORITY (default "high").',
        'no_chat_id: recipient profile has no active telegram_connections.',
        'not_eligible: priority/source filtered out before sending.',
        'provider_failed: Telegram Bot API non-2xx response.',
        'Monitor mode (TELEGRAM_DEV_MONITOR_ENABLED): every eligible notification also delivers a monitor copy with the real recipient.',
      ],
      recommended_actions: ['Use Developer Lab → Notification Diagnostics for the per-role connection table and last 20 deliveries.'],
      source_tables: ['telegram_connections', 'notification_deliveries'],
      links: [link('Developer Lab — Notifications', '/developer-lab#notification-diagnostics', 'developer')],
      data_mode: 'live',
    },
  );
}

function buildNotificationRuleExplainer(): WorkflowExplainerAnswer {
  return answer(
    'notification_rule_explainer',
    'Notification rule check',
    'Scheduled rule checks scan for state-based events (overdue PM, aging WO, low stock, calibration overdue). Each scan logs its result in notification_rule_logs.',
    {
      key_findings: [
        'Phase 5 R1/R20 fix: column names and view sources were corrected (v_overdue_pm.id, v_open_work_orders.id, spare_parts.reorder_level, v_calibration_due).',
        'Each rule scan is independent; an error in one no longer masks the others.',
        'runNotificationRuleCheck returns per-scan { ruleId, scanned, eventsCreated, error }.',
      ],
      recommended_actions: ['Run the rule check from Developer Lab and review notification_rule_logs.'],
      source_tables: ['notification_rule_logs', 'v_overdue_pm', 'v_open_work_orders', 'spare_parts', 'v_calibration_due'],
      links: [link('Developer Lab', '/developer-lab', 'developer')],
      data_mode: 'live',
    },
  );
}

function buildNotificationDedupeExplainer(): WorkflowExplainerAnswer {
  return answer(
    'notification_dedupe_explainer',
    'Notification dedupe',
    'The notification engine dedupes within a 10-minute cooldown keyed by recipient + event type + source. Repeats are merged into the existing notification; Telegram is suppressed unless priority increases to critical.',
    {
      key_findings: [
        'Dedupe key includes recipient_id, event_type, source_type, source_id.',
        'When a duplicate event arrives, the existing notifications row is touched (metadata.count incremented).',
        'Telegram fires again only if priority increases to critical.',
      ],
      recommended_actions: ['Open Notification Center; duplicates show a "Updated N times" footer.'],
      source_tables: ['notifications'],
      data_mode: 'live',
    },
  );
}

/* ------------------------------------------------------------------ */
/* T6 — QR / offline / report / validation                            */
/* ------------------------------------------------------------------ */

function buildQrExplainer(): WorkflowExplainerAnswer {
  return answer(
    'qr_explainer',
    'QR scan / coverage explanation',
    'QR labels go through generated → printed → attached → (optionally needs_replacement | revoked). Scanning loads the asset page when the token is valid and the user has scope.',
    {
      key_findings: [
        'Label status: equipment_assets.qr_label_status drives the coverage card.',
        'Ready-to-scan = attached + not revoked.',
        'Scanning twice within 5 minutes is deduped at the scan-evidence layer (logQrScan dedup window).',
        'Revoked + scanned → qr.revoked_scanned notification (developer / admin / BME Head). The asset is not exposed to the scanner.',
        'Reports: /reports/qr-coverage (lifecycle) and /reports/qr-scan-evidence (scan activity).',
      ],
      recommended_actions: ['/equipment/qr-coverage shows the live coverage breakdown.'],
      source_tables: ['equipment_assets', 'equipment_qr_scans'],
      links: [link('QR Coverage', '/equipment/qr-coverage', 'qr')],
      data_mode: 'live',
    },
  );
}

function buildOfflineCanIDoThis(): WorkflowExplainerAnswer {
  return answer(
    'offline_can_i_do_this',
    'Can I do this offline?',
    'Some workflows queue offline and replay on reconnect; high-authority workflows stay online-only by design.',
    {
      key_findings: [
        'Offline-capable (queues for foreground replay): maintenance request create, department issue report, maintenance event log, QR note, calibration request, training request, store reorder, stock receipt/issue drafts, work-order start intent, work-order completion draft.',
        'Online-only: procurement approval, disposal approval, QR token regeneration / revocation, user / settings / security changes, analytics refresh, final work-order assignment / final closure, replacement decisions.',
        'Cached reads have a 12h freshness window. After that the "Offline cached data — may be stale" banner appears.',
        'Foreground replay = the app must be open and online for the queue to drain. There is no Background Sync API dependency.',
      ],
      recommended_actions: ['When unsure, open /offline-sync to see the queue and conflicts.'],
      source_tables: ['offline_sync_events'],
      links: [link('Sync Review Center', '/offline-sync', 'offline')],
      data_mode: 'live',
    },
  );
}

function buildReportSummaryExplainer(): WorkflowExplainerAnswer {
  return answer(
    'report_summary_explainer',
    'Report summary & alignment',
    'A BMEDIS report is grounded in the canonical metric functions and an explicit generated_at timestamp. Differences from the dashboard usually mean one side is reading a stale snapshot.',
    {
      key_findings: [
        'KPI builder: buildReportKPIs (in ReportTypeClient) uses canonical-metrics: computeEquipmentConditionStats, computePMComplianceStats, computeCalibrationComplianceStats, computeWorkOrderStats, computeMaintenanceEventStats.',
        'generated_at and snapshotTs appear in the print header + CSV/PDF metadata.',
        'Privileged reports (audit-trail, qr-scan-evidence, qr-coverage, offline-sync-evidence) are admin-only.',
      ],
      recommended_actions: ['Before presenting, refresh decision-support snapshots if numbers look stale, and quote generated_at.'],
      source_tables: ['canonical-metrics.ts', 'reports.service.ts'],
      links: [link('Reports', '/reports', 'report')],
      data_mode: 'snapshot',
    },
  );
}

function buildValidationReadinessExplainer(): WorkflowExplainerAnswer {
  return answer(
    'validation_readiness_explainer',
    'Validation readiness',
    'validation-readiness.service.ts probes 9 workflow fixtures and reports present / missing / unknown. Developer Lab surfaces missing fixtures so evaluators see honest "needs data" instead of "feature broken".',
    {
      key_findings: [
        'Probes: overdue_pm, aging_work_order, stockout_part, failed_calibration, delayed_procurement, attached_qr_token, revoked_qr_token, high_rpi_replacement, offline_sync_event.',
        'Each probe ships a fixHint describing how to create the missing fixture.',
        'documents/r35-manual-validation-checklist.md is the deployed-env sign-off checklist (R35).',
      ],
      recommended_actions: [
        'Open Developer Lab and resolve every "missing" fixture before BME evaluation.',
        'Run npm run test:system-fix to confirm the Phase 1–6 invariants still hold.',
      ],
      source_tables: ['validation-readiness.service.ts'],
      links: [link('Developer Lab', '/developer-lab', 'developer')],
      data_mode: 'live',
    },
  );
}

/* ------------------------------------------------------------------ */
/* Entry point                                                        */
/* ------------------------------------------------------------------ */

const BUILDERS: Record<WorkflowExplainerKey, (q: WorkflowExplainerQuery) => WorkflowExplainerAnswer> = {
  maintenance_request_lifecycle: () => buildMaintenanceRequestLifecycle(),
  work_order_lifecycle: () => buildWorkOrderLifecycle(),
  work_order_completion_reliability: () => buildWorkOrderCompletionReliability(),
  pm_lifecycle: () => buildPmLifecycle(),
  calibration_lifecycle: () => buildCalibrationLifecycle(),
  stock_procurement_lifecycle: () => buildStockProcurementLifecycle(),
  replacement_rpi_lifecycle: () => buildReplacementRpiLifecycle(),
  qr_lifecycle: () => buildQrLifecycle(),
  offline_lifecycle: () => buildOfflineLifecycle(),
  notification_telegram_lifecycle: () => buildNotificationTelegramLifecycle(),
  report_lifecycle: () => buildReportLifecycle(),
  formula_rpn: () => buildFormulaRpn(),
  formula_rpi: () => buildFormulaRpi(),
  formula_mttr: () => buildFormulaMttr(),
  formula_mtbf: () => buildFormulaMtbf(),
  formula_availability: () => buildFormulaAvailability(),
  formula_pm_compliance: () => buildFormulaPmCompliance(),
  formula_calibration_compliance: () => buildFormulaCalibrationCompliance(),
  formula_equipment_health: () => buildFormulaEquipmentHealth(),
  formula_department_readiness: () => buildFormulaDepartmentReadiness(),
  formula_critical_action_score: () => buildFormulaCriticalActionScore(),
  formula_stock_blocker_priority: () => buildFormulaStockBlocker(),
  formula_procurement_delay: () => buildFormulaProcurementDelay(),
  formula_technician_workload: () => buildFormulaTechnicianWorkload(),
  formula_offline_conflict_status: () => buildFormulaOfflineConflictStatus(),
  notification_delivery_explainer: () => buildNotificationDeliveryExplainer(),
  telegram_eligibility_explainer: () => buildTelegramEligibilityExplainer(),
  notification_rule_explainer: () => buildNotificationRuleExplainer(),
  notification_dedupe_explainer: () => buildNotificationDedupeExplainer(),
  qr_explainer: () => buildQrExplainer(),
  offline_can_i_do_this: () => buildOfflineCanIDoThis(),
  report_summary_explainer: () => buildReportSummaryExplainer(),
  validation_readiness_explainer: () => buildValidationReadinessExplainer(),
};

export function buildWorkflowExplainerAnswer(query: WorkflowExplainerQuery): WorkflowExplainerAnswer | null {
  const key = detectWorkflowExplainerKey(query.message);
  if (!key) return null;
  const builder = BUILDERS[key];
  return builder(query);
}

/**
 * Convert an explainer answer to AssistantContent for the orchestrator.
 * The orchestrator uses this as the deterministic candidate (skeleton for
 * Gemini) and as a final answer when the provider is unavailable.
 */
export function workflowExplainerToAssistant(
  explainer: WorkflowExplainerAnswer,
  decision: ChatDecision = 'answer',
): AssistantContent {
  return {
    decision,
    title: explainer.title,
    intelligence_mode: 'standard',
    summary: explainer.summary,
    key_findings: explainer.key_findings,
    recommended_actions: explainer.recommended_actions,
    priority_reasoning: explainer.priority_reasoning,
    likely_causes: [],
    troubleshooting_steps: [],
    maintenance_tips: [],
    required_tools_or_parts: [],
    actions: [],
    insights: [],
    recommendations: [],
    entities_referenced: [],
    follow_up_suggestions: [],
    proactive_signals: [],
    routing_explanation: [`Workflow explainer matched: ${explainer.key}.`],
    evidence_used: explainer.evidence_used,
    links: explainer.links,
    limitations: explainer.limitations,
    missingDataFlags: [],
    data_freshness: explainer.data_freshness,
    data_mode: explainer.data_mode,
    data_age_label: undefined,
    source_tables: explainer.source_tables,
    action_drafts: [],
    answer_basis: 'system_data',
    confidence: 'high',
    escalation_required: false,
  };
}
