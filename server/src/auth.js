// Temporary email + role login. Auth0 will replace `POST /auth/login` and
// `requireUser`; everything downstream only relies on `req.user`.

import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db } from './db.js';
import { classes, enrollments, institutions, sessions, users } from './schema.js';
import { badRequest, isUuid, requireString, unauthorized, wrap } from './http.js';

const ROLES = ['student', 'instructor'];

// ".edu or equivalent", or any domain an institution lists.
export function isAcademicDomain(domain) {
  return /(\.|^)edu$|\.edu\.[a-z]{2}$|\.ac\.[a-z]{2}$/.test(domain);
}

export async function requireUser(req, _res, next) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!isUuid(token)) return next(unauthorized());
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.token, token));
  if (!row) return next(unauthorized('Session expired'));
  req.user = row.user;
  req.token = token;
  next();
}

export const requireRole = (role) => (req, _res, next) =>
  req.user?.role === role ? next() : next(badRequest(`Only ${role}s can do that`));

export const authRouter = Router();

authRouter.post(
  '/auth/login',
  wrap(async (req, res) => {
    const email = requireString(req.body, 'email', { max: 254 }).toLowerCase();
    const role = requireString(req.body, 'role');
    if (!ROLES.includes(role)) throw badRequest('role must be student or instructor');
    const domain = email.split('@')[1];
    if (!domain) throw badRequest('Enter a valid email');

    const [institution] = await db
      .select()
      .from(institutions)
      .where(sql`${domain} = ANY(${institutions.domains})`)
      .limit(1);
    if (!institution && !isAcademicDomain(domain)) throw badRequest('Use your institution (.edu or equivalent) email');

    let [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    if (!user) {
      const name = typeof req.body.name === 'string' && req.body.name.trim() ? req.body.name.trim() : email.split('@')[0];
      [user] = await db
        .insert(users)
        .values({ email, name, role, institutionId: institution?.id ?? null })
        .returning();

      // POC convenience: a brand-new user is added to every existing class at
      // their institution so the dashboard is not empty. Remove once real
      // enrollment exists.
      const seeded = await db
        .select({ id: classes.id })
        .from(classes)
        .where(institution ? eq(classes.institutionId, institution.id) : sql`true`);
      if (seeded.length) {
        await db.insert(enrollments).values(seeded.map((c) => ({ userId: user.id, classId: c.id, role }))).onConflictDoNothing();
      }
    } else if (user.role !== role) {
      throw badRequest(`That account is registered as ${user.role === 'student' ? 'a student' : 'an instructor'}`);
    }

    const [session] = await db.insert(sessions).values({ userId: user.id }).returning({ token: sessions.token });
    res.json({ token: session.token, user: publicUser(user), institution: institution ?? null });
  })
);

authRouter.post(
  '/auth/logout',
  requireUser,
  wrap(async (req, res) => {
    await db.delete(sessions).where(and(eq(sessions.token, req.token), eq(sessions.userId, req.user.id)));
    res.status(204).end();
  })
);

export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, institutionId: u.institutionId });
