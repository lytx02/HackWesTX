// Canvas link: connect with a personal access token, sync courses and
// assignments into our tables, disconnect. Token never leaves the server.

import { Router } from 'express';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { assignments, classes, enrollments, submissions, users } from '../schema.js';
import { requireUser } from '../auth.js';
import { badRequest, HttpError, wrap } from '../http.js';
import * as canvas from '../canvas.js';

export const canvasRouter = Router();
canvasRouter.use(requireUser);

export const canvasStatus = (u) => ({
  configured: canvas.isConfigured(),
  connected: Boolean(u.canvasTokenEnc),
  baseUrl: u.canvasBaseUrl ?? null,
  host: u.canvasBaseUrl ? canvas.hostOf(u.canvasBaseUrl) : null,
  canvasName: u.canvasName ?? null,
  connectedAt: u.canvasConnectedAt ?? null,
  lastSyncAt: u.canvasLastSyncAt ?? null,
});

function requireConfigured() {
  if (!canvas.isConfigured()) throw new HttpError(503, 'Canvas linking is not enabled on this server (CANVAS_TOKEN_KEY missing).');
}

const toHttpError = (e) => (e instanceof canvas.CanvasError ? new HttpError(e.status === 401 || e.status === 404 ? 400 : e.status, e.message) : e);

// One sync at a time per user, and a short cooldown between syncs.
const inFlight = new Set();
const lastRun = new Map();
const COOLDOWN_MS = 30_000;
function takeLock(userId, { cooldown = true } = {}) {
  if (inFlight.has(userId)) throw new HttpError(409, 'A Canvas sync is already running');
  if (cooldown && Date.now() - (lastRun.get(userId) ?? 0) < COOLDOWN_MS) throw new HttpError(429, 'Please wait a moment before syncing again');
  inFlight.add(userId);
  return () => {
    inFlight.delete(userId);
    lastRun.set(userId, Date.now());
  };
}

canvasRouter.get('/canvas/status', (req, res) => res.json(canvasStatus(req.user)));

// Validate the token against Canvas, store it encrypted, then run a first sync.
// If the first sync fails the token is dropped again so the account is not
// left half-connected.
canvasRouter.post(
  '/canvas/connect',
  wrap(async (req, res) => {
    requireConfigured();
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token || token.length < 20 || token.length > 512) throw badRequest('Paste the access token Canvas generated for you');
    const release = takeLock(req.user.id, { cooldown: false });
    try {
      let baseUrl;
      let profile;
      try {
        baseUrl = canvas.normalizeBaseUrl(req.body?.baseUrl);
        profile = await canvas.verifyToken(baseUrl, token);
      } catch (e) {
        throw toHttpError(e);
      }

      const [u] = await db
        .update(users)
        .set({
          canvasBaseUrl: baseUrl,
          canvasTokenEnc: canvas.encryptToken(token, req.user.id),
          canvasUserId: profile.id,
          canvasName: profile.name,
          canvasConnectedAt: new Date(),
          canvasLastSyncAt: null,
        })
        .where(eq(users.id, req.user.id))
        .returning();

      let summary;
      try {
        summary = await syncUser(u, token);
      } catch (e) {
        await db
          .update(users)
          .set({ canvasTokenEnc: null, canvasBaseUrl: null, canvasName: null, canvasUserId: null, canvasConnectedAt: null })
          .where(eq(users.id, req.user.id));
        throw toHttpError(e);
      }
      res.json({ ...canvasStatus(summary.user), ...summary.counts });
    } finally {
      release();
    }
  })
);

canvasRouter.post(
  '/canvas/sync',
  wrap(async (req, res) => {
    requireConfigured();
    if (!req.user.canvasTokenEnc) throw badRequest('Canvas is not connected');
    const release = takeLock(req.user.id);
    try {
      let summary;
      try {
        summary = await syncUser(req.user, canvas.decryptToken(req.user.canvasTokenEnc, req.user.id));
      } catch (e) {
        throw toHttpError(e);
      }
      res.json({ ...canvasStatus(summary.user), ...summary.counts });
    } finally {
      release();
    }
  })
);

// Forget the token. Imported classes stay (they may be shared with classmates).
canvasRouter.delete(
  '/canvas',
  wrap(async (req, res) => {
    if (inFlight.has(req.user.id)) throw new HttpError(409, 'A Canvas sync is running; try again in a moment');
    const [u] = await db
      .update(users)
      .set({ canvasTokenEnc: null, canvasBaseUrl: null, canvasName: null, canvasConnectedAt: null, canvasLastSyncAt: null })
      .where(eq(users.id, req.user.id))
      .returning();
    res.json(canvasStatus(u));
  })
);

