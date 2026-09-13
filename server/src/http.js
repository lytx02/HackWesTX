// Small helpers shared by routes.

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

// Shared by SSE routes now and by the central JSON error middleware when its
// integration owner mounts the usage router. Keep quota metadata intact.
export function errorPayload(err, fallback = 'The assistant is unavailable right now') {
  return {
    error: err?.message ?? fallback,
    ...(err?.code ? { code: err.code } : {}),
    ...(Number.isInteger(err?.status) ? { status: err.status } : {}),
    ...(Number.isSafeInteger(err?.limit) ? { limit: err.limit } : {}),
    ...(typeof err?.resetsAt === 'string' ? { resetsAt: err.resetsAt } : {}),
  };
}

export const badRequest = (msg, code) => new HttpError(400, msg, code);
export const unauthorized = (msg = 'Sign in required') => new HttpError(401, msg);
export const forbidden = (msg = 'Not allowed') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

// Wrap async route handlers so thrown errors reach the error middleware.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function requireString(body, key, { max = 2000 } = {}) {
  const v = body?.[key];
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${key} is required`);
  if (v.length > max) throw badRequest(`${key} is too long`);
  return v.trim();
}
