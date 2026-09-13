import assert from 'node:assert/strict';
import test from 'node:test';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

process.env.VLLM_BASE_URL = 'https://mock.runpod.test/v1/';
process.env.VLLM_MODEL = 'served-model-id';
process.env.VLLM_API_KEY = 'test-secret';
process.env.VLLM_TIMEOUT_MS = '25';
process.env.VLLM_MAX_TOKENS = '256';
process.env.VLLM_MAX_INPUT_CHARS = '1000';
process.env.VLLM_MAX_INPUT_MESSAGES = '8';
process.env.VLLM_MAX_HISTORY = '5';

const llm = await import(`../src/llm.js?tests=${Date.now()}`);
const encoder = new TextEncoder();

function responseFromChunks(chunks, init = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' }, ...init });
}

async function collect(iterator) {
  const values = [];
  for await (const value of iterator) values.push(value);
  return values;
}

test.after(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

test('streams string deltas and awaits terminal usage across fragmented CRLF SSE', async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return responseFromChunks([
      'data: {"choices":[{"delta":{"con',
      'tent":"hel"}}]}\r\n\r',
      '\ndata: {"choices":[{"delta":{"content":"lo"}}]}\r\n\r\n',
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\r\n\r\n',
      'data: [DONE]\r\n\r\n',
    ]);
  };

  const calls = [];
  const deltas = await collect(llm.streamChat([
    { role: 'user', content: 'Hi' },
  ], {
    maxTokens: 42,
    temperature: 0,
    onUsage: async (usage) => {
      await Promise.resolve();
      calls.push(usage);
    },
  }));

  assert.deepEqual(deltas, ['hel', 'lo']);
  assert.deepEqual(calls, [{ promptTokens: 7, completionTokens: 2, source: 'reported' }]);
  assert.equal(request.url, 'https://mock.runpod.test/v1/chat/completions');
  assert.equal(request.init.headers.authorization, 'Bearer test-secret');
  const body = JSON.parse(request.init.body);
  assert.equal(body.model, 'served-model-id');
  assert.equal(body.max_tokens, 42);
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.stream_options, { include_usage: true });
});

test('completeChat returns text and null when terminal usage is missing', async () => {
  globalThis.fetch = async () => responseFromChunks([
    'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  assert.deepEqual(await llm.completeChat([{ role: 'user', content: 'question' }]), {
    text: 'answer',
    usage: null,
  });
  assert.equal(await llm.chat([{ role: 'user', content: 'question' }]), 'answer');
});

test('calls onUsage exactly once with null after a successful unmetered stream', async () => {
  globalThis.fetch = async () => responseFromChunks(['data: [DONE]\n\n']);
  const calls = [];
  await collect(llm.streamChat([{ role: 'user', content: 'Hi' }], { onUsage: (usage) => calls.push(usage) }));
  assert.deepEqual(calls, [null]);
});

test('awaits and preserves errors from the caller-owned usage callback', async () => {
  globalThis.fetch = async () => responseFromChunks([
    'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\n',
    'data: [DONE]\n\n',
  ]);
  const settlementError = Object.assign(new Error('usage settlement failed'), { code: 'usage_write_failed' });
  await assert.rejects(
    collect(llm.streamChat([{ role: 'user', content: 'Hi' }], {
      onUsage: async () => { throw settlementError; },
    })),
    (error) => error === settlementError && error.code === 'usage_write_failed',
  );
});

test('rejects HTTP and in-stream server errors', async () => {
  globalThis.fetch = async () => new Response('provider unavailable', { status: 503 });
  await assert.rejects(
    collect(llm.streamChat([{ role: 'user', content: 'Hi' }])),
    (error) => error instanceof llm.LlmError && error.status === 503 && /provider unavailable/.test(error.message),
  );

  globalThis.fetch = async () => responseFromChunks([
    'data: {"error":{"message":"worker failed","status":502}}\n\n',
  ]);
  await assert.rejects(
    collect(llm.streamChat([{ role: 'user', content: 'Hi' }])),
    (error) => error instanceof llm.LlmError && error.status === 502 && /worker failed/.test(error.message),
  );
});

