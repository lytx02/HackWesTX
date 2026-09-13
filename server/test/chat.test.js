import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:1/unused';
process.env.VLLM_BASE_URL = 'https://unit.test/v1';
process.env.VLLM_MODEL = 'configured-test-model';
process.env.VLLM_API_KEY = 'test-key';

const encoder = new TextEncoder();
const response = (events) => new Response(new ReadableStream({
  start(controller) {
    for (const event of events) controller.enqueue(encoder.encode(event));
    controller.close();
  },
}), { status: 200, headers: { 'content-type': 'text/event-stream' } });

const { errorPayload } = await import('../src/http.js');
const { estimateChatUsage, replyStream } = await import('../src/agent.js');

async function collect(iterator) {
  let result = '';
  for await (const value of iterator) result += value;
  return result;
}

test('agent passes reported transport usage through awaited metering callback', async (t) => {
  t.after(() => { globalThis.fetch = undefined; });
  globalThis.fetch = async () => response([
    'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n',
    'data: [DONE]\n\n',
  ]);
  const calls = [];
  const seen = [];
  const text = await collect(replyStream({
    systemPrompt: 'system',
    history: [],
    message: 'hi',
    beforeModelCall: async () => { calls.push('before'); },
    recordUsage: async (usage) => { calls.push('record'); return usage; },
    onUsage: async (usage) => { calls.push('notify'); seen.push(usage); },
  }));
  assert.equal(text, 'hello');
  assert.deepEqual(calls, ['before', 'record', 'notify']);
  assert.deepEqual(seen, [{ promptTokens: 7, completionTokens: 2, source: 'reported' }]);
});

test('missing provider usage is estimated and marked before assistant persistence', async (t) => {
  t.after(() => { globalThis.fetch = undefined; });
  globalThis.fetch = async () => response([
    'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  let recorded;
  const text = await collect(replyStream({
    systemPrompt: 'system prompt',
    history: [{ sender: 'agent', body: 'prior' }],
    message: 'question',
    beforeModelCall: async () => {},
    recordUsage: async (usage) => { recorded = usage; return usage; },
  }));
  assert.equal(text, 'answer');
  assert.equal(recorded.source, 'estimated');
  assert.ok(recorded.promptTokens > 0);
  assert.ok(recorded.completionTokens > 0);
  assert.deepEqual(recorded, estimateChatUsage([
    { role: 'system', content: 'system prompt' },
    { role: 'assistant', content: 'prior' },
    { role: 'user', content: 'question' },
  ], 'answer'));
});

test('abrupt failure settles partial output exactly once with estimated metadata', async (t) => {
  t.after(() => { globalThis.fetch = undefined; });
  globalThis.fetch = async () => response([
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
  ]);
  const recorded = [];
  await assert.rejects(
    collect(replyStream({
      systemPrompt: 'system',
      history: [],
      message: 'question',
      beforeModelCall: async () => {},
      recordUsage: async (usage) => { recorded.push(usage); return usage; },
    })),
    /before the terminal \[DONE\]/
  );
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].source, 'estimated');
  assert.ok(recorded[0].completionTokens >= 3);
});

test('SSE error payload preserves quota and concurrency metadata for the frontend', () => {
  const error = Object.assign(new Error('quota'), {
    status: 429,
    code: 'ai_quota_exceeded',
    limit: 4321,
    resetsAt: '2026-09-14T05:00:00.000Z',
  });
  assert.deepEqual(errorPayload(error), {
    error: 'quota',
    status: 429,
    code: 'ai_quota_exceeded',
    limit: 4321,
    resetsAt: '2026-09-14T05:00:00.000Z',
  });
  assert.deepEqual(errorPayload(Object.assign(new Error('busy'), { status: 409, code: 'ai_request_in_progress' })), {
    error: 'busy',
    status: 409,
    code: 'ai_request_in_progress',
  });
});

