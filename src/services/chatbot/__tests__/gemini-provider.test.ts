import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_UNAVAILABLE_SUGGESTION,
  AI_UNAVAILABLE_SUMMARY,
} from '../providers/normalize-provider-output';

const minimalAssistantJson = JSON.stringify({
  decision: 'answer',
  summary: 'Operational summary from test provider.',
  answer_basis: 'system_data',
  confidence: 'high',
  escalation_required: false,
  actions: ['Verify asset status in CMMS.'],
  insights: ['Evidence loaded from test fixture.'],
  recommendations: ['Continue monitoring open work orders.'],
});

test('geminiProvider maps OpenAI-shaped JSON into structured assistant output', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  process.env.GEMINI_API_KEY = 'test-api-key';

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.match(String(input), /chat\/completions$/);
    assert.equal(init?.method, 'POST');
    return new Response(
      JSON.stringify({
        id: 'resp-test',
        model: 'gemini-mock',
        choices: [{ finish_reason: 'stop', message: { content: minimalAssistantJson } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const { geminiProvider } = await import('../providers/gemini-provider');
    const result = await geminiProvider.generate({
      messages: [
        { role: 'system', content: 'You are a test assistant.' },
        { role: 'user', content: 'Ping' },
      ],
      requiredDecision: 'answer',
      intent: 'maintenance_tip',
    });

    assert.equal(result.provider, 'gemini');
    assert.equal(result.model, 'gemini-mock');
    assert.ok(result.assistant.summary.includes('test provider'));
    assert.equal((result.providerMetadata as { emptyModelContent?: boolean }).emptyModelContent, false);
    assert.equal((result.providerMetadata as { httpStatus?: number }).httpStatus, 200);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('geminiProvider marks empty model content in metadata', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-api-key';

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: 'empty', model: 'gemini-mock', choices: [{ message: { content: '' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const { geminiProvider } = await import('../providers/gemini-provider');
    const result = await geminiProvider.generate({
      messages: [{ role: 'user', content: 'Ping' }],
      requiredDecision: 'limited_answer',
      intent: 'maintenance_tip',
    });
    assert.equal((result.providerMetadata as { emptyModelContent?: boolean }).emptyModelContent, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

const originalSetTimeout = globalThis.setTimeout;
afterEach(() => {
  globalThis.setTimeout = originalSetTimeout;
});

function zeroBackoffForTests() {
  globalThis.setTimeout = ((fn: TimerHandler, _delay?: number, ...args: unknown[]) =>
    originalSetTimeout(fn as () => void, 0, ...(args as []))) as unknown as typeof setTimeout;
}

test('postGeminiChatCompletions retries 503 then succeeds (3 fetch calls)', async () => {
  zeroBackoffForTests();
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-api-key';

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls <= 2) {
      return new Response('unavailable', { status: 503 });
    }
    return new Response(
      JSON.stringify({
        id: 'after-retry',
        model: 'gemini-mock',
        choices: [{ finish_reason: 'stop', message: { content: minimalAssistantJson } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const { geminiProvider } = await import('../providers/gemini-provider');
    const result = await geminiProvider.generate({
      messages: [{ role: 'user', content: 'Ping' }],
      requiredDecision: 'answer',
      intent: 'maintenance_tip',
    });
    assert.equal(calls, 3);
    assert.ok(result.assistant.summary.includes('test provider'));
    assert.notEqual((result.providerMetadata as { providerFallback?: boolean }).providerFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('geminiProvider returns AI unavailable assistant after 503 exhausted', async () => {
  zeroBackoffForTests();
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-api-key';

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('unavailable', { status: 503 });
  };

  try {
    const { geminiProvider } = await import('../providers/gemini-provider');
    const result = await geminiProvider.generate({
      messages: [{ role: 'user', content: 'Ping' }],
      requiredDecision: 'limited_answer',
      intent: 'maintenance_tip',
    });
    assert.equal(calls, 4);
    assert.equal(result.assistant.summary, AI_UNAVAILABLE_SUMMARY);
    assert.ok((result.assistant.follow_up_suggestions ?? []).includes(AI_UNAVAILABLE_SUGGESTION));
    assert.equal((result.providerMetadata as { providerFallback?: boolean }).providerFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('geminiProvider normalizes plain text model content to structured assistant', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-api-key';

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'plain',
        model: 'gemini-mock',
        choices: [{ finish_reason: 'stop', message: { content: 'Hello, this is not JSON.' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  try {
    const { geminiProvider } = await import('../providers/gemini-provider');
    const result = await geminiProvider.generate({
      messages: [{ role: 'user', content: 'Ping' }],
      requiredDecision: 'limited_answer',
      intent: 'maintenance_tip',
    });
    assert.ok(result.assistant.summary.length > 0);
    assert.ok(Array.isArray(result.assistant.key_findings));
    assert.ok(Array.isArray(result.assistant.actions));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('geminiProvider normalizes malformed JSON string in model content', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-api-key';

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'badjson',
        model: 'gemini-mock',
        choices: [{ finish_reason: 'stop', message: { content: '{ not json' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  try {
    const { geminiProvider } = await import('../providers/gemini-provider');
    const result = await geminiProvider.generate({
      messages: [{ role: 'user', content: 'Ping' }],
      requiredDecision: 'answer',
      intent: 'maintenance_tip',
    });
    assert.ok(result.assistant.summary.length > 0);
    assert.ok(Array.isArray(result.assistant.recommendations));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('text-mode greetings return intro without parser fallback', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-api-key';

  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { response_format?: unknown };
    assert.equal(body.response_format, undefined);
    return new Response(
      JSON.stringify({
        id: 'intro',
        model: 'gemini-mock',
        choices: [{ finish_reason: 'stop', message: { content: 'Hi, I can help with tasks, work orders, and safe troubleshooting.' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const { geminiProvider } = await import('../providers/gemini-provider');
    for (const prompt of ['hi', 'hello', 'what can you help me with?']) {
      const result = await geminiProvider.generate({
        messages: [{ role: 'user', content: prompt }],
        requiredDecision: 'answer',
        intent: 'assistant_intro',
        responseMode: 'text',
        capability: 'assistant_intro',
      });
      assert.equal(result.assistant.decision, 'answer');
      assert.ok(result.assistant.summary.toLowerCase().includes('help'));
      assert.notEqual((result.providerMetadata as { providerFallback?: boolean }).providerFallback, true);
      assert.equal(
        (result.providerMetadata as { parser?: { parserStrategy?: string } }).parser?.parserStrategy,
        'plain_text_wrapped'
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('text-mode plain text output is wrapped safely', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-api-key';

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'plain-text-mode',
        model: 'gemini-mock',
        choices: [{ finish_reason: 'stop', message: { content: 'Hello! I can help with tasks, work orders, and PM.' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  try {
    const { geminiProvider } = await import('../providers/gemini-provider');
    const result = await geminiProvider.generate({
      messages: [{ role: 'user', content: 'hi' }],
      requiredDecision: 'answer',
      intent: 'assistant_intro',
      responseMode: 'text',
      capability: 'assistant_intro',
    });
    assert.ok(result.assistant.summary.toLowerCase().includes('help'));
    assert.equal((result.providerMetadata as { parser?: { parserStrategy?: string } }).parser?.parserStrategy, 'plain_text_wrapped');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('text-mode raw JSON output is parsed into structured assistant fields', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-api-key';

  const jsonContent = JSON.stringify({
    decision: 'answer',
    title: 'BMERMS Assistant',
    summary: 'I can help with tasks and work orders.',
    actions: ['Check your assigned queue.'],
    insights: ['Your department has pending PM.'],
    recommendations: ['Prioritize critical open work orders.'],
    follow_up_suggestions: ['What is on my to-do?', 'Show open alerts'],
    proactive_signals: ['2 high-priority work orders are open.'],
    answer_basis: 'general_safe_guidance',
    confidence: 'medium',
    entities_referenced: ['work_order'],
    routing_explanation: ['assistant_intro matched'],
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'json-text-mode',
        model: 'gemini-mock',
        choices: [{ finish_reason: 'stop', message: { content: jsonContent } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  try {
    const { geminiProvider } = await import('../providers/gemini-provider');
    const result = await geminiProvider.generate({
      messages: [{ role: 'user', content: 'hello' }],
      requiredDecision: 'answer',
      intent: 'assistant_intro',
      responseMode: 'text',
      capability: 'assistant_intro',
    });
    assert.equal(result.assistant.summary, 'I can help with tasks and work orders.');
    assert.ok((result.assistant.actions ?? []).includes('Check your assigned queue.'));
    assert.equal((result.providerMetadata as { parser?: { parserStrategy?: string } }).parser?.parserStrategy, 'json_candidate');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('text-mode fenced JSON output is parsed and fences are not shown in summary', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-api-key';

  const fenced = `\`\`\`json
{"decision":"answer","title":"BMERMS Assistant","summary":"Structured intro from fenced JSON.","recommendations":["Review PM status."],"follow_up_suggestions":["what's on my to-do?"],"answer_basis":"general_safe_guidance","confidence":"medium"}
\`\`\``;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'fenced-json-text-mode',
        model: 'gemini-mock',
        choices: [{ finish_reason: 'stop', message: { content: fenced } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  try {
    const { geminiProvider } = await import('../providers/gemini-provider');
    const result = await geminiProvider.generate({
      messages: [{ role: 'user', content: 'what can you help me with?' }],
      requiredDecision: 'answer',
      intent: 'assistant_intro',
      responseMode: 'text',
      capability: 'assistant_intro',
    });
    assert.equal(result.assistant.summary, 'Structured intro from fenced JSON.');
    assert.equal(result.assistant.summary.includes('```'), false);
    assert.equal((result.providerMetadata as { parser?: { parserStrategy?: string } }).parser?.parserStrategy, 'json_candidate');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('text-mode malformed JSON falls back to safe plain text summary', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-api-key';

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'bad-json-text-mode',
        model: 'gemini-mock',
        choices: [{ finish_reason: 'stop', message: { content: '```json\n{ not valid json }\n```' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  try {
    const { geminiProvider } = await import('../providers/gemini-provider');
    const result = await geminiProvider.generate({
      messages: [{ role: 'user', content: 'hi' }],
      requiredDecision: 'answer',
      intent: 'assistant_intro',
      responseMode: 'text',
      capability: 'assistant_intro',
    });
    assert.ok(result.assistant.summary.length > 0);
    assert.equal(result.assistant.title, 'Response formatting issue');
    assert.equal((result.providerMetadata as { parser?: { parserStrategy?: string } }).parser?.parserStrategy, 'format_recovery');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