test('never accepts abrupt EOF and still reports known terminal usage once', async () => {
  globalThis.fetch = async () => responseFromChunks([
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":1}}\n\n',
  ]);
  const calls = [];
  await assert.rejects(
    collect(llm.streamChat([{ role: 'user', content: 'Hi' }], { onUsage: (usage) => calls.push(usage) })),
    /before the terminal \[DONE\]/,
  );
  assert.deepEqual(calls, [{ promptTokens: 4, completionTokens: 1, source: 'reported' }]);
});

test('rejects a fragmented terminal marker without a complete SSE event', async () => {
  globalThis.fetch = async () => responseFromChunks([
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
    'data: [DO',
    'NE]\n',
  ]);
  await assert.rejects(
    llm.completeChat([{ role: 'user', content: 'Hi' }]),
    /before the terminal \[DONE\]/,
  );
});

test('rejects malformed SSE JSON instead of silently losing output or usage', async () => {
  globalThis.fetch = async () => responseFromChunks(['data: {bad json}\n\n']);
  await assert.rejects(
    llm.completeChat([{ role: 'user', content: 'Hi' }]),
    /malformed JSON/,
  );
});

test('normalizes a request timeout and preserves caller abort semantics', async () => {
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  await assert.rejects(
    llm.completeChat([{ role: 'user', content: 'Hi' }]),
    (error) => error instanceof llm.LlmError && /within 25ms/.test(error.message),
  );

  const controller = new AbortController();
  const pending = llm.completeChat([{ role: 'user', content: 'Hi' }], { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
});

test('applies the timeout while reading the response stream', async () => {
  globalThis.fetch = async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    },
  }), { status: 200 });
  await assert.rejects(
    llm.completeChat([{ role: 'user', content: 'Hi' }]),
    (error) => error instanceof llm.LlmError && /within 25ms/.test(error.message),
  );
});

test('rejects a body read failure and does not convert partial output to success', async () => {
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
      controller.error(new Error('socket reset'));
    },
  }), { status: 200 });
  await assert.rejects(
    llm.completeChat([{ role: 'user', content: 'Hi' }]),
    /socket reset/,
  );
});

test('bounds direct inputs and per-call generation settings before fetch', async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return responseFromChunks(['data: [DONE]\n\n']);
  };
  await assert.rejects(
    llm.completeChat(Array.from({ length: 9 }, () => ({ role: 'user', content: 'x' }))),
    /limit is 8/,
  );
  await assert.rejects(
    llm.completeChat([{ role: 'user', content: 'x'.repeat(1001) }]),
    /Chunk the input/,
  );
  await assert.rejects(
    llm.completeChat([{ role: 'user', content: 'x' }], { maxTokens: 257 }),
    /VLLM_MAX_TOKENS/,
  );
  await assert.rejects(
    llm.completeChat([{ role: 'user', content: 'x' }], { temperature: 3 }),
    /between 0 and 2/,
  );
  assert.equal(fetchCalls, 0);
});

test('toChatMessages bounds only the outgoing history and keeps a recent contiguous suffix', () => {
  const history = Array.from({ length: 7 }, (_, index) => ({
    sender: index % 2 ? 'agent' : 'user',
    body: `turn-${index}`,
  }));
  assert.deepEqual(llm.toChatMessages('system', history, 'new'), [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'turn-2' },
    { role: 'assistant', content: 'turn-3' },
    { role: 'user', content: 'turn-4' },
    { role: 'assistant', content: 'turn-5' },
    { role: 'user', content: 'turn-6' },
    { role: 'user', content: 'new' },
  ]);
  assert.equal(history.length, 7);
});
