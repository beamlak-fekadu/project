import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFollowUp } from '@/services/chatbot/follow-up-handlers';

test('ambiguous follow-up asks for clarification when memory confidence is low', () => {
  const result = handleFollowUp({
    message: 'why?',
    memory: {
      shortSummary: 'Prior topic was noisy.',
      activeCapability: 'summarize_equipment',
      lastEntityLabels: [],
      lastSummary: 'A prior answer existed but had no reliable entity.',
      memoryConfidence: 'low',
      memoryAgeTurns: 2,
    },
    decision: 'limited_answer',
  });

  assert.equal(result?.needsClarification, true);
  assert.equal(result?.answer.answer_basis, 'insufficient_data');
  assert.match(result?.answer.summary ?? '', /missing the earlier topic/i);
});

test('ambiguous follow-up can use recent high-confidence entity memory', () => {
  const result = handleFollowUp({
    message: 'why?',
    memory: {
      shortSummary: 'ED-0002 had overdue PM and an open work order.',
      activeCapability: 'summarize_equipment',
      lastEntityLabels: ['ED-0002 Patient Monitor'],
      lastEvidenceUsed: ['Asset ED-0002', 'Open work order WO-1234'],
      lastSummary: 'ED-0002 had overdue PM and an open work order.',
      memoryConfidence: 'high',
      memoryAgeTurns: 1,
      lastEvidenceCompleteness: { status: 'partial', score: 0.75, requiredMissing: [] },
    },
    decision: 'answer',
  });

  assert.equal(result?.needsClarification, undefined);
  assert.match(result?.answer.summary ?? '', /ED-0002|Patient Monitor|prior/i);
});
