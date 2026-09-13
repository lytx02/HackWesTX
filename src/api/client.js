// Thin fetch wrapper for the API in server/. Base URL comes from VITE_API_URL.

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const TOKEN_KEY = 'campus-ai.token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

// When signed in through Auth0 the SDK supplies fresh access tokens; otherwise
// the legacy session token from localStorage is used.
let tokenProvider = null;
export function setTokenProvider(fn) {
  tokenProvider = fn;
}

// The one token resolver for every transport (JSON requests and SSE streams),
// so both always act as the same signed-in user.
export async function resolveToken() {
  if (tokenProvider) {
    try {
      return await tokenProvider();
    } catch {
      return null; // SDK could not refresh; the request will come back 401
    }
  }
  return getToken();
}

// `limit` and `resetsAt` arrive with 429 ai_quota_exceeded so the UI can show
// the configured allowance and when it resets; `status` mirrors the HTTP code.
export class ApiError extends Error {
  constructor(status, message, code, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    if (extra.limit !== undefined) this.limit = extra.limit;
    if (extra.resetsAt !== undefined) this.resetsAt = extra.resetsAt;
  }
}

export const errorFromPayload = (status, data, fallback) =>
  new ApiError(Number.isInteger(data?.status) ? data.status : status, data?.error ?? fallback, data?.code, {
    limit: data?.limit,
    resetsAt: data?.resetsAt,
  });

async function request(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = await resolveToken();
  if (token) headers.authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${BASE}. Is the server running?`);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw errorFromPayload(res.status, data, res.statusText);
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};
