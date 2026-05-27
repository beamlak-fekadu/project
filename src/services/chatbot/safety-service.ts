import type {
  CapabilityId,
  ChatDecision,
  ChatEvidence,
  ChatIntent,
  ClassifiedRequest,
  SafetyEvaluation,
  UserChatProfile,
} from '@/types/chatbot';
import { canUseDeveloperCopilotDiagnostics } from './copilot-rbac';
import { evaluateUnsafeOrInjectionMessage } from './prompt-injection-guard';

export const STANDARD_RESPONSES = {
  checkManual:
    "I can't provide that reliably from the available information. Check the equipment manual or approved service documentation.",
  limitedTechnical:
    "I can suggest safe first-line checks, but I can't reliably interpret that exact technical detail here. Check the manual or escalate.",
  escalate: 'This request needs escalation to a qualified biomedical engineer or vendor.',
  outOfScope:
    "I'm limited to medical equipment management support, including maintenance, troubleshooting, PM, work orders, calibration/logistics, and equipment analytics.",
} as const;

const ROLE_INTENT_BLOCKS: Record<string, ChatIntent[]> = {
  viewer: ['calibration_or_logistics', 'spare_parts_lookup', 'logistics_stock', 'procurement_status'],
  store_user: ['troubleshooting', 'safe_troubleshooting'],
};

const ROLE_CAPABILITY_BLOCKS: Record<string, CapabilityId[]> = {
  viewer: ['procurement_status', 'copilot_diagnostics'],
  store_user: ['safe_troubleshooting', 'copilot_diagnostics'],
  technician: ['copilot_diagnostics'],
  department_head: ['copilot_diagnostics'],
  department_user: ['copilot_diagnostics'],
};

const EXACT_ERROR_CODE_PATTERN = /\b(error\s*code|code\s*[a-z]?\d{2,}|E\d{2,})\b/i;
const CALIBRATION_EXACT_PATTERN = /\b(exact|step[-\s]?by[-\s]?step|service mode|calibrat(?:e|ion)\s+this\s+(?:model|analy[sz]er|device|equipment|asset|unit))\b/i;
const DEEP_REPAIR_PATTERN = /\b(board|component|pcb|solder|firmware|internal repair|replace board)\b/i;
const MUTATION_REQUEST_PATTERN =
  /\b(create|draft|submit|assign|reassign|close|complete|approve|reject|delete|update|mark)\b.*\b(work orders?|maintenance requests?|requests?|procurement|calibration|training|disposal|assets?|equipment)\b/i;
const SAFE_NO_RECORD_INTENTS = new Set<ChatIntent>([
  'maintenance_tip',
  'analytics_explanation',
  'work_order_help',
  'work_order_status',
  'maintenance_status',
  'asset_summary',
  'inventory_search',
  'equipment_lookup',
  'equipment_history',
  'risk_analysis',
  'reliability_metrics',
  'replacement_priority',
  'dashboard_summary',
  'decision_support',
  'preventive_maintenance',
  'calibration_status',
  'spare_parts_lookup',
  'logistics_stock',
  'procurement_status',
  'training_status',
  'disposal_status',
  'report_help',
  'workflow_help',
  'insufficient_context',
]);

function roleRestrictedIntent(intent: ChatIntent, roleNames: string[]): boolean {
  if (roleNames.some((role) => role === 'developer' || role === 'admin' || role === 'bme_head')) return false;
  for (const role of roleNames) {
    const blocked = ROLE_INTENT_BLOCKS[role];
    if (blocked?.includes(intent)) return true;
  }
  return false;
}

function roleRestrictedCapability(capability: CapabilityId, roleNames: string[]) {
  if (capability === 'copilot_diagnostics') {
    return !canUseDeveloperCopilotDiagnostics({ roleNames });
  }
  if (roleNames.some((role) => role === 'developer' || role === 'admin' || role === 'bme_head')) return false;
  for (const role of roleNames) {
    const blocked = ROLE_CAPABILITY_BLOCKS[role];
    if (blocked?.includes(capability)) return true;
  }
  return false;
}

