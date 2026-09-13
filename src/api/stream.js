// Streaming calls to the API. The server answers chat messages as Server-Sent
// Events; EventSource cannot POST or send the auth header, so this reads the
// fetch body by hand and dispatches `event:` / `data:` pairs to `onEvent`.

import { ApiError, errorFromPayload, resolveToken } from './client.js';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

async function streamRequest(path, body, { onEvent, signal } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
  const token = await resolveToken();
  if (token) headers.authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, `Cannot reach the API at ${BASE}. Is the server running?`);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw errorFromPayload(res.status, data, res.statusText);
  }
  if (!res.body) throw new ApiError(0, 'Streaming is not supported by this browser');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event = 'message';
  let data = [];

  const dispatch = () => {
    if (data.length) onEvent?.(event, JSON.parse(data.join('\n')));
    event = 'message';
    data = [];
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line === '') dispatch();
      else if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      // lines starting with ':' are heartbeats
    }
  }
  dispatch();
}

// Runs a streaming chat request and resolves with the finished agent message.
//   handlers.onUser(payload)   (persisted chats only) the stored user message + title
//   handlers.onDelta(text)     each chunk of the answer
// Rejects with ApiError when the server reports `error`.
async function streamChat(path, body, handlers = {}, signal) {
  let finished = null;
  let failed = null;
  await streamRequest(path, body, {
    signal,
    onEvent: (event, payload) => {
      if (event === 'user') handlers.onUser?.(payload);
      else if (event === 'delta') handlers.onDelta?.(payload.text);
      else if (event === 'done') finished = payload.message;
      else if (event === 'error') failed = errorFromPayload(502, payload, 'The assistant is unavailable right now');
    },
  });
  if (failed) throw failed;
  if (!finished) throw new ApiError(0, 'The connection dropped before the assistant finished');
  return finished;
}

// Class chat: stores the user's message, streams and stores the agent's reply.
export const streamMessage = (conversationId, text, handlers, signal) =>
  streamChat(`/conversations/${conversationId}/messages/stream`, { body: text }, handlers, signal);

// Floating helper bubble: nothing is stored; send the running log along.
export const streamHelper = (text, history, handlers, signal) =>
  streamChat('/agent/stream', { body: text, history }, handlers, signal);
