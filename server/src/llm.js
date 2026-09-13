// Client for the vLLM server on RunPod (OpenAI-compatible HTTP API) serving Qwen.
//
// Configure with VLLM_BASE_URL (must end in /v1) and, for RunPod serverless or
// a pod started with --api-key, VLLM_API_KEY. When VLLM_BASE_URL is unset,
// isConfigured() is false and agent.js falls back to the canned stub so local
// dev works without a GPU.

const BASE = (process.env.VLLM_BASE_URL ?? '').trim().replace(/\/+$/, '');
const API_KEY = (process.env.VLLM_API_KEY ?? '').trim();
const TIMEOUT_MS = Number(process.env.VLLM_TIMEOUT_MS ?? 120_000);
const MAX_TOKENS = Number(process.env.VLLM_MAX_TOKENS ?? 1024);
const TEMPERATURE = Number(process.env.VLLM_TEMPERATURE ?? 0.7);
// Qwen3 "thinking" would otherwise stream a long reasoning preamble first.
const DISABLE_THINKING = (process.env.VLLM_DISABLE_THINKING ?? 'true') !== 'false';
const MAX_HISTORY = Number(process.env.VLLM_MAX_HISTORY ?? 30);

let model = (process.env.VLLM_MODEL ?? '').trim();

export const isConfigured = () => Boolean(BASE);

export class LlmError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.status = status;
    this.cause = cause;
  }
}

function headers(json = false) {
  const h = { accept: 'application/json' };
  if (json) h['content-type'] = 'application/json';
  if (API_KEY) h.authorization = `Bearer ${API_KEY}`;
  return h;
}

// Caller's signal (client disconnect) OR the request timeout, whichever first.
function withTimeout(signal) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function llmFetch(path, init = {}) {
  if (!isConfigured()) throw new LlmError('VLLM_BASE_URL is not set');
  let res;
  try {
    res = await fetch(BASE + path, { ...init, signal: withTimeout(init.signal) });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new LlmError(`vLLM did not answer within ${TIMEOUT_MS}ms`, { cause: e });
    if (e.name === 'AbortError') throw e;
    throw new LlmError(`Cannot reach vLLM at ${BASE}: ${e.cause?.message ?? e.message}`, { cause: e });
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 500);
    throw new LlmError(`vLLM ${res.status} on ${path}${text ? `: ${text}` : ''}`, { status: res.status });
  }
  return res;
}

// GET /v1/models: the cheapest real round trip, and it tells us what is served.
export async function listModels({ signal } = {}) {
  const res = await llmFetch('/models', { headers: headers(), signal });
  const data = await res.json();
  return (data.data ?? []).map((m) => m.id);
}

// VLLM_MODEL if set, otherwise whatever the server serves first (a RunPod pod
// usually serves exactly one). Cached after the first call.
export async function getModel() {
  if (model) return model;
  const models = await listModels();
  if (!models.length) throw new LlmError('vLLM reports no served models');
  model = models[0];
  return model;
}

// Health probe used by GET /llm/health and `npm run llm:ping`.
export async function ping() {
  if (!isConfigured()) return { ok: false, configured: false, error: 'VLLM_BASE_URL is not set' };
  const started = Date.now();
  try {
    const models = await listModels();
    return { ok: true, configured: true, baseUrl: BASE, model: model || models[0] || null, models, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, configured: true, baseUrl: BASE, error: e.message, latencyMs: Date.now() - started };
  }
}

// DB rows ({sender: 'user'|'agent', body}) -> OpenAI chat messages.
export function toChatMessages(systemPrompt, history, message) {
  const turns = history
    .slice(-MAX_HISTORY)
    .filter((m) => m.body?.trim())
    .map((m) => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.body }));
  return [{ role: 'system', content: systemPrompt }, ...turns, { role: 'user', content: message }];
}

// Minimal SSE reader for the completion stream: yields each `data:` payload.
async function* sseData(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

// Streaming chat completion. Yields text deltas as the model produces them.
export async function* streamChat(messages, { signal } = {}) {
  const body = {
    model: await getModel(),
    messages,
    stream: true,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
  };
  if (DISABLE_THINKING) body.chat_template_kwargs = { enable_thinking: false };

  const res = await llmFetch('/chat/completions', {
    method: 'POST',
    headers: { ...headers(true), accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });

  for await (const data of sseData(res.body)) {
    if (data === '[DONE]') return;
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    if (json.error) throw new LlmError(json.error.message ?? 'vLLM stream error');
    const delta = json.choices?.[0]?.delta?.content; // reasoning_content (thinking) is skipped on purpose
    if (delta) yield delta;
  }
}

// Non-streaming convenience: same call, whole answer.
export async function chat(messages, opts) {
  let out = '';
  for await (const delta of streamChat(messages, opts)) out += delta;
  return out;
}
