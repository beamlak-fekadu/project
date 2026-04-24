import type { CapabilityId, ClassifiedRequest } from '@/types/chatbot';

const ALL_TOOLS = [
  'getCurrentUserContext',
  'getMyTasks',
  'getEquipmentSummary',
  'getWorkOrderSummary',
  'getDepartmentReadiness',
  'getAlertsSummary',
  'getInventoryLogisticsStatus',
  'getProcurementStatus',
  'getSafeTroubleshootingContext',
] as const;

export type CopilotToolName = (typeof ALL_TOOLS)[number];

const CAPABILITY_TOOLS: Record<CapabilityId, CopilotToolName[]> = {
  assistant_intro: ['getCurrentUserContext', 'getMyTasks', 'getAlertsSummary'],
  my_tasks: ['getCurrentUserContext', 'getMyTasks', 'getAlertsSummary', 'getDepartmentReadiness'],
  prioritize_tasks: [
    'getCurrentUserContext',
    'getMyTasks',
    'getAlertsSummary',
    'getDepartmentReadiness',
    'getProcurementStatus',
  ],
  summarize_work_order: ['getCurrentUserContext', 'getWorkOrderSummary', 'getEquipmentSummary'],
  summarize_equipment: ['getCurrentUserContext', 'getEquipmentSummary', 'getAlertsSummary'],
  explain_equipment_risk: ['getCurrentUserContext', 'getEquipmentSummary', 'getAlertsSummary'],
  explain_pm_status: ['getCurrentUserContext', 'getMyTasks', 'getDepartmentReadiness'],
  explain_replacement_priority: ['getCurrentUserContext', 'getEquipmentSummary', 'getProcurementStatus'],
  safe_troubleshooting: [
    'getCurrentUserContext',
    'getSafeTroubleshootingContext',
    'getEquipmentSummary',
    'getWorkOrderSummary',
  ],
  maintenance_tips: ['getCurrentUserContext', 'getEquipmentSummary', 'getMyTasks'],
  maintenance_guidance: ['getCurrentUserContext', 'getEquipmentSummary', 'getMyTasks'],
  logistics_status: ['getCurrentUserContext', 'getInventoryLogisticsStatus', 'getProcurementStatus'],
  procurement_status: ['getCurrentUserContext', 'getProcurementStatus', 'getInventoryLogisticsStatus'],
  pending_approvals: ['getCurrentUserContext', 'getMyTasks', 'getProcurementStatus'],
  approval_tasks: ['getCurrentUserContext', 'getMyTasks', 'getProcurementStatus'],
  alerts_and_escalations: ['getCurrentUserContext', 'getAlertsSummary', 'getMyTasks'],
  decision_support_analysis: [
    'getCurrentUserContext',
    'getDepartmentReadiness',
    'getAlertsSummary',
    'getMyTasks',
  ],
  summarize_department_readiness: ['getCurrentUserContext', 'getDepartmentReadiness', 'getAlertsSummary'],
  training_status: ['getCurrentUserContext', 'getMyTasks', 'getDepartmentReadiness'],
  disposal_status: ['getCurrentUserContext', 'getMyTasks'],
  general_fallback: ['getCurrentUserContext', 'getMyTasks', 'getAlertsSummary'],
  general_system_fallback: ['getCurrentUserContext', 'getMyTasks', 'getAlertsSummary'],
};

/**
 * Picks which retrieval tools to run for this turn (Vercel AI tool-calling style, server-side only).
 */
export function planToolRetrieval(classified: ClassifiedRequest, _message: string): CopilotToolName[] {
  const list = CAPABILITY_TOOLS[classified.capability] ?? CAPABILITY_TOOLS.general_system_fallback;
  return Array.from(new Set(list));
}
