import type { CapabilityId, ChatIntent } from '@/types/chatbot';

export interface CapabilityDefinition {
  id: CapabilityId;
  intents: ChatIntent[];
  description: string;
  requiredInputs: string[];
  retrievalBlocks: string[];
  responseSections: Array<'summary' | 'actions' | 'insights' | 'recommendations' | 'escalation_guidance' | 'confidence'>;
  safetyConstraints: string[];
}

const ALL_SECTIONS: CapabilityDefinition['responseSections'] = [
  'summary',
  'actions',
  'insights',
  'recommendations',
  'escalation_guidance',
  'confidence',
];

export const CAPABILITY_REGISTRY: Record<CapabilityId, CapabilityDefinition> = {
  my_tasks: {
    id: 'my_tasks',
    intents: ['maintenance_tip', 'work_order_help'],
    description: 'Shows active work and pending commitments for the requesting user.',
    requiredInputs: ['profileId'],
    retrievalBlocks: ['assignedWorkOrders', 'pendingApprovals', 'overduePm'],
    responseSections: ALL_SECTIONS,
    safetyConstraints: ['role_scope_only'],
  },
  prioritize_tasks: {
    id: 'prioritize_tasks',
    intents: ['maintenance_tip', 'analytics_explanation'],
    description: 'Ranks urgent work by risk, urgency, and operational impact.',
    requiredInputs: ['profileId'],
    retrievalBlocks: ['decisionSupport', 'recommendationFlags', 'openWorkOrders'],
    responseSections: ALL_SECTIONS,
    safetyConstraints: ['role_scope_only'],
  },
  summarize_work_order: {
    id: 'summarize_work_order',
    intents: ['work_order_help'],
    description: 'Summarizes work-order status, actions, and next steps.',
    requiredInputs: ['workOrderId'],
    retrievalBlocks: ['workOrder', 'maintenanceHistory'],
    responseSections: ALL_SECTIONS,
    safetyConstraints: ['role_scope_only'],
  },
  explain_equipment_risk: {
    id: 'explain_equipment_risk',
    intents: ['analytics_explanation', 'equipment_lookup'],
    description: 'Explains risk and reliability signals for a specific asset.',
    requiredInputs: ['equipmentId'],
    retrievalBlocks: ['riskScores', 'reliability', 'replacementPriority'],
    responseSections: ALL_SECTIONS,
    safetyConstraints: ['role_scope_only'],
  },
  explain_pm_status: {
    id: 'explain_pm_status',
    intents: ['maintenance_tip', 'analytics_explanation'],
    description: 'Explains PM compliance and overdue preventive maintenance.',
    requiredInputs: ['departmentId?'],
    retrievalBlocks: ['overduePm', 'pmCompliance'],
    responseSections: ALL_SECTIONS,
    safetyConstraints: ['role_scope_only'],
  },
  safe_troubleshooting: {
    id: 'safe_troubleshooting',
    intents: ['troubleshooting'],
    description: 'Provides safe first-line troubleshooting and escalation criteria.',
    requiredInputs: ['equipmentId?'],
    retrievalBlocks: ['equipment', 'manualOrSop', 'maintenanceHistory'],
    responseSections: ALL_SECTIONS,
    safetyConstraints: ['no_board_level', 'no_bypass', 'first_line_only'],
  },
  maintenance_guidance: {
    id: 'maintenance_guidance',
    intents: ['maintenance_tip', 'equipment_lookup'],
    description: 'Provides maintenance guidance using scoped asset and department context.',
    requiredInputs: ['departmentId?'],
    retrievalBlocks: ['equipment', 'workOrders', 'pmSnapshot'],
    responseSections: ALL_SECTIONS,
    safetyConstraints: ['role_scope_only'],
  },
  logistics_status: {
    id: 'logistics_status',
    intents: ['calibration_or_logistics'],
    description: 'Summarizes parts stock, procurement flow, and logistics blockers.',
    requiredInputs: ['departmentId?'],
    retrievalBlocks: ['lowStock', 'procurementPipeline'],
    responseSections: ALL_SECTIONS,
    safetyConstraints: ['role_scope_only'],
  },
  approval_tasks: {
    id: 'approval_tasks',
    intents: ['work_order_help', 'maintenance_tip'],
    description: 'Lists pending approvals in maintenance, disposal, and procurement workflows.',
    requiredInputs: ['profileId'],
    retrievalBlocks: ['maintenanceRequests', 'disposalRequests', 'procurementPipeline'],
    responseSections: ALL_SECTIONS,
    safetyConstraints: ['role_scope_only'],
  },
  alerts_and_escalations: {
    id: 'alerts_and_escalations',
    intents: ['analytics_explanation', 'troubleshooting'],
    description: 'Reports active alert state and escalations requiring action.',
    requiredInputs: ['departmentId?'],
    retrievalBlocks: ['recommendationFlags', 'recentAlerts'],
    responseSections: ALL_SECTIONS,
    safetyConstraints: ['role_scope_only'],
  },
  decision_support_analysis: {
    id: 'decision_support_analysis',
    intents: ['analytics_explanation'],
    description: 'Explains triage, readiness, and workload analytics snapshots.',
    requiredInputs: ['departmentId?'],
    retrievalBlocks: ['decisionSupport'],
    responseSections: ALL_SECTIONS,
    safetyConstraints: ['role_scope_only'],
  },
  general_fallback: {
    id: 'general_fallback',
    intents: ['maintenance_tip'],
    description: 'Safe, context-aware fallback for unclear or unknown requests.',
    requiredInputs: [],
    retrievalBlocks: ['lightweightContext'],
    responseSections: ALL_SECTIONS,
    safetyConstraints: ['safe_general_only'],
  },
};

export function getCapabilityDefinition(capability: CapabilityId) {
  return CAPABILITY_REGISTRY[capability];
}
