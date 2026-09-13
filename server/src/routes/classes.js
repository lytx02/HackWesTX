import { Router } from 'express';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { assignments, classes, conversations, enrollments, submissions, users } from '../schema.js';
import { requireRole, requireUser } from '../auth.js';
import { badRequest, forbidden, isUuid, notFound, requireString, wrap } from '../http.js';
import { getLatestDigest } from '../digests.js';

export const classesRouter = Router();
classesRouter.use(requireUser);

const CLASS_COLORS = ['#2f4f4f', '#b5533c', '#b8861b', '#4a5f9e', '#3f7d4e', '#7a4a8e'];

// Loads the class and verifies the caller is a member. Attaches req.cls / req.membership.
export async function requireMember(req, _res, next) {
  const id = req.params.classId;
  if (!isUuid(id)) return next(notFound('Class not found'));
  const [row] = await db
    .select({ cls: classes, role: enrollments.role })
    .from(classes)
    .leftJoin(enrollments, and(eq(enrollments.classId, classes.id), eq(enrollments.userId, req.user.id)))
    .where(eq(classes.id, id));
  if (!row) return next(notFound('Class not found'));
  if (!row.role) return next(forbidden('You are not a member of this class'));
  req.cls = row.cls;
  req.membership = row.role;
  next();
}

// Instructor: create a class. Student: join by course number (creates a placeholder if unknown).
classesRouter.post(
  '/classes',
  wrap(async (req, res) => {
    const name = requireString(req.body, 'name', { max: 200 });
    const code = requireString(req.body, 'code', { max: 40 });
    const u = req.user;

    if (u.role === 'student') {
      const [existing] = await db
        .select()
        .from(classes)
        .where(sql`lower(${classes.code}) = ${code.toLowerCase()}`)
        .limit(1);
      if (existing) {
        await db.insert(enrollments).values({ userId: u.id, classId: existing.id, role: 'student' }).onConflictDoNothing();
        return res.json(existing);
      }
    }

    const overview = typeof req.body.overview === 'string' ? req.body.overview.trim().slice(0, 2000) : '';
    const [{ n }] = await db.select({ n: sql`count(*)::int` }).from(classes);
    const [cls] = await db
      .insert(classes)
      .values({
        name,
        code,
        overview,
        color: CLASS_COLORS[n % CLASS_COLORS.length],
        instructorName: u.role === 'instructor' ? u.name : 'TBD',
        agentName: name.split(/\s+/)[0] || 'Helper',
        agentBlurb: `Your ${name} assistant.`,
        institutionId: u.institutionId,
      })
      .returning();
    await db.insert(enrollments).values({ userId: u.id, classId: cls.id, role: u.role });
    res.status(201).json(cls);
  })
);

// Class detail: everything either class view needs in one call.
classesRouter.get(
  '/classes/:classId',
  requireMember,
  wrap(async (req, res) => {
    const { cls, user } = req;

    // Assignments with class average and whether the caller has marked/submitted.
    const rows = await db
      .select({
        a: assignments,
        // Outer columns are qualified by hand: with a single-table FROM, Drizzle
        // renders bare column names and the subquery would resolve "id" to its own table.
        avg: sql`(select round(avg(s.score)) from submissions s where s.assignment_id = assignments.id and s.score is not null)::int`,
        done: sql`exists(select 1 from submissions s where s.assignment_id = assignments.id and s.student_id = ${user.id})`,
      })
      .from(assignments)
      .where(eq(assignments.classId, cls.id))
      .orderBy(asc(assignments.dueDate));
    const assignmentList = rows.map((r) => ({ ...r.a, avg: r.avg, done: r.done }));

    // Students never see digest/source data. Instructors see only items from the
    // newest successful run; seeded items (null run IDs) are not generated insights.
    const digest = req.membership === 'instructor' ? (await getLatestDigest(cls.id)).items : [];

    let roster = [];
    if (req.membership === 'instructor') {
      roster = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          avg: sql`(select round(avg(${submissions.score})) from ${submissions} join ${assignments} on ${assignments.id} = ${submissions.assignmentId} where ${assignments.classId} = ${cls.id} and ${submissions.studentId} = ${users.id} and ${submissions.score} is not null)::int`,
        })
        .from(enrollments)
        .innerJoin(users, eq(users.id, enrollments.userId))
        .where(and(eq(enrollments.classId, cls.id), eq(enrollments.role, 'student')))
        .orderBy(users.name);
    }

    // Caller's own conversations, newest first, with a preview.
    const convs = await db
      .select({
        c: conversations,
        messageCount: sql`(select count(*) from messages m where m.conversation_id = conversations.id)::int`,
        lastMessage: sql`(select m.body from messages m where m.conversation_id = conversations.id order by m.created_at desc limit 1)`,
      })
      .from(conversations)
      .where(and(eq(conversations.classId, cls.id), eq(conversations.userId, user.id)))
      .orderBy(desc(conversations.createdAt));

    // Students do not need the instructor's agent instructions or audit columns.
    const { agentInstructions, instructionsUpdatedBy, instructionsUpdatedAt, ...publicCls } = cls;
    const classOut = req.membership === 'instructor' ? cls : publicCls;

    res.json({
      class: classOut,
      membership: req.membership,
      assignments: assignmentList,
      roster,
      digest,
      conversations: convs.map((r) => ({ ...r.c, messageCount: r.messageCount, lastMessage: r.lastMessage })),
    });
  })
);

classesRouter.post(
  '/classes/:classId/assignments',
  requireMember,
  wrap(async (req, res) => {
    if (req.membership !== 'instructor') throw forbidden('Only the instructor can create assignments');
    const title = requireString(req.body, 'title', { max: 200 });
    const dueDate = requireString(req.body, 'dueDate', { max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw badRequest('dueDate must be YYYY-MM-DD');
    const details = typeof req.body.details === 'string' ? req.body.details.trim().slice(0, 4000) : '';
    const [a] = await db.insert(assignments).values({ classId: req.cls.id, title, dueDate, details }).returning();
    res.status(201).json({ ...a, avg: null, done: false });
  })
);

// Student marks an assignment done / not done (a submission row with no score).
classesRouter.post(
  '/assignments/:assignmentId/done',
  requireRole('student'),
  wrap(async (req, res) => {
    const id = req.params.assignmentId;
    if (!isUuid(id)) throw notFound('Assignment not found');
    const [a] = await db
      .select({ a: assignments })
      .from(assignments)
      .innerJoin(enrollments, and(eq(enrollments.classId, assignments.classId), eq(enrollments.userId, req.user.id)))
      .where(eq(assignments.id, id));
    if (!a) throw notFound('Assignment not found');

    const done = req.body?.done !== false;
    if (done) {
      await db.insert(submissions).values({ assignmentId: id, studentId: req.user.id }).onConflictDoNothing();
    } else {
      await db.delete(submissions).where(and(eq(submissions.assignmentId, id), eq(submissions.studentId, req.user.id)));
    }
    res.json({ id, done });
  })
);
