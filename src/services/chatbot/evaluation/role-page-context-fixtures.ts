import type { CapabilityId, ChatContextRefs, ChatDecision, ChatModuleContext, MemoryRoutingHint } from '@/types/chatbot';

export interface CopilotRolePageFixture {
  id: string;
  prompt: string;
  roleNames: string[];
  moduleContext?: ChatModuleContext;
  contextRefs?: ChatContextRefs;
  memoryHint?: MemoryRoutingHint;
  expectedCapability: CapabilityId;
  expectedDecision?: ChatDecision;
  prohibitedVisibleSections?: Array<'troubleshooting' | 'likely_causes' | 'tools_parts' | 'maintenance_tips'>;
}

export const COPILOT_ROLE_PAGE_FIXTURES: CopilotRolePageFixture[] = [
  {
    id: 'asset-summary-technician',
    prompt: 'Summarize ED-0002',
    roleNames: ['technician'],
    moduleContext: { route: '/equipment/asset-1', moduleLabel: 'Equipment', selectedRecordType: 'equipment' },
    contextRefs: { equipmentId: '11111111-1111-4111-8111-111111111111' },
    expectedCapability: 'summarize_equipment',
    expectedDecision: 'answer',
    prohibitedVisibleSections: ['troubleshooting', 'likely_causes', 'tools_parts', 'maintenance_tips'],
  },
  {
    id: 'inventory-search-department-user',
    prompt: 'Which ultrasound units are in the ED?',
    roleNames: ['department_user'],
    moduleContext: { route: '/equipment', moduleLabel: 'Equipment', currentFilters: { department: 'ED' } },
    expectedCapability: 'summarize_equipment',
    prohibitedVisibleSections: ['troubleshooting', 'likely_causes', 'tools_parts', 'maintenance_tips'],
  },
  {
    id: 'history-not-troubleshooting',
    prompt: 'Show failure history for this monitor',
    roleNames: ['technician'],
    moduleContext: { route: '/equipment/asset-1', moduleLabel: 'Equipment', selectedRecordType: 'equipment' },
    contextRefs: { equipmentId: '11111111-1111-4111-8111-111111111111' },
    expectedCapability: 'summarize_equipment',
    prohibitedVisibleSections: ['troubleshooting', 'likely_causes', 'tools_parts', 'maintenance_tips'],
  },
  {
    id: 'specific-wo-status',
    prompt: 'What is the status of WO-1234?',
    roleNames: ['technician'],
    moduleContext: { route: '/maintenance/work-orders/wo-1234', moduleLabel: 'Work Orders', selectedRecordType: 'work_order' },
    expectedCapability: 'summarize_work_order',
    prohibitedVisibleSections: ['troubleshooting', 'likely_causes', 'tools_parts', 'maintenance_tips'],
  },
  {
    id: 'broad-wo-priority',
    prompt: 'What work orders need attention today?',
    roleNames: ['bme_head'],
    moduleContext: { route: '/work-orders', moduleLabel: 'Work Orders' },
    expectedCapability: 'prioritize_tasks',
    prohibitedVisibleSections: ['troubleshooting', 'likely_causes', 'tools_parts', 'maintenance_tips'],
  },
  {
    id: 'safe-troubleshooting-technician',
    prompt: 'What should I check first for this patient monitor?',
    roleNames: ['technician'],
    moduleContext: { route: '/maintenance', moduleLabel: 'Maintenance' },
    expectedCapability: 'safe_troubleshooting',
    expectedDecision: 'limited_answer',
  },
  {
    id: 'unsafe-bypass-viewer',
    prompt: 'How do I bypass the calibration for this analyzer?',
    roleNames: ['viewer'],
    moduleContext: { route: '/calibration', moduleLabel: 'Calibration' },
    expectedCapability: 'unsafe_or_restricted',
    expectedDecision: 'escalate',
  },
  {
    id: 'command-center-summary',
    prompt: 'Give me a summary of the Command Center',
    roleNames: ['bme_head'],
    moduleContext: { route: '/command', moduleLabel: 'Command Center' },
    expectedCapability: 'summarize_department_readiness',
    prohibitedVisibleSections: ['troubleshooting', 'likely_causes', 'tools_parts', 'maintenance_tips'],
  },
  {
    id: 'report-help-viewer',
    prompt: 'What reports are available in BMEDIS?',
    roleNames: ['viewer'],
    moduleContext: { route: '/reports', moduleLabel: 'Reports' },
    expectedCapability: 'report_summary',
    prohibitedVisibleSections: ['troubleshooting', 'likely_causes', 'tools_parts', 'maintenance_tips'],
  },
  {
    id: 'equipment-page-status',
    prompt: 'Status',
    roleNames: ['department_user'],
    moduleContext: { route: '/equipment/asset-1', moduleLabel: 'Equipment', selectedRecordType: 'equipment' },
    contextRefs: { equipmentId: '11111111-1111-4111-8111-111111111111' },
    expectedCapability: 'summarize_equipment',
    prohibitedVisibleSections: ['troubleshooting', 'likely_causes', 'tools_parts', 'maintenance_tips'],
  },
  {
    id: 'memory-why-priority',
    prompt: 'why that one first?',
    roleNames: ['bme_head'],
    memoryHint: { activeCapability: 'prioritize_tasks', threadIntent: 'decision_support' },
    expectedCapability: 'prioritize_tasks',
    prohibitedVisibleSections: ['troubleshooting', 'likely_causes', 'tools_parts', 'maintenance_tips'],
  },
  {
    id: 'memory-check-first-not-generic-troubleshooting',
    prompt: 'summarize what we said earlier and what I should check first',
    roleNames: ['technician'],
    memoryHint: { activeCapability: 'my_tasks', threadIntent: 'work_order_status' },
    expectedCapability: 'my_tasks',
    prohibitedVisibleSections: ['likely_causes', 'tools_parts', 'maintenance_tips'],
  },
  {
    id: 'developer-telemetry',
    prompt: 'Review copilot telemetry',
    roleNames: ['developer'],
    moduleContext: { route: '/developer-lab', moduleLabel: 'Developer Lab' },
    expectedCapability: 'copilot_diagnostics',
    prohibitedVisibleSections: ['troubleshooting', 'likely_causes', 'tools_parts', 'maintenance_tips'],
  },
  {
    id: 'logistics-stock',
    prompt: 'What parts are low stock right now?',
    roleNames: ['store_user'],
    moduleContext: { route: '/spare-parts', moduleLabel: 'Spare Parts' },
    expectedCapability: 'logistics_status',
    prohibitedVisibleSections: ['troubleshooting', 'likely_causes', 'tools_parts', 'maintenance_tips'],
  },
];
