// Canvas LMS integration via a personal access token (Account > Settings >
// New Access Token). Every school runs its own Canvas instance, so the user
// supplies the base URL too. Only this server ever talks to Canvas; the token
// is encrypted at rest and never returned to the browser.
//
// The base URL is user-controlled, so every outbound request is pinned to that
// origin: no redirects, no cross-origin pagination links, per-request timeouts,
// and a response size cap.
//
// Swapping this for the OAuth2 developer-key flow later means replacing how the
// token is obtained; verify/sync below stay the same.

import crypto from 'node:crypto';
import net from 'node:net';

export const LIMITS = {
  requestTimeoutMs: 15_000,
  maxBodyBytes: 5 * 1024 * 1024,
  maxPages: 10,
  maxItemsPerPage: 100,
  maxCourses: 50,
  maxAssignmentsPerCourse: 500,
};

// ---- token encryption (AES-256-GCM, bound to the owning user) ---------------
function key() {
  const raw = process.env.CANVAS_TOKEN_KEY;
  if (!raw) throw new Error('CANVAS_TOKEN_KEY is not set (32 random bytes, base64). Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('CANVAS_TOKEN_KEY must decode to 32 bytes');
  return buf;
}
export const isConfigured = () => Boolean(process.env.CANVAS_TOKEN_KEY);

export function encryptToken(plain, userId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(String(userId)));
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decryptToken(stored, userId) {
  const parts = String(stored ?? '').split('.');
  if (parts.length !== 3) throw new Error('Stored Canvas token is malformed');
  const [iv, tag, enc] = parts.map((p) => Buffer.from(p, 'base64'));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Stored Canvas token is malformed');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(String(userId)));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ---- base URL validation ------------------------------------------------------
export class CanvasError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// CANVAS_ALLOW_INSECURE=true is for local testing against a fake Canvas only.
const insecureOk = () => process.env.CANVAS_ALLOW_INSECURE === 'true';

export function normalizeBaseUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) throw new CanvasError(400, 'Enter your Canvas URL, e.g. https://canvas.okstate.edu');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let url;
  try {
    url = new URL(s);
  } catch {
    throw new CanvasError(400, 'That does not look like a URL');
  }
  if (url.username || url.password) throw new CanvasError(400, 'Canvas URL must not contain credentials');
  if (url.protocol !== 'https:' && !insecureOk()) throw new CanvasError(400, 'Canvas URL must use https');
  const host = url.hostname.toLowerCase();
  if (!insecureOk() && (net.isIP(host) || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.'))) {
    throw new CanvasError(400, "Use your school's Canvas hostname, e.g. canvas.okstate.edu or school.instructure.com");
  }
  return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`;
}

// ---- HTTP client pinned to the Canvas origin ---------------------------------
async function canvasFetch(baseUrl, token, path) {
  const origin = new URL(baseUrl).origin;
  const url = new URL(path, baseUrl);
  if (url.origin !== origin) throw new CanvasError(502, 'Canvas returned a link to another host; stopping.');

  let res;
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error', // never follow the user-supplied host somewhere else
      signal: AbortSignal.timeout(LIMITS.requestTimeoutMs),
    });
  } catch (e) {
    const why = e?.name === 'TimeoutError' ? 'timed out' : e?.cause?.code ?? e?.message ?? 'network error';
    throw new CanvasError(502, `Could not reach Canvas at ${url.host} (${why})`);
  }
  if (res.status === 401) throw new CanvasError(401, 'Canvas rejected the token. Generate a new access token and try again.');
  if (res.status === 404) throw new CanvasError(404, 'That URL is not a Canvas instance (no /api/v1 there).');
  if (!res.ok) throw new CanvasError(502, `Canvas request failed (${res.status})`);
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new CanvasError(502, 'That URL did not return Canvas API data. Check the hostname.');
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > LIMITS.maxBodyBytes) throw new CanvasError(502, 'Canvas response too large');
  const text = await readCapped(res, LIMITS.maxBodyBytes);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CanvasError(502, 'Canvas returned unreadable data');
  }
  return { data, link: res.headers.get('link') ?? '' };
}

async function readCapped(res, cap) {
  const reader = res.body?.getReader?.();
  if (!reader) return res.text();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      throw new CanvasError(502, 'Canvas response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Follows Canvas Link-header pagination, but only on the same origin, with
// caps on pages and items so a hostile server cannot flood the import.
async function canvasList(baseUrl, token, path, { maxItems = Infinity } = {}) {
  const origin = new URL(baseUrl).origin;
  const out = [];
  let next = `${path}${path.includes('?') ? '&' : '?'}per_page=${LIMITS.maxItemsPerPage}`;
  for (let i = 0; i < LIMITS.maxPages && next && out.length < maxItems; i++) {
    const { data, link } = await canvasFetch(baseUrl, token, next);
    if (!Array.isArray(data)) break;
    out.push(...data.slice(0, LIMITS.maxItemsPerPage));
    const m = /<([^>]+)>;\s*rel="next"/.exec(link);
    next = m ? m[1] : null;
    // A "next" link off the Canvas origin is never followed; stop with what we have.
    if (next && safeOrigin(next, baseUrl) !== origin) next = null;
  }
  return out.slice(0, maxItems);
}

function safeOrigin(href, base) {
  try {
    return new URL(href, base).origin;
  } catch {
    return null;
  }
}

// ---- API calls used by the app -------------------------------------------------
export async function verifyToken(baseUrl, token) {
  const { data } = await canvasFetch(baseUrl, token, '/api/v1/users/self');
  if (!data || !isCanvasId(data.id)) throw new CanvasError(502, 'Unexpected response from Canvas');
  return { id: String(data.id), name: clean(data.name ?? data.short_name, 120) || 'Canvas user', email: data.email ?? data.login_id ?? null };
}

// Active enrollments with term and teacher names.
export const listCourses = (baseUrl, token) =>
  canvasList(baseUrl, token, '/api/v1/courses?enrollment_state=active&include[]=term&include[]=teachers', { maxItems: LIMITS.maxCourses });

// Assignments with this user's own submission (score / state), if any.
export const listAssignments = (baseUrl, token, courseId) =>
  canvasList(baseUrl, token, `/api/v1/courses/${encodeURIComponent(courseId)}/assignments?include[]=submission&order_by=due_at`, {
    maxItems: LIMITS.maxAssignmentsPerCourse,
  });

// ---- helpers ------------------------------------------------------------------
export const isCanvasId = (v) => Number.isInteger(Number(v)) && Number(v) > 0 && String(v).length <= 18;
export const hostOf = (baseUrl) => new URL(baseUrl).host;
export const canvasKey = (baseUrl, id) => `${hostOf(baseUrl)}/${Number(id)}`;

// Canvas-provided strings end up in class names and in the agent's prompt:
// keep them single-line and bounded.
export const clean = (s, max = 200) =>
  String(s ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// Canvas descriptions are HTML; keep a short plain-text version.
export function stripHtml(html, max = 300) {
  const text = String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Canvas gives due_at as a UTC instant; the calendar date students see is in the
// course's time zone (Canvas default due time is 11:59 PM local).
export function dueDateIn(dueAt, timeZone) {
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// Canvas enrollment types -> our two roles.
export function roleFromEnrollments(enrollments = []) {
  const types = new Set((Array.isArray(enrollments) ? enrollments : []).map((e) => e?.type ?? e?.role ?? ''));
  if (types.has('teacher') || types.has('ta') || types.has('TeacherEnrollment') || types.has('TaEnrollment')) return 'instructor';
  return 'student';
}

const PALETTE = ['#2f4f4f', '#b5533c', '#b8861b', '#4a5f9e', '#3f7d4e', '#7a4a8e'];
export const colorFor = (n) => PALETTE[Math.abs(Number(n) || 0) % PALETTE.length];
