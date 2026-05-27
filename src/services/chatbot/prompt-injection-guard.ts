/**
 * Prompt-injection and unsafe biomedical request detection for BMEDIS Copilot.
 *
 * Two responsibilities:
 *   1. Detect prompt-injection / role-override attempts ("ignore previous
 *      instructions", "pretend you are admin", "act as developer", etc.).
 *   2. Detect unsafe biomedical operational requests (alarm bypass, service
 *      mode, firmware patch, internal board repair, unauthorized cross-
 *      department access, etc.).
 *
 * The detector is purely lexical — high recall, broad matching — and is
 * intentionally conservative. False positives are routed to a constrained
 * "safe first-line checks + escalation" reply rather than a dead-end refusal.
 *
 * Wiring:
 *   - classifier-service.ts pulls in the unsafe-pattern list to drive the
 *     existing `intent='unsafe'` route.
 *   - safety-service.ts uses `evaluateUnsafeOrInjectionMessage` to produce
 *     useful refusal copy with a safe alternative path.
 */

export type PromptInjectionCategory =
  | 'role_override'
  | 'admin_impersonation'
  | 'cross_department_request'
  | 'safety_bypass_pretext'
  | 'instruction_override'
  | 'none';

export type UnsafeBiomedicalCategory =
  | 'alarm_bypass'
  | 'sensor_bypass'
  | 'protection_bypass'
  | 'service_mode_workaround'
  | 'internal_board_repair'
  | 'firmware_patch'
  | 'calibration_shortcut'
  | 'unsafe_use_despite_alarm'
  | 'clinical_patient_diagnosis'
  | 'none';

export interface PromptInjectionResult {
  isInjection: boolean;
  category: PromptInjectionCategory;
  matchedSignal: string | null;
}

export interface UnsafeBiomedicalResult {
  isUnsafe: boolean;
  category: UnsafeBiomedicalCategory;
  matchedSignal: string | null;
}

