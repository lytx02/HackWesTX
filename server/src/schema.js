// Database schema (Drizzle). Run `npm run db:generate` after editing to
// produce a SQL migration in server/drizzle, then `npm run db:migrate`.

import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
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
    // Canvas link (personal access token flow). Token is AES-256-GCM encrypted
    // with CANVAS_TOKEN_KEY and never returned to the browser.
    canvasUserId: text('canvas_user_id'),
    canvasBaseUrl: text('canvas_base_url'),
    canvasTokenEnc: text('canvas_token_enc'),
    canvasName: text('canvas_name'),
    canvasConnectedAt: timestamp('canvas_connected_at', { withTimezone: true }),
    canvasLastSyncAt: timestamp('canvas_last_sync_at', { withTimezone: true }),
    // Daily AI allowance (DAILY_TOKEN_LIMIT), shared across class chats, the
    // floating helper, and professor-triggered summaries/digests. ai_usage_day is
    // the America/Chicago calendar day the counter belongs to; a stored day older
    // than today means zero current usage until the next atomic rollover write.
    aiUsageDay: date('ai_usage_day', { mode: 'string' }),
    aiTokensUsed: integer('ai_tokens_used').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(sql`lower(${t.email})`),
    auth0Idx: uniqueIndex('users_auth0_sub_idx').on(t.auth0Sub),
    aiTokensNonNeg: check('users_ai_tokens_used_nonneg', sql`${t.aiTokensUsed} >= 0`),
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
    canvasCourseId: text('canvas_course_id'), // "<canvas host>/<course id>", unique per Canvas course
    institutionId: text('institution_id').references(() => institutions.id),
    createdAt: createdAt(),
  },
  (t) => ({
    codeIdx: index('classes_code_idx').on(sql`lower(${t.code})`),
    canvasIdx: uniqueIndex('classes_canvas_course_idx').on(t.canvasCourseId),
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
    canvasAssignmentId: text('canvas_assignment_id'), // "<canvas host>/<assignment id>"
    createdAt: createdAt(),
  },
  (t) => ({
    classIdx: index('assignments_class_idx').on(t.classId, t.dueDate),
    canvasIdx: uniqueIndex('assignments_canvas_idx').on(t.canvasAssignmentId),
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
    // Model usage for agent rows only. Null on user rows and on history that
    // predates metering; never backfilled with invented counts.
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    usageSource: text('usage_source'), // 'reported' (server usage) | 'estimated'
    createdAt: createdAt(),
  },
  (t) => ({
    convIdx: index('messages_conversation_idx').on(t.conversationId, t.createdAt),
    promptTokensNonNeg: check('messages_prompt_tokens_nonneg', sql`${t.promptTokens} IS NULL OR ${t.promptTokens} >= 0`),
    completionTokensNonNeg: check(
      'messages_completion_tokens_nonneg',
      sql`${t.completionTokens} IS NULL OR ${t.completionTokens} >= 0`
    ),
    usageSourceValid: check(
      'messages_usage_source_valid',
      sql`${t.usageSource} IS NULL OR ${t.usageSource} IN ('reported', 'estimated')`
    ),
    usageAgentOnly: check(
      'messages_usage_agent_only',
      sql`${t.sender} = 'agent' OR (${t.promptTokens} IS NULL AND ${t.completionTokens} IS NULL AND ${t.usageSource} IS NULL)`
    ),
  })
);

// End-of-day two-line summary of one student conversation for one
// America/Chicago calendar day. Internal input to instructor digests only: never
// inserted into the chat or the student's model context. One row per
// conversation/day; today's row is refreshed in place until the nightly run
// finalizes it. Class/user are derived through the conversation, not duplicated.
export const conversationDailySummaries = pgTable(
  'conversation_daily_summaries',
  {
    id: id(),
    conversationId: uuid('conversation_id').notNull(), // FK named below (default name exceeds 63 chars)
    summaryDay: date('summary_day', { mode: 'string' }).notNull(), // Central calendar day
    body: text('body').notNull(), // exactly two nonempty lines, length-capped by the writer
    messageCount: integer('message_count').notNull(), // source messages in this snapshot
    // Watermark of the last source message under (created_at, id) ordering. The
    // ID is deliberately not a FK so deleting a message never drops the summary.
    sourceThroughAt: timestamp('source_through_at', { withTimezone: true }),
    sourceThroughMessageId: uuid('source_through_message_id'),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull(), // when the input was selected
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    conversationFk: foreignKey({
      name: 'conversation_daily_summaries_conversation_fk',
      columns: [t.conversationId],
      foreignColumns: [conversations.id],
    }).onDelete('cascade'),
    convDayIdx: uniqueIndex('conversation_daily_summaries_conv_day_idx').on(t.conversationId, t.summaryDay),
    dayIdx: index('conversation_daily_summaries_day_idx').on(t.summaryDay, t.conversationId),
    messageCountNonNeg: check('conversation_daily_summaries_message_count_nonneg', sql`${t.messageCount} >= 0`),
  })
);

// One successful digest generation for a class (a valid zero-item result is
// still a run). Items hang off the run; GET returns only the newest run.
export const digestRuns = pgTable(
  'digest_runs',
  {
    id: id(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    generatedBy: uuid('generated_by').references(() => users.id, { onDelete: 'set null' }),
    // Inclusive seven-day Central window: today plus the previous six days.
    windowStartDay: date('window_start_day', { mode: 'string' }).notNull(),
    windowEndDay: date('window_end_day', { mode: 'string' }).notNull(),
    timeZone: text('time_zone').notNull(),
    summaryCount: integer('summary_count').notNull().default(0),
    studentCount: integer('student_count').notNull().default(0),
    // Total reported/estimated model usage across every call in this run.
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    createdAt: createdAt(),
  },
  (t) => ({
    classIdx: index('digest_runs_class_idx').on(t.classId, t.createdAt),
    windowSevenDays: check('digest_runs_window_seven_days', sql`${t.windowEndDay} - ${t.windowStartDay} = 6`),
    summaryCountNonNeg: check('digest_runs_summary_count_nonneg', sql`${t.summaryCount} >= 0`),
    studentCountNonNeg: check('digest_runs_student_count_nonneg', sql`${t.studentCount} >= 0`),
    promptTokensNonNeg: check('digest_runs_prompt_tokens_nonneg', sql`${t.promptTokens} IS NULL OR ${t.promptTokens} >= 0`),
    completionTokensNonNeg: check(
      'digest_runs_completion_tokens_nonneg',
      sql`${t.completionTokens} IS NULL OR ${t.completionTokens} >= 0`
    ),
  })
);

// AI Digest bullets shown to instructors. Generated items belong to a
// digest_runs row (kind 'suggestion', rank 1..3, topic title, short body).
// Seeded/legacy items have a null run ID and are not presented as generated
// insights.
export const digestItems = pgTable(
  'digest_items',
  {
    id: id(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    digestRunId: uuid('digest_run_id').references(() => digestRuns.id, { onDelete: 'cascade' }),
    rank: integer('rank'), // 1..3 within a run
    topic: text('topic'),
    kind: digestKind('kind').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    classIdx: index('digest_items_class_idx').on(t.classId),
    runRankIdx: uniqueIndex('digest_items_run_rank_idx').on(t.digestRunId, t.rank),
    rankRange: check('digest_items_rank_range', sql`${t.rank} IS NULL OR (${t.rank} BETWEEN 1 AND 3)`),
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
