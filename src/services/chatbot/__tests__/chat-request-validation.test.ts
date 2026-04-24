import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatRequestSchema } from '@/types/chatbot';

test('valid minimal payload passes /api/chat request schema', () => {
  const parsed = ChatRequestSchema.safeParse({ message: 'hi' });
  assert.equal(parsed.success, true);
});

test('invalid missing message fails /api/chat request schema', () => {
  const parsed = ChatRequestSchema.safeParse({ sessionId: 'f1a5b3fe-6f95-4dbe-a5db-95c7f1936bc2' });
  assert.equal(parsed.success, false);
});

test('invalid contextRefs fails /api/chat request schema', () => {
  const parsed = ChatRequestSchema.safeParse({
    message: 'what can you help me with?',
    contextRefs: { equipmentId: 'not-a-uuid' },
  });
  assert.equal(parsed.success, false);
});

test('invalid sessionId fails /api/chat request schema', () => {
  const parsed = ChatRequestSchema.safeParse({
    message: "what's on my to-do?",
    sessionId: 'bad-session-id',
  });
  assert.equal(parsed.success, false);
});
