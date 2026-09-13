// Authentication.
//
// Two token kinds are accepted in `Authorization: Bearer <token>`:
//   1. Auth0 access tokens (JWT), when AUTH0_DOMAIN + AUTH0_AUDIENCE are set.
//      Verified against Auth0's JWKS; the user row is looked up by auth0_sub.
//      First login goes through POST /auth/register, which reads the email from
//      Auth0's /userinfo and creates the row with the role from the questionnaire.
//   2. Legacy session UUIDs from POST /auth/login (email + role, no password).
//      Kept for local development and the seeded demo accounts.
//
// Everything downstream only relies on `req.user`.

import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { auth as jwtAuth } from 'express-oauth2-jwt-bearer';
import { db } from './db.js';
import { classes, enrollments, institutions, sessions, users } from './schema.js';
import { badRequest, HttpError, isUuid, requireString, unauthorized, wrap } from './http.js';

const ROLES = ['student', 'instructor'];

export const AUTH0 =
  process.env.AUTH0_DOMAIN && process.env.AUTH0_AUDIENCE
    ? {
        domain: process.env.AUTH0_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        audience: process.env.AUTH0_AUDIENCE,
        issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL ?? `https://${process.env.AUTH0_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')}/`,
      }
    : null;

const jwtCheck = AUTH0 ? jwtAuth({ audience: AUTH0.audience, issuerBaseURL: AUTH0.issuerBaseURL, tokenSigningAlg: 'RS256' }) : null;

const looksLikeJwt = (t) => t.split('.').length === 3;

// Runs the Auth0 middleware as a promise; rejects with a 401 HttpError.
function verifyJwt(req, res) {
  return new Promise((resolve, reject) => {
    jwtCheck(req, res, (err) => {
      if (err) return reject(new HttpError(err.status ?? 401, err.message ?? 'Invalid token'));
      resolve(req.auth.payload);
    });
  });
}

// ".edu or equivalent", or any domain an institution lists.
export function isAcademicDomain(domain) {
  return /(\.|^)edu$|\.edu\.[a-z]{2}$|\.ac\.[a-z]{2}$/.test(domain);
}

// REQUIRE_ACADEMIC_EMAIL=false lets any address register (hackathon demo:
// judges rarely have .edu accounts). Default is the strict rule from the spec.
const requireAcademic = process.env.REQUIRE_ACADEMIC_EMAIL !== 'false';
function checkEmailDomain(domain, institution) {
  if (!institution && requireAcademic && !isAcademicDomain(domain)) {
    throw badRequest('Use your institution (.edu or equivalent) email');
  }
}

async function institutionForDomain(domain) {
  const [row] = await db
    .select()
    .from(institutions)
    .where(sql`${domain} = ANY(${institutions.domains})`)
    .limit(1);
  return row ?? null;
}

// POC convenience: a brand-new user joins every existing class at their
// institution so the dashboard is not empty. Remove once real enrollment exists.
async function autoEnroll(user, institution) {
  const seeded = await db
    .select({ id: classes.id })
    .from(classes)
    .where(institution ? eq(classes.institutionId, institution.id) : sql`true`);
  if (seeded.length) {
    await db
      .insert(enrollments)
      .values(seeded.map((c) => ({ userId: user.id, classId: c.id, role: user.role })))
      .onConflictDoNothing();
  }
}

export async function requireUser(req, res, next) {
  try {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) throw unauthorized();

    if (jwtCheck && looksLikeJwt(token)) {
      const payload = await verifyJwt(req, res);
      const [user] = await db.select().from(users).where(eq(users.auth0Sub, payload.sub));
      if (!user) throw new HttpError(401, 'Registration required', 'not_registered');
      req.user = user;
      req.authKind = 'auth0';
      return next();
    }

    if (!isUuid(token)) throw unauthorized();
    const [row] = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.token, token));
    if (!row) throw unauthorized('Session expired');
    req.user = row.user;
    req.token = token;
    req.authKind = 'session';
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole = (role) => (req, _res, next) =>
  req.user?.role === role ? next() : next(badRequest(`Only ${role}s can do that`));