// ---- import ----------------------------------------------------------------------
// Upserts the user's active Canvas courses as classes (keyed by canvas_course_id),
// enrolls the user with the role Canvas reports, upserts published assignments
// that have a due date, prunes imported assignments Canvas no longer lists, and
// records the user's own submissions (state + percent score).
//
// Shared class rows are only renamed by syncs from teachers/TAs: Canvas returns a
// student's private course nickname as `name`, and a class name also feeds the
// agent's system prompt.
async function syncUser(u, token) {
  const baseUrl = u.canvasBaseUrl;
  const courses = (await canvas.listCourses(baseUrl, token)).filter((c) => c && canvas.isCanvasId(c.id) && !c.access_restricted_by_date);
  const counts = { courses: 0, assignments: 0, submissions: 0 };

  for (const c of courses) {
    const key = canvas.canvasKey(baseUrl, c.id);
    const role = canvas.roleFromEnrollments(c.enrollments);
    const teachers = (Array.isArray(c.teachers) ? c.teachers : []).map((t) => canvas.clean(t?.display_name ?? t?.name, 60)).filter(Boolean);
    const name = canvas.clean(c.original_name ?? c.name ?? c.course_code, 200) || `Canvas course ${c.id}`;
    const descriptive = {
      code: canvas.clean(c.course_code ?? name, 40) || `Canvas ${c.id}`,
      name,
      term: c.term?.name && c.term.name !== 'Default Term' ? canvas.clean(c.term.name, 40) : 'Fall 2026',
      instructorName: teachers.length ? teachers.slice(0, 2).join(', ').slice(0, 120) : 'TBD',
      overview: canvas.stripHtml(c.public_description, 400),
    };
    const [cls] = await db
      .insert(classes)
      .values({
        ...descriptive,
        canvasCourseId: key,
        institutionId: u.institutionId,
        color: canvas.colorFor(c.id),
        agentName: descriptive.name.split(/\s+/)[0] || 'Helper',
        agentBlurb: `Your ${descriptive.name} assistant.`,
      })
      .onConflictDoUpdate({
        target: classes.canvasCourseId,
        // Students' syncs must not rename a shared class; teachers/TAs keep it current.
        set: role === 'instructor' ? descriptive : { canvasCourseId: key },
      })
      .returning();
    await db
      .insert(enrollments)
      .values({ userId: u.id, classId: cls.id, role })
      .onConflictDoUpdate({ target: [enrollments.userId, enrollments.classId], set: { role } });
    counts.courses++;

    let items = [];
    try {
      items = await canvas.listAssignments(baseUrl, token, c.id);
    } catch (e) {
      // A course the token cannot read assignments for should not abort the whole sync.
      if (!(e instanceof canvas.CanvasError)) throw e;
      continue;
    }

    const seen = [];
    for (const a of items) {
      if (!a || !canvas.isCanvasId(a.id)) continue;
      const akey = canvas.canvasKey(baseUrl, a.id);
      const dueDate = a.due_at ? canvas.dueDateIn(a.due_at, c.time_zone) : null;
      // Drafts (teacher/TA tokens see them) and undated work stay out; if such a
      // row was imported earlier, remove it.
      if (a.published === false || !dueDate) {
        await db.delete(assignments).where(eq(assignments.canvasAssignmentId, akey));
        continue;
      }
      seen.push(akey);
      const fields = { title: canvas.clean(a.name, 200) || 'Assignment', details: canvas.stripHtml(a.description), dueDate, classId: cls.id };
      const [row] = await db
        .insert(assignments)
        .values({ ...fields, canvasAssignmentId: akey })
        .onConflictDoUpdate({ target: assignments.canvasAssignmentId, set: fields })
        .returning();
      counts.assignments++;

      // Only real student work counts as "done": not auto-zeroed missing work, not excused.
      const sub = a.submission;
      const state = sub?.workflow_state;
      const isWork = sub && state && state !== 'unsubmitted' && !sub.excused && !(sub.missing && !sub.submitted_at);
      if (isWork) {
        const pts = Number(a.points_possible);
        const score = sub.score != null && pts > 0 ? Math.max(0, Math.min(100, Math.round((Number(sub.score) / pts) * 100))) : null;
        await db
          .insert(submissions)
          .values({ assignmentId: row.id, studentId: u.id, score })
          .onConflictDoUpdate({ target: [submissions.assignmentId, submissions.studentId], set: { score } });
        counts.submissions++;
      } else {
        await db.delete(submissions).where(and(eq(submissions.assignmentId, row.id), eq(submissions.studentId, u.id)));
      }
    }

    // Assignments Canvas no longer returns for this course were deleted there.
    // Only a teacher/TA sync prunes, since a student may simply not see some.
    if (role === 'instructor') {
      const cond = seen.length
        ? and(eq(assignments.classId, cls.id), sql`${assignments.canvasAssignmentId} is not null`, notInArray(assignments.canvasAssignmentId, seen))
        : and(eq(assignments.classId, cls.id), sql`${assignments.canvasAssignmentId} is not null`);
      await db.delete(assignments).where(cond);
    }
  }

  const [user] = await db.update(users).set({ canvasLastSyncAt: new Date() }).where(eq(users.id, u.id)).returning();
  return { user, counts };
}

export { syncUser };
// isNull is used by auth.js's autoEnroll to keep imported classes out of it.
export { isNull };
