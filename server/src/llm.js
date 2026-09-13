// Client for a vLLM server on RunPod's OpenAI-compatible HTTP API.
//
// All deployment-specific values come from the server environment. When the
// URL, exact served model, or API key is unset, isConfigured() is false and
// agent.js can continue to use its local-development stub.

export class LlmError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.cause = cause;
  }
}

function finiteNumber(name, fallback, { integer = false, min, max } = {}) {
  const raw = process.env[name];
  const value = raw == null || raw.trim() === '' ? fallback : Number(raw);
  if (!Number.isFinite(value)
    || (integer && !Number.isSafeInteger(value))
    || (min != null && value < min)
    || (max != null && value > max)) {
    throw new LlmError(`${name} must be ${integer ? 'a safe integer' : 'a number'} between ${min} and ${max}`);
  }
  return value;
}

const BASE = (process.env.VLLM_BASE_URL ?? '').trim().replace(/\/+$/, '');
const API_KEY = (process.env.VLLM_API_KEY ?? '').trim();
const MODEL = (process.env.VLLM_MODEL ?? '').trim();
const TIMEOUT_MS = finiteNumber('VLLM_TIMEOUT_MS', 120_000, { integer: true, min: 1, max: 3_600_000 });
const MAX_TOKENS = finiteNumber('VLLM_MAX_TOKENS', 1024, { integer: true, min: 1, max: 1_000_000 });
const TEMPERATURE = finiteNumber('VLLM_TEMPERATURE', 0.7, { min: 0, max: 2 });
const MAX_HISTORY = finiteNumber('VLLM_MAX_HISTORY', 30, { integer: true, min: 0, max: 10_000 });
const MAX_INPUT_MESSAGES = finiteNumber('VLLM_MAX_INPUT_MESSAGES', 64, { integer: true, min: 2, max: 10_000 });
const MAX_INPUT_CHARS = finiteNumber('VLLM_MAX_INPUT_CHARS', 60_000, { integer: true, min: 1, max: 100_000_000 });
// Qwen thinking would otherwise stream a reasoning preamble before the answer.
const DISABLE_THINKING = (process.env.VLLM_DISABLE_THINKING ?? 'true') !== 'false';

export const isConfigured = () => Boolean(BASE && MODEL && API_KEY);

function headers(json = false) {
  const result = { accept: 'application/json' };
  if (json) result['content-type'] = 'application/json';
  if (API_KEY) result.authorization = `Bearer ${API_KEY}`;
  return result;
}

function requestSignal(callerSignal) {
  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
  return {
    signal: callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal,
    timeoutSignal,
  };
}

function transportError(error, callerSignal, timeoutSignal) {
  if (callerSignal?.aborted) {
    if (callerSignal.reason instanceof Error) return callerSignal.reason;
    return new DOMException('The operation was aborted', 'AbortError');
  }
  if (timeoutSignal?.aborted || error?.name === 'TimeoutError') {
    return new LlmError(`vLLM did not answer within ${TIMEOUT_MS}ms`, { cause: error });
  }
  if (error instanceof LlmError) return error;
  return new LlmError(`Cannot reach vLLM at ${BASE}: ${error?.cause?.message ?? error?.message ?? String(error)}`, { cause: error });
}

async function llmFetch(path, init = {}) {
  if (!BASE) throw new LlmError('VLLM_BASE_URL is not set');
  const callerSignal = init.signal;
  const request = requestSignal(callerSignal);
  try {
    const response = await fetch(BASE + path, { ...init, signal: request.signal });
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 500);
      throw new LlmError(`vLLM ${response.status} on ${path}${text ? `: ${text}` : ''}`, { status: response.status });
    }
    return { response, ...request, callerSignal };
  } catch (error) {
    throw transportError(error, callerSignal, request.timeoutSignal);
  }
}

// GET /v1/models is a cheap real round trip used by health diagnostics.
export async function listModels({ signal } = {}) {
  const request = await llmFetch('/models', { headers: headers(), signal });
  try {
    const data = await request.response.json();
    return Array.isArray(data.data) ? data.data.map((entry) => entry.id).filter(Boolean) : [];
  } catch (error) {
    throw transportError(error, request.callerSignal, request.timeoutSignal);
  }
}