function hasGroundedContext(evidence: ChatEvidence) {
  const analyticsSnapshot = evidence.analyticsSnapshot as
    | {
        risk?: unknown;
        reliability?: unknown;
        replacement?: unknown;
        pmCompliance?: unknown[];
        recommendationFlags?: unknown[];
      }
    | null;

  const hasDepartmentAnalytics = Boolean(
    (Array.isArray(analyticsSnapshot?.pmCompliance) && analyticsSnapshot.pmCompliance.length > 0) ||
      (Array.isArray(analyticsSnapshot?.recommendationFlags) && analyticsSnapshot.recommendationFlags.length > 0)
  );

  return Boolean(
    evidence.equipment ||
      evidence.workOrder ||
      evidence.department ||
      evidence.maintenanceHistory.length > 0 ||
      evidence.pmSnapshot ||
      evidence.calibrationStatus ||
      evidence.logisticsSnapshot ||
      evidence.manualOrSopTexts.length > 0 ||
      analyticsSnapshot?.risk ||
      analyticsSnapshot?.reliability ||
      analyticsSnapshot?.replacement ||
      hasDepartmentAnalytics
  );
}

export function evaluateSafetyDecision(
  message: string,
  classified: ClassifiedRequest,
  profile: UserChatProfile,
  evidence: ChatEvidence
): SafetyEvaluation {
  const intent = classified.intent;
  const normalizedMessage = message.trim();
  const lowConfidence = classified.confidenceLabel === 'low' || classified.confidence < 0.62 || classified.ambiguous;

  if (intent === 'assistant_intro') {
    return {
      decision: 'answer',
      blocked: false,
      answerBasis: 'general_safe_guidance',
      confidence: 'high',
      reason: 'Onboarding and capability summary for BMEDIS copilot (no high-risk medical advice).',
      escalationRequired: false,
      evidenceTier: 'low',
      policyCategory: 'general_operational',
    };
  }

  if (intent === 'general_conversation' || intent === 'off_topic_safe') {
    const neutralFallback =
      classified.capability === 'general_system_fallback' ||
      classified.matchedSignals.includes('default_general_fallback');
    return {
      decision: neutralFallback ? 'limited_answer' : 'answer',
      blocked: false,
      answerBasis: 'general_safe_guidance',
      confidence: neutralFallback ? 'low' : 'medium',
      reason: neutralFallback
        ? 'No specific BMEDIS intent was identified; ask a neutral clarification or offer general system help.'
        : 'Harmless non-operational prompt; provide brief safe response and redirect to BMEDIS support.',
      escalationRequired: false,
      evidenceTier: 'low',
      policyCategory: 'general_operational',
    };
  }

  if (intent === 'out_of_scope') {
    return {
      decision: 'refuse',
      blocked: true,
      answerBasis: 'insufficient_data',
      confidence: 'low',
      reason: `${STANDARD_RESPONSES.outOfScope} I cannot provide patient diagnosis, treatment, prescription, or clinical decision advice.`,
      escalationRequired: false,
      evidenceTier: 'low',
      policyCategory: 'unsafe_or_out_of_scope',
    };
  }

  if (intent === 'unsafe') {
    const evaluation = evaluateUnsafeOrInjectionMessage(normalizedMessage);
    if (evaluation.blocked) {
      const reasonText = [evaluation.reasonText, evaluation.alternative].filter(Boolean).join(' ').trim();
      const policyTags: string[] = [];
      if (evaluation.injection.isInjection) policyTags.push(`injection:${evaluation.injection.category}`);
      if (evaluation.unsafe.isUnsafe) policyTags.push(`unsafe:${evaluation.unsafe.category}`);
      // Injection-only (no unsafe biomedical content): a refuse + alternative is
      // more honest than an escalate (there is no clinical safety escalation).
      if (evaluation.injection.isInjection && !evaluation.unsafe.isUnsafe) {
        return {
          decision: 'refuse',
          blocked: true,
          answerBasis: 'insufficient_data',
          confidence: 'low',
          reason: reasonText || STANDARD_RESPONSES.escalate,
          escalationRequired: false,
          evidenceTier: 'low',
          policyCategory: 'unsafe_or_out_of_scope',
          policyAlternative: evaluation.alternative,
          policyTags,
        };
      }
      return {
        decision: 'escalate',
        blocked: true,
        answerBasis: 'insufficient_data',
        confidence: 'low',
        reason: reasonText || STANDARD_RESPONSES.escalate,
        escalationRequired: true,
        evidenceTier: 'low',
        policyCategory: 'unsafe_or_out_of_scope',
        policyAlternative: evaluation.alternative,
        safeChecks: evaluation.safeChecks,
        policyTags,
      };
    }
    return {
      decision: 'escalate',
      blocked: true,
      answerBasis: 'insufficient_data',
      confidence: 'low',
      reason: STANDARD_RESPONSES.escalate,
      escalationRequired: true,
      evidenceTier: 'low',
      policyCategory: 'unsafe_or_out_of_scope',
    };
  }

  if (evidence.accessDenied) {
    const stillGrounded = hasGroundedContext({
      ...evidence,
      accessDenied: false,
    });

    if (stillGrounded) {
      return {
        decision: 'limited_answer',
        blocked: false,
        answerBasis: 'system_data',
        confidence: 'low',
        reason: 'Some requested context was not accessible, so response is limited to available scoped evidence.',
        escalationRequired: false,
        evidenceTier: 'medium',
        policyCategory: 'general_operational',
      };
    }

    return {
      decision: 'refuse',
      blocked: true,
      answerBasis: 'insufficient_data',
      confidence: 'low',
      reason: 'I cannot access one or more requested context items with your current permissions.',
      escalationRequired: false,
      evidenceTier: 'low',
      policyCategory: 'unsafe_or_out_of_scope',
    };
  }

  if (roleRestrictedIntent(intent, profile.roleNames)) {
    return {
      decision: 'refuse',
      blocked: true,
      answerBasis: 'insufficient_data',
      confidence: 'low',
      reason: 'Your role is limited for this request scope. Please contact a biomedical engineer or administrator.',
      escalationRequired: false,
      evidenceTier: 'low',
      policyCategory: 'unsafe_or_out_of_scope',
    };
  }

  if (roleRestrictedCapability(classified.capability, profile.roleNames)) {
    return {
      decision: 'refuse',
      blocked: true,
      answerBasis: 'insufficient_data',
      confidence: 'low',
      reason: 'Your role does not allow this capability scope. Please request support from an authorized user.',
      escalationRequired: false,
      evidenceTier: 'low',
      policyCategory: 'unsafe_or_out_of_scope',
    };
  }

  if (profile.roleNames.includes('viewer') && MUTATION_REQUEST_PATTERN.test(normalizedMessage)) {
    return {
      decision: 'refuse',
      blocked: true,
      answerBasis: 'insufficient_data',
      confidence: 'low',
      reason: 'Viewer access is read-only. I can explain the relevant evidence or workflow, but I cannot create, update, approve, or close records for this role.',
      escalationRequired: false,
      evidenceTier: 'low',
      policyCategory: 'unsafe_or_out_of_scope',
    };
  }

  if (intent === 'too_detailed') {
    return {
      decision: 'check_manual',
      blocked: true,
      answerBasis: 'insufficient_data',
      confidence: 'low',
      reason: STANDARD_RESPONSES.checkManual,
      escalationRequired: false,
      evidenceTier: 'low',
      policyCategory: 'specific_technical',
    };
  }

  const hasManualSupport = evidence.manualOrSopTexts.length > 0;
  const hasEvidence = hasGroundedContext(evidence);
  const completeness = evidence.evidenceCompleteness;
  const completenessInsufficient =
    completeness?.status === 'insufficient' ||
    ((completeness?.requiredMissing?.length ?? 0) > 0 && (completeness?.score ?? 1) < 0.55);
  const isDepartmentUser = profile.roleNames.includes('department_user') && !profile.roleNames.includes('admin');
  const asksExactErrorCode = EXACT_ERROR_CODE_PATTERN.test(normalizedMessage);
  const asksExactCalibration = CALIBRATION_EXACT_PATTERN.test(normalizedMessage);
  const asksDeepRepair = DEEP_REPAIR_PATTERN.test(normalizedMessage);
  const technicalDetailIntent = intent === 'troubleshooting' || intent === 'calibration_or_logistics';
  const specificTechnical =
    classified.specificity === 'specific' || classified.troubleshootingSubtype === 'specific_technical_troubleshooting';
  const unsafeTroubleshooting = classified.troubleshootingSubtype === 'unsafe_internal_or_bypass_troubleshooting';

  if (intent === 'calibration_status' && asksExactCalibration) {
    return {
      decision: 'check_manual',
      blocked: true,
      answerBasis: 'insufficient_data',
      confidence: 'low',
      reason: STANDARD_RESPONSES.checkManual,
      escalationRequired: false,
      evidenceTier: 'low',
      policyCategory: 'specific_technical',
    };
  }

  if (technicalDetailIntent && (asksExactErrorCode || asksExactCalibration || specificTechnical) && !hasManualSupport) {
    return {
      decision: 'check_manual',
      blocked: true,
      answerBasis: 'insufficient_data',
      confidence: 'low',
      reason: STANDARD_RESPONSES.checkManual,
      escalationRequired: false,
      evidenceTier: 'low',
      policyCategory: 'specific_technical',
    };
  }

  const equipmentCriticality = ((evidence.equipment?.equipment_categories as { criticality_level?: string } | undefined)?.criticality_level ?? '') as string;
  if (
    technicalDetailIntent &&
    (unsafeTroubleshooting || asksDeepRepair) &&
    ['high', 'critical'].includes(equipmentCriticality) &&
    !hasManualSupport
  ) {
    return {
      decision: 'escalate',
      blocked: true,
      answerBasis: 'insufficient_data',
      confidence: 'low',
      reason: STANDARD_RESPONSES.escalate,
      escalationRequired: true,
      evidenceTier: 'low',
      policyCategory: 'unsafe_or_out_of_scope',
    };
  }

  if (!hasEvidence) {
    if (
      SAFE_NO_RECORD_INTENTS.has(intent) ||
      (intent === 'troubleshooting' && classified.troubleshootingSubtype === 'safe_general_troubleshooting')
    ) {
      return {
        decision: 'limited_answer',
        blocked: false,
        answerBasis: 'general_safe_guidance',
        confidence: 'low',
        reason: 'No grounded records were found for this scope; returning safe general guidance.',
        escalationRequired: false,
        evidenceTier: 'low',
        policyCategory: 'general_operational',
      };
    }

    return {
      decision: 'check_manual',
      blocked: true,
      answerBasis: 'insufficient_data',
      confidence: 'low',
      reason: STANDARD_RESPONSES.checkManual,
      escalationRequired: false,
      evidenceTier: 'low',
      policyCategory: 'specific_technical',
    };
  }

  if (
    completenessInsufficient &&
    classified.capability !== 'safe_troubleshooting' &&
    classified.capability !== 'unsafe_or_restricted'
  ) {
    return {
      decision: 'limited_answer',
      blocked: false,
      answerBasis: 'insufficient_data',
      confidence: 'low',
      reason: `Required evidence is incomplete for this capability: ${(completeness?.requiredMissing ?? []).join(', ') || 'missing required context'}.`,
      escalationRequired: false,
      evidenceTier: 'low',
      policyCategory: 'general_operational',
    };
  }

  if (lowConfidence) {
    return {
      decision: 'limited_answer',
      blocked: false,
      answerBasis: hasEvidence ? 'system_data' : 'general_safe_guidance',
      confidence: 'low',
      reason: 'Request intent is ambiguous; returning constrained guidance and recommending clarification.',
      escalationRequired: false,
      evidenceTier: hasEvidence ? 'medium' : 'low',
      policyCategory: 'general_operational',
    };
  }

  if (intent === 'analytics_explanation' && isDepartmentUser) {
    return {
      decision: 'limited_answer',
      blocked: false,
      answerBasis: 'system_data',
      confidence: 'medium',
      reason: 'Department-level analytics explanation only for this role.',
      escalationRequired: false,
      evidenceTier: 'medium',
      policyCategory: 'general_operational',
    };
  }

  if (intent === 'troubleshooting' || intent === 'calibration_or_logistics') {
    return {
      decision: 'limited_answer',
      blocked: false,
      answerBasis: hasManualSupport ? 'manual_or_sop' : 'general_safe_guidance',
      confidence: hasManualSupport ? 'medium' : 'low',
      reason: hasManualSupport ? 'Manual snippets found; provide constrained guidance.' : 'Provide only safe first-line checks.',
      escalationRequired: false,
      evidenceTier: hasManualSupport ? 'medium' : 'low',
      policyCategory: 'general_operational',
    };
  }

  const decision: ChatDecision = 'answer';
  return {
    decision,
    blocked: false,
    answerBasis: hasManualSupport ? 'manual_or_sop' : 'system_data',
    confidence: hasManualSupport ? 'high' : 'medium',
    reason: 'Sufficient scoped evidence available.',
    escalationRequired: false,
    evidenceTier: hasManualSupport ? 'high' : 'medium',
    policyCategory: 'general_operational',
  };
}
