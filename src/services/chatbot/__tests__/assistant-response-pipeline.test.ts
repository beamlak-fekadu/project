import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistantContentSchema, type CapabilityId } from '@/types/chatbot';
import { normalizeAssistantResponse } from '@/services/chatbot/assistant-response-pipeline';
import { AI_UNAVAILABLE_SUMMARY } from '@/services/chatbot/providers/normalize-provider-output';

const CAPABILITIES: CapabilityId[] = [
  'assistant_intro',
  'general_conversation',
  'off_topic_safe',
  'my_tasks',
  'safe_troubleshooting',
  'summarize_work_order',
  'general_system_fallback',
];

const VALID_ASSISTANT_OBJECT = {
  decision: 'answer',
  title: 'Test',
  summary: 'Structured assistant response.',
  answer_basis: 'system_data',
  confidence: 'high',
  escalation_required: false,
  actions: [],
  insights: [],
  recommendations: [],
  key_findings: [],
  recommended_actions: [],
  priority_reasoning: [],
  likely_causes: [],
  troubleshooting_steps: [],
  maintenance_tips: [],
  required_tools_or_parts: [],
  entities_referenced: [],
  follow_up_suggestions: [],
  proactive_signals: [],
  routing_explanation: [],
};

const CASES: Array<{ name: string; raw: unknown; providerStatus: 'success' | 'failure' }> = [
  { name: 'valid assistant object', raw: VALID_ASSISTANT_OBJECT, providerStatus: 'success' },
  { name: 'valid json string', raw: JSON.stringify(VALID_ASSISTANT_OBJECT), providerStatus: 'success' },
  { name: 'json in json fence', raw: `\`\`\`json\n${JSON.stringify(VALID_ASSISTANT_OBJECT)}\n\`\`\``, providerStatus: 'success' },
  { name: 'json in generic fence', raw: `\`\`\`\n${JSON.stringify(VALID_ASSISTANT_OBJECT)}\n\`\`\``, providerStatus: 'success' },
  { name: 'json plus prose', raw: `Here is the response:\n${JSON.stringify(VALID_ASSISTANT_OBJECT)}\nthanks`, providerStatus: 'success' },
  { name: 'plain text', raw: 'This is a plain text answer with useful context.', providerStatus: 'success' },
  { name: 'malformed json', raw: '{"decision":"answer","summary":"partial"', providerStatus: 'success' },
  { name: 'truncated json', raw: '{"decision":"answer","summary":"truncated', providerStatus: 'success' },
  { name: 'empty content', raw: '   ', providerStatus: 'success' },
  { name: 'provider failure', raw: '', providerStatus: 'failure' },
];

for (const capability of CAPABILITIES) {
  for (const sample of CASES) {
    test(`normalizeAssistantResponse ${sample.name} [${capability}]`, () => {
      const result = normalizeAssistantResponse({
        rawProviderContent: sample.raw,
        capability,
        responseMode: capability === 'assistant_intro' ? 'text' : 'structured',
        providerStatus: sample.providerStatus,
        requiredDecision: 'limited_answer',
      });

      assert.equal(AssistantContentSchema.safeParse(result.assistant).success, true);
      assert.ok(result.assistant.summary.trim().length > 0);
      assert.equal(result.assistant.summary.includes('```'), false);
      assert.equal(/^\{[\s\S]*\}$/.test(result.assistant.summary.trim()), false);

      if (sample.providerStatus === 'failure') {
        assert.equal(result.assistant.summary, AI_UNAVAILABLE_SUMMARY);
      } else {
        assert.notEqual(result.assistant.summary, AI_UNAVAILABLE_SUMMARY);
      }
    });
  }
}
