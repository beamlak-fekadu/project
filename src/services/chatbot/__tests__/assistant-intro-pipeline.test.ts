import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChatRequest } from '@/services/chatbot/classifier-service';
import { buildDeterministicAssistantIntro, shouldUseProvider } from '@/services/chatbot/assistant-orchestrator';

test('assistant_intro classifier hits expected capability for greetings/help', () => {
  for (const prompt of ['hi', 'hello', 'help', 'what can you help me with']) {
    const classified = classifyChatRequest(prompt);
    assert.equal(classified.capability, 'assistant_intro');
    assert.equal(classified.intent, 'assistant_intro');
  }
});

test('assistant_intro deterministic payload is clean and local', () => {
  const assistant = buildDeterministicAssistantIntro();
  assert.equal(assistant.title, 'BMERMS Assistant');
  assert.equal(assistant.decision, 'answer');
  assert.equal(assistant.answer_basis, 'system_capabilities');
  assert.equal((assistant.proactive_signals ?? []).length, 0);
  assert.equal((assistant.routing_explanation ?? []).length, 0);
  assert.ok((assistant.actions ?? []).length >= 3);
  assert.ok((assistant.follow_up_suggestions ?? []).length >= 3);
  assert.equal(/```|\{/.test(assistant.summary), false);
});

test('provider is skipped for assistant_intro/help-like fallback text', () => {
  assert.equal(shouldUseProvider({ capability: 'assistant_intro', message: 'hi' }), false);
  assert.equal(
    shouldUseProvider({ capability: 'general_system_fallback', message: 'what can you do' }),
    false
  );
  assert.equal(shouldUseProvider({ capability: 'my_tasks', message: "what's on my to-do?" }), true);
});
