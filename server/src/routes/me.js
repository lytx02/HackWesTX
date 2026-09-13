import { Router } from 'express';
import { asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { announcements, assignments, classes, enrollments, institutions } from '../schema.js';
import { publicUser, requireUser } from '../auth.js';
import { wrap } from '../http.js';

export const meRouter = Router();

// Everything the dashboard needs in one call: user, institution, classes
// (with student counts), assignments across those classes (with class avg and
// the caller's done flag), and announcements.
meRouter.get(
  '/me',
  requireUser,
  wrap(async (req, res) => {
    const u = req.user;
    const [institution] = u.institutionId ? await db.select().from(institutions).where(eq(institutions.id, u.institutionId)) : [];

    const myClasses = await db
      .select({
        cls: classes,
        studentCount: sql`(select count(*) from enrollments e where e.class_id = ${classes.id} and e.role = 'student')::int`,
      })
      .from(enrollments)
      .innerJoin(classes, eq(classes.id, enrollments.classId))
      .where(eq(enrollments.userId, u.id))
      .orderBy(classes.createdAt);
    const classIds = myClasses.map((r) => r.cls.id);

    const work = classIds.length
      ? await db
          .select({
            a: assignments,
            // Qualified by hand: single-table FROM, see classes.js.
            avg: sql`(select round(avg(s.score)) from submissions s where s.assignment_id = assignments.id and s.score is not null)::int`,
            done: sql`exists(select 1 from submissions s where s.assignment_id = assignments.id and s.student_id = ${u.id})`,
          })
          .from(assignments)
          .where(inArray(assignments.classId, classIds))
          .orderBy(asc(assignments.dueDate))
      : [];

    const notices = await db
      .select()
      .from(announcements)
      .where(u.institutionId ? or(eq(announcements.institutionId, u.institutionId), isNull(announcements.institutionId)) : isNull(announcements.institutionId))
      .orderBy(desc(announcements.publishedOn))
      .limit(20);

    res.json({
      user: publicUser(u),
      institution: institution ?? null,
      classes: myClasses.map((r) => ({ ...r.cls, studentCount: r.studentCount })),
      assignments: work.map((r) => ({ ...r.a, avg: r.avg, done: r.done })),
      announcements: notices,
    });
  })
);