export const authRouter = Router();

// Tells the frontend which mode the server is in (used only for diagnostics).
authRouter.get('/auth/config', (_req, res) => res.json({ mode: AUTH0 ? 'auth0' : 'legacy', audience: AUTH0?.audience ?? null }));

// Auth0 first login: create (or link) the user row. Body: { role } for new users.
authRouter.post(
  '/auth/register',
  wrap(async (req, res) => {
    if (!jwtCheck) throw badRequest('Auth0 is not configured on this server');
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token || !looksLikeJwt(token)) throw unauthorized('Auth0 access token required');
    const payload = await verifyJwt(req, res);

    // Already registered: idempotent.
    let [user] = await db.select().from(users).where(eq(users.auth0Sub, payload.sub));
    if (user) {
      const institution = user.institutionId ? (await db.select().from(institutions).where(eq(institutions.id, user.institutionId)))[0] : null;
      return res.json({ user: publicUser(user), institution: institution ?? null, created: false });
    }

    // Email + name come from Auth0's userinfo (access token must carry openid email profile scopes).
    const infoRes = await fetch(new URL('userinfo', AUTH0.issuerBaseURL), { headers: { authorization: `Bearer ${token}` } });
    if (!infoRes.ok) throw new HttpError(502, `Auth0 userinfo failed (${infoRes.status})`);
    const info = await infoRes.json();
    const email = typeof info.email === 'string' ? info.email.trim().toLowerCase() : '';
    if (!email) throw badRequest('Auth0 did not return an email. Check the openid/email scopes and the connection.');
    // Off by default for the hackathon so signups are instant. Turn on for real use:
    // it is what proves the person owns the .edu address.
    if (process.env.AUTH0_REQUIRE_VERIFIED_EMAIL === 'true' && info.email_verified === false) {
      throw badRequest('Verify your email address with Auth0 first, then sign in again.');
    }
    const domain = email.split('@')[1];
    const institution = await institutionForDomain(domain);
    checkEmailDomain(domain, institution);

    // A legacy account with this email (e.g. seeded demo user): link it to Auth0.
    [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    if (user) {
      [user] = await db.update(users).set({ auth0Sub: payload.sub }).where(eq(users.id, user.id)).returning();
      return res.json({ user: publicUser(user), institution, created: false });
    }

    const role = typeof req.body?.role === 'string' ? req.body.role : '';
    if (!ROLES.includes(role)) throw badRequest('Choose Student or Instructor first', 'role_required');
    const name = typeof info.name === 'string' && info.name.trim() && !info.name.includes('@') ? info.name.trim() : email.split('@')[0];
    [user] = await db
      .insert(users)
      .values({ email, name, role, institutionId: institution?.id ?? null, auth0Sub: payload.sub })
      .returning();
    await autoEnroll(user, institution);
    res.status(201).json({ user: publicUser(user), institution, created: true });
  })
);

// Legacy email + role login (no password). Kept for local dev and demo accounts.
authRouter.post(
  '/auth/login',
  wrap(async (req, res) => {
    const email = requireString(req.body, 'email', { max: 254 }).toLowerCase();
    const role = requireString(req.body, 'role');
    if (!ROLES.includes(role)) throw badRequest('role must be student or instructor');
    const domain = email.split('@')[1];
    if (!domain) throw badRequest('Enter a valid email');

    const institution = await institutionForDomain(domain);
    checkEmailDomain(domain, institution);

    let [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    if (!user) {
      const name = typeof req.body.name === 'string' && req.body.name.trim() ? req.body.name.trim() : email.split('@')[0];
      [user] = await db
        .insert(users)
        .values({ email, name, role, institutionId: institution?.id ?? null })
        .returning();
      await autoEnroll(user, institution);
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
    if (req.authKind === 'session') {
      await db.delete(sessions).where(and(eq(sessions.token, req.token), eq(sessions.userId, req.user.id)));
    }
    // Auth0 tokens are stateless; the frontend clears them via the SDK's logout.
    res.status(204).end();
  })
);

export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, institutionId: u.institutionId });