// The exact served model is deployment configuration; it is never guessed.
export async function getModel() {
  if (!MODEL) throw new LlmError('VLLM_MODEL is not set');
  return MODEL;
}

// Health probe used by GET /llm/health and `npm run llm:ping`.
export async function ping() {
  const missing = [];
  if (!BASE) missing.push('VLLM_BASE_URL');
  if (!MODEL) missing.push('VLLM_MODEL');
  if (!API_KEY) missing.push('VLLM_API_KEY');
  if (missing.length) {
    return { ok: false, configured: false, error: `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set` };
  }

  const started = Date.now();
  try {
    const models = await listModels();
    const modelAvailable = models.includes(MODEL);
    return {
      ok: modelAvailable,
      configured: true,
      baseUrl: BASE,
      model: MODEL,
      models,
      modelAvailable,
      ...(modelAvailable ? {} : { error: `Configured model ${MODEL} is not listed by vLLM` }),
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return { ok: false, configured: true, baseUrl: BASE, model: MODEL, error: error.message, latencyMs: Date.now() - started };
  }
}

// Content is a string, or (VLLM_VISION=true) an array of OpenAI content parts.
const VISION = process.env.VLLM_VISION === 'true';
export const contentText = (content) =>
  typeof content === 'string' ? content : content.filter((p) => p?.type === 'text').map((p) => p.text).join('');
const isPart = (p) =>
  (p?.type === 'text' && typeof p.text === 'string') || (p?.type === 'image_url' && typeof p.image_url?.url === 'string');

function contentLength(messages) {
  return messages.reduce((total, entry) => total + contentText(entry.content).length, 0);
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new LlmError('Model input must contain at least one chat message');
  }
  if (messages.length > MAX_INPUT_MESSAGES) {
    throw new LlmError(`Model input has ${messages.length} messages; limit is ${MAX_INPUT_MESSAGES}. Chunk the input before calling the model.`);
  }
  for (const entry of messages) {
    const okContent =
      typeof entry?.content === 'string' || (Array.isArray(entry?.content) && entry.content.length > 0 && entry.content.every(isPart));
    if (!entry || typeof entry.role !== 'string' || !okContent) {
      throw new LlmError('Each model input message must have a string role and string or content-part content');
    }
  }
  const chars = contentLength(messages);
  if (chars > MAX_INPUT_CHARS) {
    throw new LlmError(`Model input has ${chars} characters; limit is ${MAX_INPUT_CHARS}. Chunk the input before calling the model.`);
  }
}

// DB rows ({sender: 'user'|'agent', body}) -> bounded OpenAI chat messages.
// History rows themselves are untouched; only the outgoing prompt uses a
// contiguous suffix that fits the configured limits.
// `images` (data URLs attached to the new turn) become image_url parts when
// VLLM_VISION=true; otherwise the text already names them and they are dropped.
export function toChatMessages(systemPrompt, history, message, images = []) {
  if (typeof systemPrompt !== 'string' || typeof message !== 'string' || !Array.isArray(history)) {
    throw new LlmError('toChatMessages requires a system prompt, history array, and user message');
  }

  const userContent =
    VISION && images.length
      ? [{ type: 'text', text: message }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
      : message;
  const fixed = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
  if (contentLength(fixed) > MAX_INPUT_CHARS) {
    throw new LlmError(`System prompt and user message exceed the ${MAX_INPUT_CHARS}-character model input limit`);
  }

  const candidates = history
    .slice(-Math.min(MAX_HISTORY, MAX_INPUT_MESSAGES - 2))
    .filter((entry) => typeof entry?.body === 'string' && entry.body.trim())
    .map((entry) => ({ role: entry.sender === 'user' ? 'user' : 'assistant', content: entry.body }));
  const turns = [];
  let chars = contentLength(fixed);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (chars + contentText(candidate.content).length > MAX_INPUT_CHARS) break;
    turns.unshift(candidate);
    chars += contentText(candidate.content).length;
  }
  return [fixed[0], ...turns, fixed[1]];
}

