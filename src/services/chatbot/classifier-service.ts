import type {
  CapabilityId,
  ChatIntent,
  ClassifiedRequest,
  ConfidenceLevel,
  MemoryRoutingHint,
} from '@/types/chatbot';
import { detectPromptInjection, detectUnsafeBiomedical } from './prompt-injection-guard';

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
  /\berror message\b/i,
  /\balarm\b/i,
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
    intent: 'work_order_status',
    patterns: [
      /\bopen work orders?\b/i,
      /\bwork orders?\b.*\b(need attention|urgent|overdue|open|pending|active|status)\b/i,
      /\bwhich work orders?\b/i,
      /\bwo[-\s]?\d+\b/i,
    ],
  },
  {
    intent: 'maintenance_status',
    patterns: [
      /\bmaintenance (status|history|requests?|backlog|queue)\b/i,
      /\bopen maintenance\b/i,
      /\bmaintenance requests?\b.*\b(status|pending|open|need attention)\b/i,
    ],
  },
  {
    intent: 'asset_summary',
    patterns: [
      /\bsummari[sz]e\b(?!.*\b(command center|hospital|readiness|report|work orders?|wo[-\s]?\d+)\b).*\b(asset|equipment|device|monitor|patient monitor|ultrasound|ventilator|analy[sz]er|pump|defibrillator|[A-Z]{2,}[-\s]?\d{2,})\b/i,
      /\b(tell me about|what is the status of|status of|details? for|what should i know about)\b.*\b(this\s+)?(asset|equipment|device|monitor|patient monitor|ultrasound|ventilator|analy[sz]er|pump|defibrillator|[A-Z]{2,}[-\s]?\d{2,})\b/i,
      /\bcurrent status\b.*\b(asset|equipment|device|monitor|patient monitor|ultrasound|ventilator|analy[sz]er|pump|defibrillator|[A-Z]{2,}[-\s]?\d{2,})\b/i,
      /\bwhat is\b.*\b(failure count|status|condition)\b.*\b(this\s+)?(asset|equipment|device|monitor|patient monitor|ultrasound|ventilator|analy[sz]er|pump|defibrillator|[A-Z]{2,}[-\s]?\d{2,})\b/i,
      /^\s*summari[sz]e\s+[A-Z]{2,}[-\s]?\d{2,}\s*$/i,
    ],
  },
  {
    intent: 'inventory_search',
    patterns: [
      /\b(which|list|show|find|how many)\b.*\b(equipment|assets?|devices?|units?|monitors?|patient monitors?|ultrasounds?|ventilators?|pumps?|analy[sz]ers?|defibrillators?)\b.*\b(in|for|at|within)\b.*\b(ed|icu|emergency|department|ward|unit)\b/i,
      /\blist\b.*\b(ed|icu|emergency|department|ward|unit)\b.*\b(equipment|assets?|devices?|units?|monitors?|patient monitors?|ultrasounds?|ventilators?|pumps?|analy[sz]ers?|defibrillators?)\b/i,
    ],
  },
  {
    intent: 'equipment_history',
    patterns: [
      /\b(show|summari[sz]e|give me)\b.*\b(failure|fault|maintenance|repair|service)\s+history\b.*\b(this\s+)?(asset|equipment|device|monitor|patient monitor|ultrasound|ventilator|analy[sz]er|pump|defibrillator|[A-Z]{2,}[-\s]?\d{2,})\b/i,
      /\b(failure|fault|maintenance|repair|service)\s+history\b.*\b(this\s+)?(asset|equipment|device|monitor|patient monitor|ultrasound|ventilator|analy[sz]er|pump|defibrillator|[A-Z]{2,}[-\s]?\d{2,})\b/i,
    ],
  },
  {
    intent: 'preventive_maintenance',
    patterns: [
      /\boverdue pm\b/i,
      /\bpreventive maintenance\b/i,
      /\bpm (tasks?|plans?|schedules?|status|compliance|overdue)\b/i,
      /\bwhich pm\b/i,
    ],
  },
  {
    intent: 'calibration_status',
    patterns: [
      /\bcalibration\b.*\b(due|overdue|soon|status|records?|requests?|certificate|result)\b/i,
      /\bwhich equipment needs calibration\b/i,
      /\bcalibrations? (due|overdue|soon)\b/i,
    ],
  },
  {
    intent: 'spare_parts_lookup',
    patterns: [
      /\bspare parts?\b/i,
      /\bpart catalog\b/i,
      /\bpart usage\b/i,
      /\bparts? (needed|available|used)\b/i,
    ],
  },
  {
    intent: 'logistics_stock',
    patterns: [
      /\blow stock\b/i,
      /\bstockouts?\b/i,
      /\breorder level\b/i,
      /\bstock (receipts?|issues?|balance|blockers?|risks?)\b/i,
      /\bparts?\b.*\b(blocking|blockers?|blocking work)\b/i,
      /\bwhich parts?\b.*\bblocking work\b/i,
      /\blogistics\b/i,
    ],
  },
  {
    intent: 'procurement_status',
    patterns: [
      /\bprocurement\b/i,
      /\bpurchase requests?\b/i,
      /\bexpected delivery\b/i,
      /\b(delayed|pending|approved|ordered|in transit|in_transit) procurement\b/i,
    ],
  },
  {
    intent: 'training_status',
    patterns: [
      /\btraining\b.*\b(status|requests?|sessions?|coverage|attendance|pending|scheduled)\b/i,
      /\bstaff training\b/i,
      /\bequipment training\b/i,
    ],
  },
  {
    intent: 'disposal_status',
    patterns: [
      /\bdisposal\b.*\b(status|requests?|pipeline|pending|approved|candidate)\b/i,
      /\bend[-\s]?of[-\s]?life\b/i,
      /\bdecommission\b/i,
    ],
  },
  {
    intent: 'replacement_priority',
    patterns: [
      /\breplacement priority\b/i,
      /\breplacement candidates?\b/i,
      /\bconsidered for replacement\b/i,
      /\brpi\b/i,
      /\breplace this equipment\b/i,
    ],
  },
  {
    intent: 'risk_analysis',
    patterns: [
      /\brisk analysis\b/i,
      /\bhighest risk\b/i,
      /\bhigh risk\b/i,
      /\brpn\b/i,
      /\bfmea\b/i,
      /\bwhy\b.*\brisk\b/i,
      /\brisk\b.*\b(explanation|likely causes?|drivers?|factors?)\b/i,
      /\bexplain\b.*\brisk\b/i,
    ],
  },
  {
    intent: 'reliability_metrics',
    patterns: [
      /\bmtbf\b/i,
      /\bmttr\b/i,
      /\bavailability\b/i,
      /\breliability metrics?\b/i,
      /\bhealth score\b/i,
    ],
  },
  {
    intent: 'dashboard_summary',
    patterns: [
      /\bdashboard\b.*\b(summary|signals?|priorities?|status)\b/i,
      /\bsummarize hospital readiness\b/i,
      /\bhospital\b.*\breadiness\b/i,
      /\bhospital readiness\b/i,
      /\bequipment readiness\b/i,
      /\bfleet readiness\b/i,
    ],
  },
  {
    intent: 'decision_support',
    patterns: [
      /\bdecision support\b/i,
      /\btriage queue\b/i,
      /\bcommand center\b/i,
      /\bwhat should (we|i) prioritize\b/i,
      /\bwhat should (we|i) do first\b/i,
    ],
  },
  {
    intent: 'report_help',
    patterns: [/\breports?\b.*\b(help|available|use|explain|summary|export)\b/i, /\bwhich reports?\b/i],
  },
  {
    intent: 'workflow_help',
    patterns: [
      /\bhow do i use (this page|this system|bmedis)\b/i,
      /\bwhat can (this|the) page do\b/i,
      /\bworkflow help\b/i,
      /\bhow do i (create|track|open|request|report)\b/i,
      /\bhelp me report\b/i,
      /\breport a problem\b/i,
      /\bproblem with this equipment\b/i,
      /\bcreate.*maintenance request\b/i,
    ],
  },
  {
    intent: 'maintenance_tip',
    patterns: [/\bpm\b/i, /\bpreventive maintenance\b/i, /\bmaintenance tips?\b/i, /\bchecklist\b/i],
  },
  {
    intent: 'troubleshooting',
    patterns: [
      /\btroubleshoot(?:ing)?\b/i,
      /\bnot working\b/i,
      /\bmalfunctioning\b/i,
      /\bfirst[-\s]?line checks?\b/i,
      /\bwhat should i check (next|first)\b/i,
      /\bwhat should i check first\b/i,
      /\bsafe first[-\s]?line\b/i,
      /\blikely causes?\b/i,
      /\bdiagnose\b.*\b(fault|failure|problem|issue)\b/i,
      /\b(fault|failure|error)\b.{0,40}\b(check|fix|diagnose|troubleshoot|not working|malfunctioning)\b/i,
      /\b(check|fix|diagnose|troubleshoot)\b.{0,40}\b(fault|failure|error|alarm|problem|issue)\b/i,
      /\b(monitor|patient monitor|ultrasound|ventilator|pump|analy[sz]er|defibrillator|device|equipment)\b.{0,50}\b(issue|problem|fault|not working|malfunctioning|broken|not powering|won'?t power|wont power|no power|black screen|blank screen|alarm|image quality|blurry|artifact|artefact)\b/i,
      /\b(issue|problem|fault|not working|malfunctioning|broken|not powering|won'?t power|wont power|no power|black screen|blank screen|alarm|image quality|blurry|artifact|artefact)\b.{0,50}\b(monitor|patient monitor|ultrasound|ventilator|pump|analy[sz]er|defibrillator|device|equipment)\b/i,
      /\balarm\b.*\b(showing|displayed|what do i check|check first)\b/i,
      /\bnot powering|won'?t power|wont power|no power|black screen|blank screen|image quality|artifact|artefact|blurry\b/i,
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
      /\bmetric\b/i,
      /\bdata source\b/i,
      /\btelemetry\b/i,
      /\busage\b/i,
      /\boffline sync\b/i,
      /\bsync conflicts?\b/i,
      /\bqr\b/i,
      /\breport\b/i,
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
    patterns: [
      /\bprioriti[sz]e\b/i,
      /\bwhat should i (do|tackle|review|work on) first\b/i,
      /\bwhat should i prioritize today\b/i,
      /\bwhat should (we|i) prioritize\b/i,
      /\bwhat should (we|i) do first\b/i,
      /\bmost urgent\b/i,
      /\btop priorities?\b/i,
      /\bwhat is urgent\b/i,
      /\bopen work orders?\b.*\b(need attention|urgent|overdue|priority|prioritize)\b/i,
      /\bblocking service\b/i,
      /\bwhere should (we|i) start\b/i,
    ],
    baseScore: 0.74,
  },
  {
    capability: 'summarize_work_order',
    patterns: [
      /\bsummari[sz]e\b.*\bwork order\b/i,
      /\bthis work order\b/i,
      /\btrack my request\b/i,
      /\bstatus of (my|this|the) request\b/i,
      /\bwo[-\s]?\d+\b/i,
      /\bclosure notes?\b/i,
    ],
    baseScore: 0.75,
  },
  {
    capability: 'summarize_equipment',
    patterns: [
      /\bsummari[sz]e\b(?!.*\bhospital\b)(?!.*\breadiness\b)(?!.*\bcommand center\b)(?!.*\breport\b).*\b[A-Z]{2,}[-\s]?\d{2,}\b/i,
      /\bsummari[sz]e\b(?!.*\bhospital\b)(?!.*\breadiness\b).*\b(equipment|asset|device)\b/i,
      /\bstatus\b.*\b(equipment|asset|device)\b/i,
      /\bmaintenance history\b.*\b(equipment|asset|device)\b/i,
      /\b(failure|fault|maintenance|repair|service)\s+history\b.*\b(monitor|patient monitor|ultrasound|ventilator|asset|equipment|device|[A-Z]{2,}[-\s]?\d{2,})\b/i,
      /\bfailure count\b.*\b(monitor|patient monitor|ultrasound|ventilator|asset|equipment|device|[A-Z]{2,}[-\s]?\d{2,})\b/i,
      /\b(which|list|show|find|how many)\b.*\b(units?|monitors?|patient monitors?|ultrasounds?|ventilators?|pumps?|analy[sz]ers?|defibrillators?)\b.*\b(in|for|at|within)\b.*\b(ed|icu|emergency|department|ward|unit)\b/i,
      /\bequipment\b.*\b(history|status|condition)\b/i,
      /\basset\b.*\b(history|status|condition)\b/i,
      /\bstatus of this (asset|device|equipment)\b/i,
      /\bwhat is wrong with this (asset|device|equipment)\b/i,
      /\bwhat should i know\b/i,
      /\bbefore inspection\b/i,
    ],
    baseScore: 0.74,
  },
  {
    capability: 'explain_equipment_risk',
    patterns: [
      /\bhigh(est)? risk\b/i,
      /\brisk analysis\b/i,
      /\brpn\b/i,
      /\bfmea\b/i,
      /\bmtbf\b/i,
      /\bmttr\b/i,
      /\bavailability\b/i,
      /\breliability metrics?\b/i,
      /\bhealth score\b/i,
      /\breplacement priority\b/i,
      /\breplacement candidates?\b/i,
      /\bconsidered for replacement\b/i,
      /\brpi\b/i,
      /\bwhy is .* risk\b/i,
      /\brisk\b.*\b(explanation|likely causes?|drivers?|factors?)\b/i,
      /\bexplain\b.*\brisk\b/i,
    ],
    baseScore: 0.78,
  },
  {
    capability: 'explain_pm_status',
    patterns: [
      /\boverdue pm\b/i,
      /\bpm status\b/i,
      /\bpm compliance\b/i,
      /\bpreventive maintenance status\b/i,
      /\bpreventive maintenance\b.*\b(overdue|tasks?|status|compliance)\b/i,
      /\bcalibration\b.*\b(due|overdue|soon|status|records?|requests?|certificate|result)\b/i,
      /\bwhich equipment needs calibration\b/i,
    ],
    baseScore: 0.74,
  },
  {
    capability: 'safe_troubleshooting',
    patterns: [
      /\btroubleshoot/i,
      /\bcheck first\b/i,
      /\bbefore escalation\b/i,
      /\bsafe checks?\b/i,
      /\bintermittent\b.{0,30}\b(issue|problem|fault|failure|not working|malfunctioning)\b/i,
      /\b(failure|fault|error)\b.{0,40}\b(check|fix|diagnose|troubleshoot|not working|malfunctioning)\b/i,
      /\b(check|fix|diagnose|troubleshoot)\b.{0,40}\b(failure|fault|error|alarm|problem|issue)\b/i,
      /\bnot powering|won'?t power|no power|blank screen|black screen\b/i,
    ],
    baseScore: 0.7,
  },
  {
    capability: 'maintenance_tips',
    patterns: [/\bpm tips?\b/i, /\bmaintenance tips?\b/i, /\bpreventive maintenance tips?\b/i],
    baseScore: 0.72,
  },
  {
    capability: 'logistics_status',
    patterns: [
      /\blogistics\b/i,
      /\blow stock\b/i,
      /\bstockouts?\b/i,
      /\breorder level\b/i,
      /\bstock (receipts?|issues?|balance|blockers?|risks?)\b/i,
      /\bstock blockers?\b/i,
      /\bwhich stockouts? are blocking work\b/i,
      /\bparts?\b.*\b(blocking|blockers?|blocking work)\b/i,
      /\bwhich parts?\b.*\bblocking work\b/i,
      /\bspare parts?\b/i,
      /\binventory\b/i,
    ],
    baseScore: 0.76,
  },
  {
    capability: 'procurement_status',
    patterns: [/\bprocurement\b/i, /\bpipeline\b/i, /\bexpected delivery\b/i, /\bpurchase requests?\b/i, /\b(delayed|pending|approved|ordered|in transit|in_transit) procurement\b/i],
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
    patterns: [
      /\bdepartment readiness\b/i,
      /\breadiness snapshot\b/i,
      /\bclinical readiness\b/i,
      /\bdepartment operational readiness\b/i,
      /\bdashboard\b.*\b(summary|signals?|priorities?|status)\b/i,
      /\bhospital readiness\b/i,
      /\bhospital\b.*\breadiness\b/i,
      /\bequipment readiness\b/i,
      /\bfleet readiness\b/i,
      /\bdecision support\b/i,
      /\btriage queue\b/i,
      /\bcommand center\b/i,
    ],
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
  {
    capability: 'qr_asset_context',
    patterns: [/\bqr\b/i, /\bscan(ned)? asset\b/i, /\bscan evidence\b/i, /\bqr coverage\b/i, /\blabel status\b/i],
    baseScore: 0.8,
  },
  {
    capability: 'offline_sync_status',
    patterns: [/\boffline sync\b/i, /\bsync conflicts?\b/i, /\bconflicts? need review\b/i, /\bfailed sync\b/i, /\breplay queue\b/i],
    baseScore: 0.8,
  },
  {
    capability: 'report_summary',
    patterns: [/\breport summary\b/i, /\bsummari[sz]e.*report\b/i, /\bexplain.*report\b/i, /\bsummari[sz]e this report\b/i, /\breports?\b.*\b(help|available|use|export)\b/i, /\bwhich reports?\b/i],
    baseScore: 0.76,
  },
  {
    capability: 'metric_debug',
    patterns: [/\bwhy.*metric.*0\b/i, /\bwhy.*metric\b/i, /\bdata source feeds\b/i, /\bsource feeds this card\b/i, /\bwhich data source\b/i],
    baseScore: 0.84,
  },
  {
    capability: 'copilot_diagnostics',
    patterns: [/\bcopilot diagnostics?\b/i, /\bgemini smoke test\b/i, /\brun gemini\b/i, /\breview copilot telemetry\b/i, /\bwhy.*classified\b/i],
    baseScore: 0.86,
  },
  {
    capability: 'usage_status',
    patterns: [/\bai usage\b/i, /\bgemini usage\b/i, /\btoken usage\b/i, /\busage limit\b/i],
    baseScore: 0.82,
  },
  {
    capability: 'general_system_fallback',
    patterns: [
      /\bhow do i use (this page|this system|bmedis)\b/i,
      /\bwhat can (this|the) page do\b/i,
      /\bhelp me report\b/i,
      /\breport a problem\b/i,
      /\bproblem with this equipment\b/i,
      /\bcreate.*maintenance request\b/i,
    ],
    baseScore: 0.72,
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
const FOLLOW_UP_FIRST_ITEM = /\bwhy\b.*\b(that|this|it|one)\b.*\bfirst\b/i;
const FOLLOW_UP_NEXT = /\bwhat should i (do|tackle) next\b/i;
const TASK_LIST = /\bturn (that|this|it) into a (task|to-?do|todo) list\b/i;
const HOW_TASK_LIST = /\bhow (do i|to) (turn|make|build)\b.*\b(list|plan)\b/i;

const INTENT_TO_CAPABILITY: Record<ChatIntent, CapabilityId> = {
  assistant_intro: 'assistant_intro',
  general_conversation: 'general_conversation',
  off_topic_safe: 'off_topic_safe',
  general_help: 'assistant_intro',
  workflow_help: 'general_system_fallback',
  maintenance_tip: 'maintenance_tips',
  troubleshooting: 'safe_troubleshooting',
  safe_troubleshooting: 'safe_troubleshooting',
  work_order_help: 'summarize_work_order',
  work_order_status: 'summarize_work_order',
  maintenance_status: 'prioritize_tasks',
  asset_summary: 'summarize_equipment',
  inventory_search: 'summarize_equipment',
  equipment_lookup: 'summarize_equipment',
  equipment_history: 'summarize_equipment',
  analytics_explanation: 'summarize_department_readiness',
  risk_analysis: 'explain_equipment_risk',
  reliability_metrics: 'explain_equipment_risk',
  replacement_priority: 'explain_equipment_risk',
  dashboard_summary: 'summarize_department_readiness',
  decision_support: 'summarize_department_readiness',
  preventive_maintenance: 'explain_pm_status',
  calibration_status: 'explain_pm_status',
  spare_parts_lookup: 'logistics_status',
  logistics_stock: 'logistics_status',
  procurement_status: 'procurement_status',
  training_status: 'training_status',
  disposal_status: 'disposal_status',
  report_help: 'report_summary',
  calibration_or_logistics: 'logistics_status',
  too_detailed: 'unsafe_or_restricted',
  unsafe: 'unsafe_or_restricted',
  unsafe_request: 'unsafe_or_restricted',
  out_of_scope: 'unsafe_or_restricted',
  insufficient_context: 'general_system_fallback',
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

  const injection = detectPromptInjection(normalized);
  if (injection.isInjection) {
    reasons.push(`Detected prompt-injection or role-override signal (${injection.category}).`);
    matchedSignals.push(`prompt_injection:${injection.matchedSignal ?? injection.category}`);
    return buildResult('unsafe', {
      capability: 'unsafe_or_restricted',
      confidence: 0.97,
      confidenceLabel: 'high',
      troubleshootingSubtype: 'none',
      specificity: 'unsafe',
      fallbackReason: 'unsafe_query',
    });
  }

  const unsafeBiomedical = detectUnsafeBiomedical(normalized);
  if (unsafeBiomedical.isUnsafe || UNSAFE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    if (unsafeBiomedical.isUnsafe) {
      reasons.push(`Detected unsafe biomedical request (${unsafeBiomedical.category}).`);
      matchedSignals.push(`unsafe_biomedical:${unsafeBiomedical.matchedSignal ?? unsafeBiomedical.category}`);
    } else {
      reasons.push('Detected unsafe internal repair or bypass language.');
      matchedSignals.push('unsafe_pattern');
    }
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
    reasons.push('Matched BMEDIS assistant intro / help intent.');
    matchedSignals.push('assistant_intro');
    return buildResult('assistant_intro', {
      capability: 'assistant_intro',
      confidence: 0.95,
      confidenceLabel: 'high',
      fallbackReason: undefined,
      candidates: [{ capability: 'assistant_intro', confidence: 0.95, reasons: ['BMEDIS assistant intro heuristics.'] }],
    });
  }

  if (
    topCandidate &&
    ['copilot_diagnostics', 'metric_debug', 'usage_status'].includes(topCandidate.capability)
  ) {
    reasons.push(`Matched high-confidence ${topCandidate.capability.replace(/_/g, ' ')} signal.`);
    matchedSignals.push(topCandidate.capability);
    return buildResult('analytics_explanation', {
      capability: topCandidate.capability,
      confidence: topCandidate.confidence,
      confidenceLabel: toConfidenceLabel(topCandidate.confidence),
      fallbackReason: undefined,
    });
  }

  if (/\b(earlier|previous|we said|discussed)\b/i.test(normalized) && /\b(summari[sz]e|compare|same issue|what should)\b/i.test(normalized)) {
    reasons.push('Follow-up over previous context; keep memory route instead of generic troubleshooting.');
    matchedSignals.push('memory_follow_up_context');
    return buildResult(hint?.threadIntent ?? 'general_conversation', {
      capability: hint?.activeCapability ?? 'my_tasks',
      confidence: Math.max(0.74, topCandidate?.confidence ?? 0),
      confidenceLabel: 'medium',
      specificity: 'general',
      fallbackReason: hint?.activeCapability ? undefined : 'low_confidence_match',
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

      if (intentPattern.intent === 'work_order_status') {
        const hasSpecificWorkOrder = /\b(?:work order\s*)?wo[-\s]?\d+\b/i.test(normalized);
        if (hasSpecificWorkOrder) {
          matchedSignals.push('specific_work_order_status');
          return buildResult(intentPattern.intent, {
            capability: 'summarize_work_order',
            confidence: Math.max(0.82, topCandidate?.confidence ?? 0),
            confidenceLabel: 'high',
            fallbackReason: undefined,
            specificity: 'specific',
          });
        }

        matchedSignals.push('work_order_queue_status');
        return buildResult(intentPattern.intent, {
          capability: topCandidate?.capability === 'summarize_work_order' ? 'summarize_work_order' : 'prioritize_tasks',
          confidence: Math.max(0.74, topCandidate?.confidence ?? 0),
          confidenceLabel: toConfidenceLabel(Math.max(0.74, topCandidate?.confidence ?? 0)),
          specificity: 'general',
        });
      }

      return buildResult(intentPattern.intent, {
        capability: topCandidate?.capability ?? INTENT_TO_CAPABILITY[intentPattern.intent] ?? 'general_system_fallback',
        specificity: 'general',
      });
    }
  }

  if ((FOLLOW_UP_PRIORITIZE.test(normalized) || FOLLOW_UP_FIRST_ITEM.test(normalized)) && (hint?.activeCapability || isShortFollowUp(normalized))) {
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

  reasons.push('Defaulted to neutral BMEDIS help instead of maintenance guidance.');
  matchedSignals.push('default_general_fallback');

  if (hint?.activeCapability && isShortFollowUp(normalized) && ambiguous) {
    matchedSignals.push('memory_capability_bias');
    return buildResult(hint.threadIntent ?? 'general_conversation', {
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

  return buildResult('general_conversation', {
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
