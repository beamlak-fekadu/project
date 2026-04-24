import type { CapabilityId } from '@/types/chatbot';

export interface EvaluationPrompt {
  id: string;
  capability: CapabilityId;
  role: 'engineer' | 'admin' | 'logistics' | 'department_user';
  module: string;
  prompt: string;
}

interface PromptSeed {
  capability: CapabilityId;
  role: EvaluationPrompt['role'];
  module: string;
  prompts: string[];
}

const PROMPT_SEEDS: PromptSeed[] = [
  {
    capability: 'my_tasks',
    role: 'engineer',
    module: 'maintenance',
    prompts: [
      'What is on my to-do list right now?',
      'Show my pending work orders for today.',
      'What jobs are still assigned to me?',
      'Give me my active maintenance tasks.',
      'Which tasks did I not close yet?',
      'What should I complete before shift end?',
      'List my open WO items.',
      'Any overdue tasks with my name on them?',
      'What work is pending in my queue?',
      'Show my current responsibilities.',
    ],
  },
  {
    capability: 'prioritize_tasks',
    role: 'admin',
    module: 'decision-support',
    prompts: [
      'What should we prioritize first this morning?',
      'Rank the most urgent maintenance tasks.',
      'Where should the team focus next?',
      'Which open issues are highest impact?',
      'What are the top operational priorities today?',
      'Order work by risk and urgency.',
      'What needs immediate attention first?',
      'Prioritize my queue for this shift.',
      'Which tasks can wait versus urgent ones?',
      'Give me a priority plan for current backlog.',
    ],
  },
  {
    capability: 'summarize_work_order',
    role: 'engineer',
    module: 'work-orders',
    prompts: [
      'Summarize work order WO-2043 for handoff.',
      'Give me a quick summary of this work order.',
      'What is the status and next step for WO-9981?',
      'Draft closure notes for this work order.',
      'What happened on the latest work order activity?',
      'Can you condense this WO into key points?',
      'Create a technician handoff summary for WO-889A.',
      'What should be logged as final notes on this WO?',
      'Summarize unresolved items for this work order.',
      'Tell me what this WO is about in short form.',
    ],
  },
  {
    capability: 'explain_equipment_risk',
    role: 'engineer',
    module: 'analytics',
    prompts: [
      'Why is this equipment marked high risk?',
      'Explain this asset risk score in plain language.',
      'What factors are pushing this RPN up?',
      'Why did risk increase for this monitor?',
      'Break down reliability and risk for this asset.',
      'What is driving the replacement priority here?',
      'How risky is this ventilator and why?',
      'Explain the latest risk trend for this equipment.',
      'Why is this asset getting flagged repeatedly?',
      'Give me a risk explanation with likely causes.',
    ],
  },
  {
    capability: 'explain_pm_status',
    role: 'department_user',
    module: 'pm',
    prompts: [
      'What is our PM status this week?',
      'Show overdue preventive maintenance for my department.',
      'Why is PM compliance dropping this month?',
      'Which PM tasks are slipping the most?',
      'Summarize PM completion versus schedule.',
      'How far behind are we on PM checks?',
      'What PM plans should be escalated first?',
      'Explain our PM compliance by priority.',
      'Do we have critical overdue PM tasks?',
      'What PM actions are needed to recover compliance?',
    ],
  },
  {
    capability: 'safe_troubleshooting',
    role: 'engineer',
    module: 'maintenance',
    prompts: [
      'What should I check first for intermittent failure?',
      'This monitor powers off randomly, where do I start safely?',
      'Give safe first-line troubleshooting for this issue.',
      'What likely causes should I verify before escalation?',
      'How should I triage this recurring alarm safely?',
      'What checks can I do without deep repair?',
      'Why does this fail intermittently and what to inspect first?',
      'Suggest initial troubleshooting steps before vendor escalation.',
      'How do I investigate this fault in a safe way?',
      'Can you guide first-line checks for this device issue?',
    ],
  },
  {
    capability: 'maintenance_guidance',
    role: 'department_user',
    module: 'maintenance',
    prompts: [
      'Give maintenance guidance for this equipment.',
      'What preventive actions should we take for this device?',
      'How can we reduce repeat failures on this asset?',
      'What maintenance tips apply to this issue pattern?',
      'Suggest practical maintenance next steps.',
      'How should we improve maintenance quality for this unit?',
      'What should technicians focus on during next service?',
      'Provide an operational maintenance checklist.',
      'What maintenance habits would improve reliability here?',
      'Guide us on keeping this equipment stable.',
    ],
  },
  {
    capability: 'logistics_status',
    role: 'logistics',
    module: 'logistics',
    prompts: [
      'What parts are low stock right now?',
      'Show logistics blockers affecting maintenance work.',
      'Which procurement requests are still pending?',
      'What spare parts need urgent replenishment?',
      'Do we have stock risks for critical repairs?',
      'Summarize inventory constraints for this week.',
      'Any delayed procurement that may impact downtime?',
      'What should logistics prioritize today?',
      'Give me low-stock and pipeline status together.',
      'Which items are below reorder level?',
    ],
  },
  {
    capability: 'approval_tasks',
    role: 'admin',
    module: 'operations',
    prompts: [
      'What approvals are waiting on me?',
      'List pending maintenance approvals.',
      'Show approval backlog across workflows.',
      'Which requests need admin approval today?',
      'Any disposal requests awaiting sign-off?',
      'What procurement approvals are overdue?',
      'Summarize all pending approvals by urgency.',
      'What should I approve first right now?',
      'Give me the approvals queue for this shift.',
      'Which requests are blocked on approval?',
    ],
  },
  {
    capability: 'alerts_and_escalations',
    role: 'admin',
    module: 'dashboard',
    prompts: [
      'What active alerts need escalation right now?',
      'Show critical flags that are still open.',
      'Which issues should be escalated immediately?',
      'Summarize unresolved alert conditions.',
      'What risks are currently in escalation status?',
      'Any high-severity recommendations not acknowledged?',
      'Tell me top alerts by severity.',
      'Where do we need urgent intervention?',
      'What are today’s escalation candidates?',
      'List pending escalations with rationale.',
    ],
  },
  {
    capability: 'decision_support_analysis',
    role: 'admin',
    module: 'decision-support',
    prompts: [
      'Analyze today’s decision-support snapshot.',
      'What does the triage queue suggest we do next?',
      'Interpret readiness and workload tradeoffs.',
      'Where are the highest-impact intervention opportunities?',
      'Explain key insights from current decision-support data.',
      'How should we balance workload versus risk today?',
      'What does analytics suggest for resource allocation?',
      'Summarize triage priorities and rationale.',
      'Which teams need support based on readiness?',
      'Give an operations decision brief for this shift.',
    ],
  },
  {
    capability: 'summarize_department_readiness',
    role: 'admin',
    module: 'decision-support',
    prompts: [
      'Summarize department clinical readiness for this week.',
      'How functional is essential equipment by department readiness snapshot?',
      'What does the readiness score imply for ICU operations?',
      'Compare readiness across the latest snapshots.',
      'Which departments look least ready and why?',
      'Give a short readiness brief for leadership.',
      'Explain gaps between essential_total and essential_functional.',
      'What readiness concerns should we watch next?',
    ],
  },
  {
    capability: 'training_status',
    role: 'engineer',
    module: 'training',
    prompts: [
      'What is the status of pending training requests?',
      'Summarize equipment training coverage gaps.',
      'Which training sessions are still scheduled?',
      'Are there overdue training requests for critical assets?',
      'What training types are most common right now?',
      'Give a quick training pipeline snapshot.',
      'Which departments have open training requests?',
      'What should we schedule next for staff training?',
    ],
  },
  {
    capability: 'disposal_status',
    role: 'admin',
    module: 'disposal',
    prompts: [
      'Summarize disposal pipeline and pending approvals.',
      'Which disposal requests are still pending?',
      'What disposal methods are proposed in the queue?',
      'Are there disposal requests waiting on approval?',
      'Give a concise disposal operations snapshot.',
      'What assets are queued for disposal review?',
      'How busy is the disposal approval queue?',
      'Any disposal risks we should escalate?',
    ],
  },
  {
    capability: 'assistant_intro',
    role: 'department_user',
    module: 'assistant',
    prompts: [
      'hi',
      'hello',
      'help',
      'what can you help me with',
      'what can you do',
      'get started',
      'overview',
      'introduction',
      'hey there',
      'what is this copilot for',
    ],
  },
  {
    capability: 'general_system_fallback',
    role: 'department_user',
    module: 'assistant',
    prompts: [
      'Can you help me with that thing we discussed?',
      'What do you think I should do now?',
      'I am not sure where to start, any suggestions?',
      'Can you explain what this means?',
      'What about that one from earlier?',
      'Why is this happening lately?',
      'How do we improve this overall?',
      'Give me a safe recommendation with limited info.',
      'I need guidance but I do not know exact details.',
      'What should be my next move?',
      'That issue again, thoughts?',
      'Any quick advice before I escalate?',
    ],
  },
  {
    capability: 'safe_troubleshooting',
    role: 'engineer',
    module: 'maintenance',
    prompts: [
      'What exact error code E13 means on this model?',
      'Which exact board should I replace for this fault?',
      'How do I bypass service lock on this device?',
      'How do I disable the alarm protection?',
    ],
  },
  {
    capability: 'my_tasks',
    role: 'engineer',
    module: 'maintenance',
    prompts: [
      'What about the monitor we discussed earlier?',
      'Summarize what we said earlier and what I should check first.',
      'Does this same issue show up elsewhere in my queue?',
      'Compare this equipment with the previous one.',
    ],
  },
];

function buildEvaluationPrompts() {
  const prompts: EvaluationPrompt[] = [];
  let counter = 1;
  for (const seed of PROMPT_SEEDS) {
    for (const prompt of seed.prompts) {
      prompts.push({
        id: `eval-${String(counter).padStart(3, '0')}`,
        capability: seed.capability,
        role: seed.role,
        module: seed.module,
        prompt,
      });
      counter += 1;
    }
  }
  return prompts;
}

export const EVALUATION_PROMPTS: EvaluationPrompt[] = buildEvaluationPrompts();