const PROMPT_INJECTION_PATTERNS: Array<{
  pattern: RegExp;
  category: PromptInjectionCategory;
  signal: string;
}> = [
  // Direct instruction-override (most common LLM injection)
  { pattern: /\bignore\s+(all\s+)?(previous|prior|earlier|above)\s+(instructions?|rules?|prompts?|messages?)\b/i, category: 'instruction_override', signal: 'ignore_previous_instructions' },
  { pattern: /\bignore\s+your\s+(role|system)\s+rules?\b/i, category: 'instruction_override', signal: 'ignore_role_rules' },
  { pattern: /\bdisregard\s+(the|all|any|your)\s+(instructions?|rules?|system\s+prompt|guidelines?)\b/i, category: 'instruction_override', signal: 'disregard_instructions' },
  { pattern: /\bforget\s+(everything|all|the|your)\s+(instructions?|rules?|context|system\s+prompt)\b/i, category: 'instruction_override', signal: 'forget_instructions' },
  { pattern: /\bnew\s+(instructions?|system\s+prompt)\s*[:\-]/i, category: 'instruction_override', signal: 'new_instructions_directive' },
  { pattern: /\bsystem\s*prompt\s*[:\-]\s*[a-z]/i, category: 'instruction_override', signal: 'system_prompt_injection' },

  // Pretext-based safety-bypass (checked early so it does not get masked by
  // generic "bypass restriction" matches in role_override).
  { pattern: /\b(?:the\s+)?manual\s+says\s+(?:i|we)\s+can\s+(?:bypass|disable|override|skip)/i, category: 'safety_bypass_pretext', signal: 'manual_says_bypass' },
  { pattern: /\bwe\s+have\s+permission\s+to\s+(?:disable|bypass|override|skip|silence|turn\s+off)\b/i, category: 'safety_bypass_pretext', signal: 'we_have_permission_to_bypass' },
  { pattern: /\b(?:my\s+)?(?:supervisor|manager|head|admin|engineer)\s+(?:said|told\s+me|approved)\s+.*\b(?:bypass|disable|override|skip|ignore)/i, category: 'safety_bypass_pretext', signal: 'authority_said_bypass' },

  // Role override / impersonation
  { pattern: /\bpretend\s+(?:you\s+are|to\s+be|that\s+you\s+are|you\s+to\s+be)\s+(?:an?\s+)?(?:admin|administrator|developer|bme[\s_-]?head|root|superuser|owner)\b/i, category: 'admin_impersonation', signal: 'pretend_admin_or_dev' },
  { pattern: /\bact\s+(as|like)\s+(an?\s+)?(admin|administrator|developer|bme[\s_-]?head|root|superuser|owner|technician\s+with\s+admin|dba|service\s+engineer)\b/i, category: 'admin_impersonation', signal: 'act_as_admin_or_dev' },
  { pattern: /\b(you\s+are|you\s*'?re)\s+now\s+(an?\s+)?(admin|administrator|developer|bme[\s_-]?head|root|superuser)\b/i, category: 'admin_impersonation', signal: 'you_are_now_admin' },
  { pattern: /\bimpersonat(e|ing)\s+(an?\s+)?(admin|developer|bme[\s_-]?head|technician|department\s+head)\b/i, category: 'admin_impersonation', signal: 'explicit_impersonation' },
  { pattern: /\brole[\s_-]?play\s+as\s+(an?\s+)?(admin|developer|bme[\s_-]?head|root|superuser|owner)\b/i, category: 'admin_impersonation', signal: 'roleplay_admin' },

  // Privilege-escalation requests
  { pattern: /\b(give|grant|elevate)\s+(me\s+)?(admin|developer|bme[\s_-]?head|root|superuser)\s+(actions?|access|permissions?|privileges?|rights?)\b/i, category: 'role_override', signal: 'grant_privileged_access' },
  { pattern: /\bbypass\s+(your|the|role|rbac|permission|authorization|safety|restriction)/i, category: 'role_override', signal: 'bypass_restriction' },
  { pattern: /\boverride\s+(your\s+)?(safety|restrictions?|rules?|policy|role|rbac|permission)/i, category: 'role_override', signal: 'override_safety_or_role' },
  { pattern: /\b(jail[\s_-]?break|dan\s+mode|developer\s+mode)\b/i, category: 'role_override', signal: 'jailbreak_marker' },

  // Cross-department leakage requests (department-scoped roles asking
  // about another department or "all departments")
  { pattern: /\bshow\s+(me\s+)?(another|other|different|all)\s+department/i, category: 'cross_department_request', signal: 'show_other_department' },
  { pattern: /\b(give|show|list)\s+me\s+(records|data|equipment|assets|requests|work\s+orders)\s+from\s+(another|other|different|all)\s+department/i, category: 'cross_department_request', signal: 'records_from_other_department' },
  { pattern: /\b(switch|change|set)\s+(my\s+)?department\s+to\b/i, category: 'cross_department_request', signal: 'switch_department' },

];

const UNSAFE_BIOMEDICAL_PATTERNS: Array<{
  pattern: RegExp;
  category: UnsafeBiomedicalCategory;
  signal: string;
}> = [
  // Alarm bypass / disable
  { pattern: /\b(disable|silence|mute|turn\s+off|switch\s+off|bypass|override|defeat|deactivate)\s+(the\s+)?alarm(s)?\b/i, category: 'alarm_bypass', signal: 'disable_alarm' },
  { pattern: /\b(desactivar|silenciar|apagar|omitir)\s+(?:la\s+)?alarma\b/i, category: 'alarm_bypass', signal: 'disable_alarm_spanish' },
  { pattern: /\balarm\s+(silenc(e|ing)|bypass(ed|ing)?|disabl(e|ed|ing)|override(d|n)?)\b/i, category: 'alarm_bypass', signal: 'alarm_silencing' },
  { pattern: /\bhow\s+(do|can)\s+i\s+(silence|disable|stop|turn\s+off|mute)\s+(the|this)?\s*alarm/i, category: 'alarm_bypass', signal: 'how_to_silence_alarm' },

  // Sensor bypass — allow up to a few intervening words (e.g. "the temperature sensor")
  { pattern: /\b(?:bypass|defeat|disable|fake|spoof|fool)\s+(?:the\s+)?(?:[\w-]+\s+){0,3}(?:sensor|probe|detector)\b/i, category: 'sensor_bypass', signal: 'bypass_sensor' },

  // Protection / interlock bypass
  { pattern: /\b(disable|bypass|defeat|override|remove|short)\s+(the\s+)?(protection|interlock|safety\s+(circuit|interlock|feature)|fail[\s-]?safe|safety\s+chain)\b/i, category: 'protection_bypass', signal: 'disable_protection' },

  // Service mode / workaround / hidden menu
  { pattern: /\b(enter|use|enable|access)\s+(the\s+)?service\s+mode\s+(workaround|trick|to\s+bypass|to\s+skip|to\s+override)/i, category: 'service_mode_workaround', signal: 'service_mode_workaround' },
  { pattern: /\bservice\s+mode\s+(workaround|hack|trick|backdoor)\b/i, category: 'service_mode_workaround', signal: 'service_mode_hack' },
  { pattern: /\b(hidden|secret|undocumented)\s+(menu|service\s+code|password|backdoor)\b/i, category: 'service_mode_workaround', signal: 'hidden_menu' },

  // Internal board / component repair (accept "open" / "opening" / "cracking" / "popping")
  { pattern: /\b(?:open(?:ing)?|crack(?:ing)?|pop(?:ping)?)\s+(?:up\s+)?(?:the|this)?\s*(?:internal|main|mother|logic|control|power)?\s*board\b/i, category: 'internal_board_repair', signal: 'open_internal_board' },
  { pattern: /\b(?:open(?:ing)?|access(?:ing)?|expos(?:e|ing))\s+(?:the\s+)?internal\s+(?:board|circuitry|electronics)/i, category: 'internal_board_repair', signal: 'access_internal_circuitry' },
  { pattern: /\b(?:solder(?:ing)?|desolder(?:ing)?|rework(?:ing)?|trace[\s-]?fix)\s+(?:the\s+)?(?:board|component|chip|pad|trace)\b/i, category: 'internal_board_repair', signal: 'solder_internal_component' },

  // Firmware patch / flash
  { pattern: /\b(custom|unofficial|unauthorized|third[\s-]?party|patched)\s+firmware\b/i, category: 'firmware_patch', signal: 'unofficial_firmware' },
  { pattern: /\bfirmware\s+(patch|crack|hack|mod|downgrade\s+to\s+bypass)/i, category: 'firmware_patch', signal: 'firmware_patch' },
  { pattern: /\b(flash|reflash|install)\s+(custom|unofficial|patched)\s+firmware\b/i, category: 'firmware_patch', signal: 'flash_custom_firmware' },

  // Calibration shortcut
  { pattern: /\bcalibration\s+(shortcut|cheat|skip|workaround|hack|bypass)\b/i, category: 'calibration_shortcut', signal: 'calibration_shortcut' },
  { pattern: /\bhow\s+(?:do|can)\s+i\s+calibrat(?:e|ion)\s+(?:this\s+)?(?:analy[sz]er|device|equipment|asset|unit)\b/i, category: 'calibration_shortcut', signal: 'calibration_procedure_request' },
  { pattern: /\b(skip|bypass|bypas|fake|forge|falsif(?:y|ying)|short\s*cut)\s+(the\s+)?calibrat(?:e|ion|oin)\b/i, category: 'calibration_shortcut', signal: 'skip_calibration' },
  { pattern: /\b(override|disable|bypass|bypas)\s+(?:the\s+)?(?:calibration|calibrtion|cal)\s+(?:lock|warning|requirement|check)\b/i, category: 'calibration_shortcut', signal: 'override_calibration_requirement' },

  // Unsafe continued use
  { pattern: /\b(?:use|run|keep\s+(?:running|using)|continue\s+using)\s+(?:the\s+)?(?:device|equipment|machine|monitor|ventilator|defibrillator|infusion\s+pump)\s+(?:even\s+if|despite|with\s+the?)\s+(?:unsafe|alarms?|fault|defect|broken|failure|warning)/i, category: 'unsafe_use_despite_alarm', signal: 'use_device_unsafe' },
  { pattern: /\bkeep\s+(?:the\s+)?(?:equipment|device|machine|monitor|ventilator)\s+running\s+despite\s+(?:an?\s+)?alarms?\b/i, category: 'unsafe_use_despite_alarm', signal: 'keep_running_despite_alarm' },
  { pattern: /\bignore\s+(?:the\s+)?(?:alarms?|fault|warning|safety\s+alert)\s+and\s+(?:use|run|continue)/i, category: 'unsafe_use_despite_alarm', signal: 'ignore_alarm_and_run' },

  // Clinical diagnosis / treatment requests routed away from biomedical equipment operations.
  { pattern: /\b(diagnose|diagnosis|treat|treatment|prescribe|dose|triage)\s+(?:this\s+)?patient\b/i, category: 'clinical_patient_diagnosis', signal: 'clinical_patient_advice' },
  { pattern: /\bwhat\s+(?:disease|condition|medicine|drug|dose)\s+(?:does|should)\s+(?:the\s+)?patient\b/i, category: 'clinical_patient_diagnosis', signal: 'patient_diagnosis_or_treatment' },
];

export function detectPromptInjection(message: string): PromptInjectionResult {
  const normalized = message.trim();
  for (const { pattern, category, signal } of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      return { isInjection: true, category, matchedSignal: signal };
    }
  }
  return { isInjection: false, category: 'none', matchedSignal: null };
}

export function detectUnsafeBiomedical(message: string): UnsafeBiomedicalResult {
  const normalized = message.trim();
  for (const { pattern, category, signal } of UNSAFE_BIOMEDICAL_PATTERNS) {
    if (pattern.test(normalized)) {
      return { isUnsafe: true, category, matchedSignal: signal };
    }
  }
  return { isUnsafe: false, category: 'none', matchedSignal: null };
}

export function describeInjectionRefusal(category: PromptInjectionCategory): string {
  switch (category) {
    case 'instruction_override':
      return 'I follow the BMEDIS safety and role rules even when a message asks me to ignore them. I will keep using your real BMEDIS role and the safety policy.';
    case 'admin_impersonation':
      return 'I cannot pretend to be a different role. I will answer using your real BMEDIS role and the actions it allows.';
    case 'role_override':
      return 'I cannot bypass or elevate role permissions. I can explain what your current role can and cannot do, and how to request the right action.';
    case 'cross_department_request':
      return 'I cannot show records from a department outside your scope. I can explain what is visible in your own department or the workflow to request cross-department information through an authorized BMEDIS user.';
    case 'safety_bypass_pretext':
      return 'I cannot accept "I have permission" or "the manual says" as a way to bypass biomedical safety rules. If a real authorization exists, the right BMEDIS workflow (work order, BME Head approval, vendor service) records it. I can help you start that workflow safely.';
    default:
      return 'I cannot follow that instruction. I will keep using your real BMEDIS role.';
  }
}

export function describeUnsafeRefusal(category: UnsafeBiomedicalCategory): string {
  switch (category) {
    case 'alarm_bypass':
      return 'I cannot guide silencing, disabling, or bypassing equipment alarms. Alarms protect patients and operators. If an alarm is sounding, remove the equipment from clinical use and escalate to BME / the vendor.';
    case 'sensor_bypass':
      return 'I cannot guide spoofing or bypassing a sensor / probe / detector. False readings risk patient harm.';
    case 'protection_bypass':
      return 'I cannot guide disabling safety interlocks, fail-safes, or protection circuits. These exist to prevent patient harm and electrical hazards.';
    case 'service_mode_workaround':
      return 'I cannot share hidden service-mode workarounds, undocumented menus, or service codes. Use approved manufacturer procedures or vendor service for that level of access.';
    case 'internal_board_repair':
      return 'I cannot guide opening the device, board-level repair, or component-level repair. That work belongs to qualified service engineers using the approved manufacturer procedure.';
    case 'firmware_patch':
      return 'I cannot guide installing custom, unofficial, or patched firmware. Use only the manufacturer-approved firmware path.';
    case 'calibration_shortcut':
      return 'I cannot guide skipping, faking, or shortcutting calibration. Use the approved calibration procedure and record the result in BMEDIS.';
    case 'unsafe_use_despite_alarm':
      return 'I cannot guide using equipment that is alarming, broken, or showing a safety fault. Remove from clinical use, log a corrective request in BMEDIS, and escalate.';
    case 'clinical_patient_diagnosis':
      return 'I cannot diagnose, treat, prescribe, or make clinical decisions for a patient. Use licensed clinical staff and approved clinical workflows; I can only help with biomedical equipment management.';
    default:
      return 'I cannot guide that action because it would not be safe for the patient or the operator.';
  }
}

export function safeFirstLineCheckList(): string[] {
  return [
    'Verify external power: socket, plug, cable, battery state, fuse if accessible without opening the device.',
    'Inspect accessories and connections (probes, leads, hoses, screen cable) for damage or loose contact.',
    'Look for visible damage, overheating, blocked ventilation, or fluid ingress.',
    'Record any displayed error code or alarm message and the time it appeared.',
    'Ask the user/clinician what was happening when the issue started.',
    'Check PM and calibration status in BMEDIS for this asset.',
    'If anything looks unsafe (alarm, smoke, overheating, electrical fault), remove the equipment from clinical use immediately.',
    'Escalate to the BME Head, the equipment manual, or the vendor for board-level, firmware, calibration, or service-mode work.',
  ];
}

/**
 * One-call evaluator that returns whether a message should be treated as an
 * unsafe / injection request and a structured refusal payload for the
 * safety service to attach to its `evaluateSafetyDecision` output.
 */
export interface PromptInjectionOrUnsafeEvaluation {
  blocked: boolean;
  reasonText: string;
  alternative: string;
  safeChecks: string[];
  injection: PromptInjectionResult;
  unsafe: UnsafeBiomedicalResult;
}

export function evaluateUnsafeOrInjectionMessage(message: string): PromptInjectionOrUnsafeEvaluation {
  const injection = detectPromptInjection(message);
  const unsafe = detectUnsafeBiomedical(message);
  if (!injection.isInjection && !unsafe.isUnsafe) {
    return {
      blocked: false,
      reasonText: '',
      alternative: '',
      safeChecks: [],
      injection,
      unsafe,
    };
  }

  const reasonParts: string[] = [];
  if (injection.isInjection) reasonParts.push(describeInjectionRefusal(injection.category));
  if (unsafe.isUnsafe) reasonParts.push(describeUnsafeRefusal(unsafe.category));

  let alternative = '';
  if (unsafe.isUnsafe) {
    alternative =
      'I can walk you through safe first-line checks you can do without opening the device, and the BMEDIS workflow to record the issue and escalate.';
  } else if (injection.category === 'cross_department_request') {
    alternative =
      'I can summarize what your department currently has open or explain how to request information from another department through the right BMEDIS workflow.';
  } else if (injection.isInjection) {
    alternative =
      'I can answer using your real BMEDIS role. Tell me what task or evidence you need and I will route it correctly.';
  }

  return {
    blocked: true,
    reasonText: reasonParts.join(' '),
    alternative,
    safeChecks: unsafe.isUnsafe ? safeFirstLineCheckList() : [],
    injection,
    unsafe,
  };
}