function requestOptions({ maxTokens, temperature } = {}) {
  const requestedMaxTokens = maxTokens ?? MAX_TOKENS;
  if (!Number.isSafeInteger(requestedMaxTokens) || requestedMaxTokens < 1 || requestedMaxTokens > MAX_TOKENS) {
    throw new LlmError(`maxTokens must be a positive safe integer no greater than VLLM_MAX_TOKENS (${MAX_TOKENS})`);
  }
  const requestedTemperature = temperature ?? TEMPERATURE;
  if (!Number.isFinite(requestedTemperature) || requestedTemperature < 0 || requestedTemperature > 2) {
    throw new LlmError('temperature must be a number between 0 and 2');
  }
  return { maxTokens: requestedMaxTokens, temperature: requestedTemperature };
}

// Parses complete SSE events while accepting arbitrary byte fragmentation and
// LF or CRLF framing. An incomplete final event is deliberately not emitted.
async function* sseData(body) {
  if (!body) throw new LlmError('vLLM returned a streaming response without a body');
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines = [];

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') {
        if (dataLines.length) yield dataLines.join('\n');
        dataLines = [];
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
  }
  decoder.decode();
  // SSE dispatches an event only after its terminating blank line. Keeping any
  // remaining buffer/dataLines unconsumed lets streamChat classify EOF as abrupt.
}

function reportedUsage(value) {
  const promptTokens = value?.prompt_tokens;
  const completionTokens = value?.completion_tokens;
  if (!Number.isSafeInteger(promptTokens) || promptTokens < 0
    || !Number.isSafeInteger(completionTokens) || completionTokens < 0) return null;
  return { promptTokens, completionTokens, source: 'reported' };
}

// Streaming chat completion. Yields only text deltas and awaits onUsage once
// after a terminal response. A server usage-only chunk is retained for that call.
export async function* streamChat(messages, {
  signal,
  onUsage,
  maxTokens,
  temperature,
} = {}) {
  validateMessages(messages);
  if (onUsage != null && typeof onUsage !== 'function') throw new LlmError('onUsage must be a function');
  const options = requestOptions({ maxTokens, temperature });
  const body = {
    model: await getModel(),
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: options.maxTokens,
    temperature: options.temperature,
  };
  if (DISABLE_THINKING) body.chat_template_kwargs = { enable_thinking: false };

  const request = await llmFetch('/chat/completions', {
    method: 'POST',
    headers: { ...headers(true), accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });

  let usage = null;
  let usageDelivered = false;
  let done = false;
  try {
    for await (const data of sseData(request.response.body)) {
      if (data === '[DONE]') {
        done = true;
        break;
      }
      let payload;
      try {
        payload = JSON.parse(data);
      } catch (error) {
        throw new LlmError('vLLM returned malformed JSON in its completion stream', { cause: error });
      }
      if (payload.error) {
        throw new LlmError(payload.error.message ?? 'vLLM stream error', { status: payload.error.status });
      }
      const eventUsage = reportedUsage(payload.usage);
      if (eventUsage) usage = eventUsage;
      const delta = payload.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) yield delta;
    }
    if (!done) throw new LlmError('vLLM completion stream ended before the terminal [DONE] event');
    if (onUsage) {
      usageDelivered = true;
      await onUsage(usage);
    }
  } catch (error) {
    // Usage callbacks belong to the caller (for example, quota settlement).
    // Preserve their error type and metadata instead of relabeling them as a
    // provider transport failure.
    if (usageDelivered) throw error;
    // A terminal usage chunk can arrive immediately before a broken connection.
    // Settle that known consumption even though the response itself must fail.
    if (onUsage && usage && !usageDelivered) {
      usageDelivered = true;
      await onUsage(usage);
    }
    throw transportError(error, request.callerSignal, request.timeoutSignal);
  }
}

export async function completeChat(messages, { signal, maxTokens, temperature } = {}) {
  let text = '';
  let usage = null;
  for await (const delta of streamChat(messages, {
    signal,
    maxTokens,
    temperature,
    onUsage: (reported) => { usage = reported; },
  })) text += delta;
  return { text, usage };
}

// Legacy convenience export: resolves to the full response string.
export async function chat(messages, opts) {
  let output = '';
  for await (const delta of streamChat(messages, opts)) output += delta;
  return output;
}
