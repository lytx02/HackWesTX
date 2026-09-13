// Loads the frontend mock data into Postgres so the app looks the same after
// the swap. WIPES all app tables first. Run: npm run db:seed
//
// Demo accounts it creates (log in with any password, matching role):
//   student@okstate.edu     owns the seeded conversations
//   instructor@okstate.edu  teaches every seeded class

import { sql } from 'drizzle-orm';
import { db, pool } from './db.js';
import * as t from './schema.js';
import * as mock from '../../src/data/mock.js';
import { DEFAULT_BASE_PROMPT } from './agent.js';

const clamp = (n) => Math.max(40, Math.min(100, Math.round(n)));
const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');

await db.execute(sql`truncate ${t.conversationDailySummaries}, ${t.messages}, ${t.conversations}, ${t.submissions}, ${t.assignments}, ${t.digestItems}, ${t.digestRuns}, ${t.announcements}, ${t.enrollments}, ${t.sessions}, ${t.agentSettings}, ${t.classes}, ${t.users}, ${t.institutions} restart identity cascade`);

// The one agent's base prompt
await db.insert(t.agentSettings).values({ id: 1, basePrompt: DEFAULT_BASE_PROMPT });

// Institutions
await db.insert(t.institutions).values(mock.institutions.map((i) => ({ id: i.id, name: i.name, domains: i.domains })));
const inst = 'okstate';

// Users: demo accounts, one instructor per class, and the mock students.
const demoStudent = { email: 'student@okstate.edu', name: 'Demo Student', role: 'student', institutionId: inst };
const demoInstructor = { email: 'instructor@okstate.edu', name: 'Demo Instructor', role: 'instructor', institutionId: inst };
const instructorRows = [...new Set(mock.classes.map((c) => c.instructor))].map((name) => ({
  email: `${slug(name)}@okstate.edu`,
  name,
  role: 'instructor',
  institutionId: inst,
}));
const studentRows = mock.students.map((s) => ({ email: s.email, name: s.name, role: 'student', institutionId: inst }));
const inserted = await db.insert(t.users).values([demoStudent, demoInstructor, ...instructorRows, ...studentRows]).returning();
const userByEmail = Object.fromEntries(inserted.map((u) => [u.email, u]));

// Classes
const classRows = await db
  .insert(t.classes)
  .values(
    mock.classes.map((c) => ({
      code: c.code,
      name: c.name,
      overview: c.overview,
      term: c.term,
      color: c.color,
      instructorName: c.instructor,
      agentName: c.agentName,
      agentBlurb: c.agentBlurb,
      agentInstructions: c.id === 'cs4283' ? 'Never provide complete C programs. Point students to the relevant man page (socket, bind, connect, read) and ask them to show their compiler output before debugging.' : null,
      institutionId: inst,
    }))
  )
  .returning();
const classId = Object.fromEntries(mock.classes.map((c, i) => [c.id, classRows[i].id]));

// Enrollments
const enroll = [];
for (const c of mock.classes) {
  enroll.push({ userId: userByEmail[`${slug(c.instructor)}@okstate.edu`].id, classId: classId[c.id], role: 'instructor' });
  enroll.push({ userId: userByEmail[demoInstructor.email].id, classId: classId[c.id], role: 'instructor' });
  enroll.push({ userId: userByEmail[demoStudent.email].id, classId: classId[c.id], role: 'student' });
}
for (const s of mock.students) for (const cid of s.classIds) enroll.push({ userId: userByEmail[s.email].id, classId: classId[cid], role: 'student' });
await db.insert(t.enrollments).values(enroll).onConflictDoNothing();

// Assignments
const assignmentRows = await db
  .insert(t.assignments)
  .values(mock.assignments.map((a) => ({ classId: classId[a.classId], title: a.title, details: a.details, dueDate: a.due })))
  .returning();
const assignmentId = Object.fromEntries(mock.assignments.map((a, i) => [a.id, assignmentRows[i].id]));

// Submissions: for graded assignments give each enrolled student a score near the
// class average, shaded by that student's overall average, so the numbers add up.
const subs = [];
mock.assignments.forEach((a, i) => {
  const roster = mock.students.filter((s) => s.classIds.includes(a.classId));
  if (a.avg != null) {
    roster.forEach((s, j) => {
      const jitter = ((i * 7 + j * 13) % 9) - 4;
      subs.push({ assignmentId: assignmentId[a.id], studentId: userByEmail[s.email].id, score: clamp(a.avg + (s.avg - 82) * 0.4 + jitter) });
    });
    subs.push({ assignmentId: assignmentId[a.id], studentId: userByEmail[demoStudent.email].id, score: clamp(a.avg + 3) });
  } else if (a.done) {
    subs.push({ assignmentId: assignmentId[a.id], studentId: userByEmail[demoStudent.email].id, score: null });
  }
});
if (subs.length) await db.insert(t.submissions).values(subs);

// Digest + announcements. Seeded digest items are demo placeholders: no
// digest_runs row, rank, or topic, so they are never shown as generated insights.
const digestRows = Object.entries(mock.digests).flatMap(([cid, items]) => items.map((d) => ({ classId: classId[cid], kind: d.kind, body: d.text })));
if (digestRows.length) await db.insert(t.digestItems).values(digestRows);
await db.insert(t.announcements).values(
  mock.announcements.map((n) => ({ institutionId: inst, source: n.source, title: n.title, body: n.body, publishedOn: n.date }))
);

// Conversations for the demo student
for (const c of mock.chats) {
  const [conv] = await db
    .insert(t.conversations)
    .values({ classId: classId[c.classId], userId: userByEmail[demoStudent.email].id, title: c.title, createdAt: new Date(c.createdAt) })
    .returning();
  if (c.messages.length) {
    await db.insert(t.messages).values(
      c.messages.map((m, i) => ({
        conversationId: conv.id,
        sender: m.who === 'user' ? 'user' : 'agent',
        body: m.text,
        createdAt: new Date(new Date(c.createdAt).getTime() + i * 60_000),
      }))
    );
  }
}

console.log(`Seeded ${inserted.length} users, ${classRows.length} classes, ${assignmentRows.length} assignments, ${subs.length} submissions, ${mock.chats.length} conversations.`);
console.log('Demo logins: student@okstate.edu (student), instructor@okstate.edu (instructor).');
await pool.end();
