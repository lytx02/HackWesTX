// Database schema (Drizzle). Run `npm run db:generate` after editing to
// produce a SQL migration in server/drizzle, then `npm run db:migrate`.

import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['student', 'instructor']);
export const messageSender = pgEnum('message_sender', ['user', 'agent']);
export const digestKind = pgEnum('digest_kind', ['alert', 'suggestion', 'notice']);
export const announcementSource = pgEnum('announcement_source', ['institution', 'agent']);

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const institutions = pgTable('institutions', {
  id: text('id').primaryKey(), // slug, e.g. 'okstate'
  name: text('name').notNull(),
  domains: text('domains').array().notNull(), // email domains that verify membership
});

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: userRole('role').notNull(),
    institutionId: text('institution_id').references(() => institutions.id),
    auth0Sub: text('auth0_sub'), // filled in once Auth0 is wired up
    canvasUserId: text('canvas_user_id'), // optional: future Canvas LMS import
    createdAt: createdAt(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(sql`lower(${t.email})`),
    auth0Idx: uniqueIndex('users_auth0_sub_idx').on(t.auth0Sub),
  })
);

// Temporary session tokens until Auth0 replaces them.
export const sessions = pgTable('sessions', {
  token: uuid('token').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
});

export const classes = pgTable(
  'classes',
  {
    id: id(),
    code: text('code').notNull(), // course number, e.g. 'CS 4283'
    name: text('name').notNull(),
    overview: text('overview').notNull().default(''),
    term: text('term').notNull().default('Fall 2026'),
    color: text('color').notNull().default('#2f4f4f'),
    instructorName: text('instructor_name').notNull().default('TBD'), // display only
    agentName: text('agent_name').notNull().default('Helper'),
    agentBlurb: text('agent_blurb').notNull().default(''),
    // Instructor-editable addendum to the global base prompt (agent_settings).
    // Composed, never substituted, so the base guardrails always apply.
    agentInstructions: text('agent_instructions'),
    instructionsUpdatedBy: uuid('instructions_updated_by').references(() => users.id, { onDelete: 'set null' }),
    instructionsUpdatedAt: timestamp('instructions_updated_at', { withTimezone: true }),
    canvasCourseId: text('canvas_course_id'), // optional: future Canvas LMS import
    institutionId: text('institution_id').references(() => institutions.id),
    createdAt: createdAt(),
  },
  (t) => ({
    codeIdx: index('classes_code_idx').on(sql`lower(${t.code})`),
  })
);

// The one AI agent's base prompt. Single row (id = 1). Per-course instructions
// on classes.agent_instructions are appended to this at chat time.
export const agentSettings = pgTable('agent_settings', {
  id: integer('id').primaryKey(),
  basePrompt: text('base_prompt').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Membership for both roles: students are enrolled, instructors teach.
export const enrollments = pgTable(
  'enrollments',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    role: userRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.classId] }),
    classIdx: index('enrollments_class_idx').on(t.classId),
  })
);

export const assignments = pgTable(
  'assignments',
  {
    id: id(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    details: text('details').notNull().default(''),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    classIdx: index('assignments_class_idx').on(t.classId, t.dueDate),
  })
);

// One row per student per assignment. score null = turned in / marked done, not graded.
// Class and student averages are computed from here.
export const submissions = pgTable(
  'submissions',
  {
    id: id(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    score: integer('score'), // percent 0-100
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('submissions_assignment_student_idx').on(t.assignmentId, t.studentId),
    studentIdx: index('submissions_student_idx').on(t.studentId),
  })
);

// Student AI Helper conversation topics.
export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New conversation'),
    createdAt: createdAt(),
  },
  (t) => ({
    ownerIdx: index('conversations_owner_idx').on(t.userId, t.classId),
  })
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    sender: messageSender('sender').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    convIdx: index('messages_conversation_idx').on(t.conversationId, t.createdAt),
  })
);

// AI Digest bullets shown to instructors. The agent will write these later.
export const digestItems = pgTable(
  'digest_items',
  {
    id: id(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    kind: digestKind('kind').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    classIdx: index('digest_items_class_idx').on(t.classId),
  })
);

export const announcements = pgTable('announcements', {
  id: id(),
  institutionId: text('institution_id').references(() => institutions.id),
  classId: uuid('class_id').references(() => classes.id, { onDelete: 'cascade' }), // null = institution-wide
  source: announcementSource('source').notNull().default('institution'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  publishedOn: date('published_on', { mode: 'string' }).notNull().defaultNow(),
});
