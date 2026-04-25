import type { CapabilityId } from '@/types/chatbot';

type CapabilityResponseDefaults = {
  title: string;
  intelligence_mode: 'standard' | 'troubleshooting' | 'prioritization' | 'synthesis';
  follow_up_suggestions: string[];
};

const BASE_SUGGESTIONS = ['What should I do first?', 'Show only urgent items', 'Turn this into a task list'];

const DEFAULTS: Record<CapabilityId, CapabilityResponseDefaults> = {
  assistant_intro: {
    title: 'BMERMS Assistant',
    intelligence_mode: 'standard',
    follow_up_suggestions: [
      'What is on my to-do list?',
      'Summarize open work orders',
      'What alerts need attention?',
      'What should I check first if this monitor is not powering on?',
    ],
  },
  general_conversation: {
    title: 'General Conversation',
    intelligence_mode: 'standard',
    follow_up_suggestions: ['What is on my to-do list?', 'Summarize this work order', 'Show open alerts'],
  },
  off_topic_safe: {
    title: 'General Guidance',
    intelligence_mode: 'standard',
    follow_up_suggestions: ['What should I prioritize today?', 'Summarize this equipment', 'What alerts need attention?'],
  },
  my_tasks: { title: 'Task and Priority Summary', intelligence_mode: 'prioritization', follow_up_suggestions: BASE_SUGGESTIONS },
  prioritize_tasks: {
    title: 'Task and Priority Summary',
    intelligence_mode: 'prioritization',
    follow_up_suggestions: BASE_SUGGESTIONS,
  },
  summarize_work_order: {
    title: 'Work Order Summary',
    intelligence_mode: 'synthesis',
    follow_up_suggestions: ['Show blockers for this work order', 'What should happen next?', 'Show urgent follow-up actions'],
  },
  summarize_equipment: {
    title: 'Equipment Summary',
    intelligence_mode: 'synthesis',
    follow_up_suggestions: ['Explain current risk drivers', 'Show related open work orders', 'What should I monitor next?'],
  },
  explain_equipment_risk: {
    title: 'Equipment Risk Explanation',
    intelligence_mode: 'synthesis',
    follow_up_suggestions: ['What evidence drives this risk score?', 'How can we lower this risk?', 'What is the operational impact?'],
  },
  explain_pm_status: {
    title: 'PM Status Explanation',
    intelligence_mode: 'synthesis',
    follow_up_suggestions: ['Show overdue PM items', 'What should be prioritized first?', 'How does this affect readiness?'],
  },
  summarize_alerts: {
    title: 'Alerts Summary',
    intelligence_mode: 'synthesis',
    follow_up_suggestions: ['Show critical alerts first', 'What needs escalation now?', 'Summarize alert trends'],
  },
  safe_troubleshooting: {
    title: 'Safe First-Line Troubleshooting',
    intelligence_mode: 'troubleshooting',
    follow_up_suggestions: [
      'What should I verify before escalation?',
      'Check equipment history',
      'Review PM and calibration status',
    ],
  },
  maintenance_tips: {
    title: 'Maintenance Guidance',
    intelligence_mode: 'standard',
    follow_up_suggestions: ['Show role-specific PM checks', 'What should I monitor weekly?', 'What should be escalated early?'],
  },
  logistics_status: {
    title: 'Logistics Status',
    intelligence_mode: 'synthesis',
    follow_up_suggestions: ['Show stock blockers', 'Which requests are delayed?', 'What should be expedited first?'],
  },
  procurement_status: {
    title: 'Procurement Status',
    intelligence_mode: 'synthesis',
    follow_up_suggestions: ['Show procurement blockers', 'Which items are overdue?', 'What is the operational impact?'],
  },
  summarize_department_readiness: {
    title: 'Department Readiness Summary',
    intelligence_mode: 'synthesis',
    follow_up_suggestions: ['What is hurting readiness most?', 'What should we fix first?', 'Show urgent readiness blockers'],
  },
  training_status: {
    title: 'Training Status',
    intelligence_mode: 'synthesis',
    follow_up_suggestions: ['Show pending training items', 'What is highest impact?', 'What should be scheduled first?'],
  },
  disposal_status: {
    title: 'Disposal Status',
    intelligence_mode: 'synthesis',
    follow_up_suggestions: ['Show disposal blockers', 'What is pending approval?', 'What should move first?'],
  },
  unsafe_or_restricted: {
    title: 'Safety Restriction',
    intelligence_mode: 'standard',
    follow_up_suggestions: ['Show safe first-line troubleshooting', 'Summarize this equipment', 'What should I escalate?'],
  },
  general_system_fallback: {
    title: 'BMERMS Assistant',
    intelligence_mode: 'standard',
    follow_up_suggestions: ['What is on my to-do list?', 'Summarize this work order', 'What alerts need attention?'],
  },
};

export function getCapabilityResponseDefaults(capability: CapabilityId): CapabilityResponseDefaults {
  return DEFAULTS[capability] ?? DEFAULTS.general_system_fallback;
}
