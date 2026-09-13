// Schema/migration verification for Agent A's contract (docs/implementation-plan.md §3).
//
// Runs only against a DISPOSABLE database named by TEST_DATABASE_URL; the public
// schema there is dropped and recreated. It never uses DATABASE_URL, and refuses
// to run if TEST_DATABASE_URL points at the same database as DATABASE_URL.
//
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/campus_test \
//     node --test test/database.test.js
//
// Covers: a fresh migrate (0000-0003), an upgrade from 0002 with existing users /
// Canvas links / chats / seed digest items preserved byte-for-byte, the unique
// conversation/day summaries, digest run + rank constraints, message usage
// metadata rules, cascades, and seed compatibility.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../src/schema.js';

const t = schema;
const serverDir = path.resolve(import.meta.dirname, '..');
const migrationsFolder = path.join(serverDir, 'drizzle');
const url = process.env.TEST_DATABASE_URL;

if (!url) {
  test('database schema (skipped: TEST_DATABASE_URL not set)', { skip: 'set TEST_DATABASE_URL to a disposable database' }, () => {});
} else {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
    throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL; this test drops the public schema.');
  }

  const pool = new pg.Pool({ connectionString: url, ssl: process.env.TEST_DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 3 });
  const db = drizzle(pool, { schema });
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));

  const resetSchema = async () => {
    await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  };

  // A migrations folder holding only entries 0000..maxIdx, so we can bring a DB to
  // the pre-change state with drizzle's own migrator and bookkeeping.
  const migrationsUpTo = (maxIdx) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-mig-'));
    fs.mkdirSync(path.join(dir, 'meta'));
    const entries = journal.entries.filter((e) => e.idx <= maxIdx);
    for (const e of entries) fs.copyFileSync(path.join(migrationsFolder, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
    fs.writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
    return dir;
  };

  const rejects = (promise, pattern) => assert.rejects(promise, (err) => (pattern.test(err.message) ? true : (console.error(err.message), false)));

  const columns = async (table) => {
    const { rows } = await pool.query(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,
      [table]
    );
    return Object.fromEntries(rows.map((r) => [r.column_name, r]));
  };
  const constraintNames = async (table, type) => {
    const { rows } = await pool.query(
      `select conname from pg_constraint where conrelid = ('public.' || $1)::regclass and contype = $2 order by conname`,
      [table, type]
    );
    return rows.map((r) => r.conname);
  };
  const indexNames = async (table) => {
    const { rows } = await pool.query(`select indexname, indexdef from pg_indexes where schemaname='public' and tablename=$1 order by indexname`, [table]);
    return Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
  };
  const fkAction = async (conname) => {
    const { rows } = await pool.query(`select confdeltype from pg_constraint where conname=$1`, [conname]);
    return rows[0]?.confdeltype; // 'c' cascade, 'n' set null, 'a' no action
  };

  const ids = {
    student: '11111111-1111-1111-1111-111111111111',
    instructor: '22222222-2222-2222-2222-222222222222',
    session: '33333333-3333-3333-3333-333333333333',
    cls: '44444444-4444-4444-4444-444444444444',
    assignment: '55555555-5555-5555-5555-555555555555',
    conv: '66666666-6666-6666-6666-666666666666',
  };

  // Rows that a pre-0003 deployment would already hold: Auth0 + Canvas-linked
  // users, a Canvas-keyed class and assignment, a session, base prompt,
  // a conversation with messages, and a seeded digest item.
  const insertLegacyData = async () => {
    await pool.query(`
      insert into institutions (id, name, domains) values ('okstate','Oklahoma State',array['okstate.edu']);
      insert into users (id, email, name, role, institution_id, auth0_sub, canvas_user_id, canvas_base_url, canvas_token_enc, canvas_name, canvas_connected_at, canvas_last_sync_at)
        values ('${ids.student}','student@okstate.edu','Demo Student','student','okstate','auth0|abc123','canvas.okstate.edu/42','https://canvas.okstate.edu','enc:deadbeef','Demo Student','2026-09-01 10:00-05','2026-09-02 10:00-05'),
               ('${ids.instructor}','instructor@okstate.edu','Demo Instructor','instructor','okstate',null,null,null,null,null,null,null);
      insert into sessions (token, user_id) values ('${ids.session}','${ids.student}');
      insert into agent_settings (id, base_prompt, updated_by) values (1,'Be helpful.','${ids.instructor}');
      insert into classes (id, code, name, canvas_course_id, institution_id, agent_instructions, instructions_updated_by)
        values ('${ids.cls}','CS 4283','Networks','canvas.okstate.edu/1001','okstate','Never give full programs.','${ids.instructor}');
      insert into enrollments (user_id, class_id, role) values ('${ids.student}','${ids.cls}','student'),('${ids.instructor}','${ids.cls}','instructor');
      insert into assignments (id, class_id, title, due_date, canvas_assignment_id) values ('${ids.assignment}','${ids.cls}','Sockets HW','2026-09-20','canvas.okstate.edu/9001');
      insert into submissions (assignment_id, student_id, score) values ('${ids.assignment}','${ids.student}',88);
      insert into conversations (id, class_id, user_id, title, created_at) values ('${ids.conv}','${ids.cls}','${ids.student}','bind() fails','2026-09-10 15:00-05');
      insert into messages (conversation_id, sender, body, created_at) values
        ('${ids.conv}','user','why does bind fail with EADDRINUSE','2026-09-10 15:00-05'),
        ('${ids.conv}','agent','Check SO_REUSEADDR and whether the port is held.','2026-09-10 15:01-05'),
        ('${ids.conv}','user','still confused about TIME_WAIT','2026-09-11 09:00-05');
      insert into digest_items (class_id, kind, body) values ('${ids.cls}','alert','Seeded placeholder alert');
      insert into announcements (institution_id, title, body) values ('okstate','Welcome','Hi');
    `);
  };

  // Snapshot of every pre-existing table, using only the columns that exist at
  // 0002, in physical column order, so it can be compared before/after upgrade.
  const legacySnapshot = async () => {
    const q = async (s) => (await pool.query(s)).rows;
    return {
      institutions: await q(`select (id,name,domains)::text r from institutions order by id`),
      users: await q(`select (id,email,name,role,institution_id,auth0_sub,created_at,canvas_user_id,canvas_base_url,canvas_token_enc,canvas_name,canvas_connected_at,canvas_last_sync_at)::text r from users order by id`),
      sessions: await q(`select (token,user_id,created_at)::text r from sessions order by token`),
      agent_settings: await q(`select (id,base_prompt,updated_by,updated_at)::text r from agent_settings`),
      classes: await q(`select (id,code,name,overview,term,color,instructor_name,agent_name,agent_blurb,institution_id,created_at,agent_instructions,instructions_updated_by,instructions_updated_at,canvas_course_id)::text r from classes order by id`),
      enrollments: await q(`select (user_id,class_id,role,created_at)::text r from enrollments order by user_id, class_id`),
      assignments: await q(`select (id,class_id,title,details,due_date,created_at,canvas_assignment_id)::text r from assignments order by id`),
      submissions: await q(`select (assignment_id,student_id,score,submitted_at)::text r from submissions order by assignment_id, student_id`),
      conversations: await q(`select (id,class_id,user_id,title,created_at)::text r from conversations order by id`),
      messages: await q(`select (id,conversation_id,sender,body,created_at)::text r from messages order by created_at, id`),
      digest_items: await q(`select (id,class_id,kind,body,created_at)::text r from digest_items order by id`),
      announcements: await q(`select (id,institution_id,class_id,source,title,body,published_on)::text r from announcements order by id`),
    };
  };

  const day = (d) => d; // YYYY-MM-DD strings; `date` columns use mode 'string'

  describe('migration metadata', () => {
    test('journal has one forward entry after 0002 and snapshots chain', () => {
      const tags = journal.entries.map((e) => e.tag);
      assert.equal(journal.entries.length, 4);
      assert.deepEqual(journal.entries.map((e) => e.idx), [0, 1, 2, 3]);
      assert.match(tags[3], /^0003_/);
      for (let i = 1; i < journal.entries.length; i++) assert.ok(journal.entries[i].when > journal.entries[i - 1].when, 'journal timestamps increase');
      const snap = (i) => JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta', `000${i}_snapshot.json`), 'utf8'));
      assert.equal(snap(3).prevId, snap(2).id);
      for (const e of journal.entries) assert.ok(fs.existsSync(path.join(migrationsFolder, `${e.tag}.sql`)), `${e.tag}.sql exists`);
    });

    test('0003 is purely additive (no drops, no data rewrites)', () => {
      const sqlText = fs.readFileSync(path.join(migrationsFolder, `${journal.entries[3].tag}.sql`), 'utf8');
      // Statement-initial verbs only: FK clauses legitimately contain "ON DELETE" / "ON UPDATE".
      assert.doesNotMatch(sqlText, /^\s*(DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/im);
      assert.doesNotMatch(sqlText, /\bDROP (TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)\b/i);
      assert.doesNotMatch(sqlText, /ALTER COLUMN .* (TYPE|SET NOT NULL)/i);
    });
  });

  describe('fresh database', () => {
    before(async () => {
      await resetSchema();
      await migrate(db, { migrationsFolder });
    });

    test('all four migrations recorded', async () => {
      const { rows } = await pool.query('select created_at from drizzle.__drizzle_migrations order by id');
      assert.deepEqual(
        rows.map((r) => Number(r.created_at)),
        journal.entries.map((e) => e.when)
      );
    });

    test('users usage counters', async () => {
      const c = await columns('users');
      assert.equal(c.ai_usage_day.data_type, 'date');
      assert.equal(c.ai_usage_day.is_nullable, 'YES');
      assert.equal(c.ai_tokens_used.data_type, 'integer');
      assert.equal(c.ai_tokens_used.is_nullable, 'NO');
      assert.equal(c.ai_tokens_used.column_default, '0');
      assert.ok((await constraintNames('users', 'c')).includes('users_ai_tokens_used_nonneg'));
      // Canvas / auth columns untouched
      for (const name of ['auth0_sub', 'canvas_user_id', 'canvas_base_url', 'canvas_token_enc', 'canvas_name', 'canvas_connected_at', 'canvas_last_sync_at']) assert.ok(c[name], name);
    });

    test('messages usage metadata', async () => {
      const c = await columns('messages');
      for (const name of ['prompt_tokens', 'completion_tokens']) {
        assert.equal(c[name].data_type, 'integer');
        assert.equal(c[name].is_nullable, 'YES');
      }
      assert.equal(c.usage_source.data_type, 'text');
      assert.equal(c.usage_source.is_nullable, 'YES');
      assert.deepEqual(await constraintNames('messages', 'c'), [
        'messages_completion_tokens_nonneg',
        'messages_prompt_tokens_nonneg',
        'messages_usage_agent_only',
        'messages_usage_source_valid',
      ]);
    });

    test('conversation_daily_summaries structure', async () => {
      const c = await columns('conversation_daily_summaries');
      assert.deepEqual(Object.keys(c), [
        'id', 'conversation_id', 'summary_day', 'body', 'message_count', 'source_through_at', 'source_through_message_id', 'snapshot_at', 'created_at', 'updated_at',
      ]);
      assert.equal(c.id.column_default, 'gen_random_uuid()');
      for (const name of ['conversation_id', 'summary_day', 'body', 'message_count', 'snapshot_at', 'created_at', 'updated_at']) assert.equal(c[name].is_nullable, 'NO', name);
      for (const name of ['source_through_at', 'source_through_message_id']) assert.equal(c[name].is_nullable, 'YES', name);
      assert.equal(c.summary_day.data_type, 'date');
      assert.equal(c.source_through_at.data_type, 'timestamp with time zone');
      assert.equal(c.source_through_message_id.data_type, 'uuid');
      const idx = await indexNames('conversation_daily_summaries');
      assert.match(idx.conversation_daily_summaries_conv_day_idx, /UNIQUE INDEX .* \(conversation_id, summary_day\)/);
      assert.match(idx.conversation_daily_summaries_day_idx, /^CREATE INDEX .* \(summary_day, conversation_id\)/);
      assert.deepEqual(await constraintNames('conversation_daily_summaries', 'f'), ['conversation_daily_summaries_conversation_fk']);
      assert.equal(await fkAction('conversation_daily_summaries_conversation_fk'), 'c');
    });

    test('digest_runs structure', async () => {
      const c = await columns('digest_runs');
      assert.deepEqual(Object.keys(c), [
        'id', 'class_id', 'generated_by', 'window_start_day', 'window_end_day', 'time_zone', 'summary_count', 'student_count', 'prompt_tokens', 'completion_tokens', 'created_at',
      ]);
      for (const name of ['class_id', 'window_start_day', 'window_end_day', 'time_zone', 'summary_count', 'student_count', 'created_at']) assert.equal(c[name].is_nullable, 'NO', name);
      for (const name of ['generated_by', 'prompt_tokens', 'completion_tokens']) assert.equal(c[name].is_nullable, 'YES', name);
      assert.equal(c.summary_count.column_default, '0');
      assert.equal(c.student_count.column_default, '0');
      assert.equal(await fkAction('digest_runs_class_id_classes_id_fk'), 'c');
      assert.equal(await fkAction('digest_runs_generated_by_users_id_fk'), 'n');
      assert.match((await indexNames('digest_runs')).digest_runs_class_idx, /\(class_id, created_at\)/);
    });

    test('digest_items ranked-run columns', async () => {
      const c = await columns('digest_items');
      assert.equal(c.digest_run_id.data_type, 'uuid');
      assert.equal(c.digest_run_id.is_nullable, 'YES');
      assert.equal(c.rank.data_type, 'integer');
      assert.equal(c.rank.is_nullable, 'YES');
      assert.equal(c.topic.data_type, 'text');
      assert.equal(c.topic.is_nullable, 'YES');
      assert.equal(c.kind.is_nullable, 'NO');
      assert.equal(c.body.is_nullable, 'NO');
      assert.equal(await fkAction('digest_items_digest_run_id_digest_runs_id_fk'), 'c');
      assert.equal(await fkAction('digest_items_class_id_classes_id_fk'), 'c');
      assert.match((await indexNames('digest_items')).digest_items_run_rank_idx, /UNIQUE INDEX .* \(digest_run_id, rank\)/);
      assert.ok((await constraintNames('digest_items', 'c')).includes('digest_items_rank_range'));
    });

    test('schema module exports the contracted tables', () => {
      for (const name of ['conversationDailySummaries', 'digestRuns', 'digestItems', 'users', 'messages']) assert.ok(schema[name], name);
      assert.ok(schema.users.aiUsageDay && schema.users.aiTokensUsed);
      assert.ok(schema.messages.promptTokens && schema.messages.completionTokens && schema.messages.usageSource);
      assert.ok(schema.digestItems.digestRunId && schema.digestItems.rank && schema.digestItems.topic);
      const s = schema.conversationDailySummaries;
      for (const f of ['id', 'conversationId', 'summaryDay', 'body', 'messageCount', 'sourceThroughAt', 'sourceThroughMessageId', 'snapshotAt', 'createdAt', 'updatedAt']) assert.ok(s[f], f);
      const r = schema.digestRuns;
      for (const f of ['id', 'classId', 'generatedBy', 'windowStartDay', 'windowEndDay', 'timeZone', 'summaryCount', 'studentCount', 'promptTokens', 'completionTokens', 'createdAt']) assert.ok(r[f], f);
    });
  });

  describe('upgrade from 0002 with existing data', () => {
    let before0003;
    before(async () => {
      await resetSchema();
      const dir = migrationsUpTo(2);
      try {
        await migrate(db, { migrationsFolder: dir });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      const { rows } = await pool.query('select count(*)::int n from drizzle.__drizzle_migrations');
      assert.equal(rows[0].n, 3, 'starts at 0002');
      await insertLegacyData();
      before0003 = await legacySnapshot();
      await migrate(db, { migrationsFolder });
    });

    test('only 0003 was applied on top', async () => {
      const { rows } = await pool.query('select created_at from drizzle.__drizzle_migrations order by id');
      assert.equal(rows.length, 4);
      assert.equal(Number(rows[3].created_at), journal.entries[3].when);
    });

    test('existing users, chats, Canvas IDs/tokens, settings and auth rows are byte-identical', async () => {
      assert.deepEqual(await legacySnapshot(), before0003);
    });

    test('new columns on existing rows are null / zero, never fabricated', async () => {
      const users = await db.select({ day: t.users.aiUsageDay, used: t.users.aiTokensUsed, canvas: t.users.canvasTokenEnc }).from(t.users).orderBy(t.users.email);
      assert.deepEqual(users, [
        { day: null, used: 0, canvas: null },
        { day: null, used: 0, canvas: 'enc:deadbeef' },
      ]);
      const msgs = await db.select({ p: t.messages.promptTokens, c: t.messages.completionTokens, s: t.messages.usageSource }).from(t.messages);
      assert.equal(msgs.length, 3);
      for (const m of msgs) assert.deepEqual(m, { p: null, c: null, s: null });
      const [item] = await db.select().from(t.digestItems);
      assert.equal(item.digestRunId, null);
      assert.equal(item.rank, null);
      assert.equal(item.topic, null);
      assert.equal(item.kind, 'alert');
    });

    test('daily summaries: unique per conversation/day, refreshed in place', async () => {
      const base = { conversationId: ids.conv, snapshotAt: new Date() };
      await db.insert(t.conversationDailySummaries).values({ ...base, summaryDay: day('2026-09-10'), body: 'Asked about bind/EADDRINUSE.\nUnresolved: TIME_WAIT.', messageCount: 2 });
      await db.insert(t.conversationDailySummaries).values({ ...base, summaryDay: day('2026-09-11'), body: 'Followed up on TIME_WAIT.\nNo clear unresolved friction.', messageCount: 1 });
      await rejects(
        db.insert(t.conversationDailySummaries).values({ ...base, summaryDay: day('2026-09-10'), body: 'dup', messageCount: 1 }),
        /conversation_daily_summaries_conv_day_idx/
      );
      // Same-day refresh (on-demand then nightly) updates the existing row.
      const [row] = await db
        .insert(t.conversationDailySummaries)
        .values({ ...base, summaryDay: day('2026-09-10'), body: 'Refreshed line 1.\nRefreshed line 2.', messageCount: 3 })
        .onConflictDoUpdate({
          target: [t.conversationDailySummaries.conversationId, t.conversationDailySummaries.summaryDay],
          set: { body: sql`excluded.body`, messageCount: sql`excluded.message_count`, snapshotAt: sql`excluded.snapshot_at`, updatedAt: sql`now()` },
        })
        .returning();
      assert.equal(row.messageCount, 3);
      const rows = await db.select().from(t.conversationDailySummaries).where(eq(t.conversationDailySummaries.conversationId, ids.conv)).orderBy(t.conversationDailySummaries.summaryDay);
      assert.deepEqual(rows.map((r) => [r.summaryDay, r.messageCount]), [['2026-09-10', 3], ['2026-09-11', 1]]);
      assert.ok(rows[0].updatedAt >= rows[0].createdAt);
      await rejects(
        db.insert(t.conversationDailySummaries).values({ ...base, summaryDay: day('2026-09-12'), body: 'x', messageCount: -1 }),
        /conversation_daily_summaries_message_count_nonneg/
      );
    });

    test('summary watermark is not a FK: deleting the source message keeps the summary', async () => {
      const [last] = await db.select({ id: t.messages.id, at: t.messages.createdAt }).from(t.messages).orderBy(sql`${t.messages.createdAt} desc, ${t.messages.id} desc`).limit(1);
      await db
        .update(t.conversationDailySummaries)
        .set({ sourceThroughMessageId: last.id, sourceThroughAt: last.at })
        .where(eq(t.conversationDailySummaries.summaryDay, day('2026-09-11')));
      await db.delete(t.messages).where(eq(t.messages.id, last.id));
      const [row] = await db.select().from(t.conversationDailySummaries).where(eq(t.conversationDailySummaries.summaryDay, day('2026-09-11')));
      assert.equal(row.sourceThroughMessageId, last.id);
    });

    test('digest runs: seven-day inclusive window, non-negative counters', async () => {
      await rejects(
        db.insert(t.digestRuns).values({ classId: ids.cls, windowStartDay: day('2026-09-06'), windowEndDay: day('2026-09-13'), timeZone: 'America/Chicago' }),
        /digest_runs_window_seven_days/
      );
      await rejects(
        db.insert(t.digestRuns).values({ classId: ids.cls, windowStartDay: day('2026-09-07'), windowEndDay: day('2026-09-13'), timeZone: 'America/Chicago', promptTokens: -1 }),
        /digest_runs_prompt_tokens_nonneg/
      );
      const [run] = await db
        .insert(t.digestRuns)
        .values({ classId: ids.cls, generatedBy: ids.instructor, windowStartDay: day('2026-09-07'), windowEndDay: day('2026-09-13'), timeZone: 'America/Chicago', summaryCount: 2, studentCount: 1, promptTokens: 1200, completionTokens: 300 })
        .returning();
      assert.equal(run.windowStartDay, '2026-09-07');
      assert.equal(run.windowEndDay, '2026-09-13');
      // Empty successful run: defaults, no tokens.
      const [empty] = await db.insert(t.digestRuns).values({ classId: ids.cls, windowStartDay: day('2026-09-07'), windowEndDay: day('2026-09-13'), timeZone: 'America/Chicago' }).returning();
      assert.deepEqual([empty.summaryCount, empty.studentCount, empty.promptTokens, empty.completionTokens, empty.generatedBy], [0, 0, null, null, null]);
      await db.delete(t.digestRuns).where(eq(t.digestRuns.id, empty.id));
    });

    test('digest items: rank 1..3 unique within a run; legacy null-run items coexist', async () => {
      const [run] = await db.select().from(t.digestRuns).where(eq(t.digestRuns.classId, ids.cls));
      const item = (rank, topic) => ({ classId: ids.cls, digestRunId: run.id, rank, topic, kind: 'suggestion', body: `Reteach ${topic}.` });
      await db.insert(t.digestItems).values([item(1, 'TIME_WAIT and port reuse'), item(2, 'bind() error handling'), item(3, 'errno discipline')]);
      await rejects(db.insert(t.digestItems).values(item(2, 'dup')), /digest_items_run_rank_idx/);
      await rejects(db.insert(t.digestItems).values(item(0, 'low')), /digest_items_rank_range/);
      await rejects(db.insert(t.digestItems).values(item(4, 'high')), /digest_items_rank_range/);
      await db.insert(t.digestItems).values({ classId: ids.cls, kind: 'notice', body: 'Second seeded placeholder' });
      const legacy = await db.select().from(t.digestItems).where(isNull(t.digestItems.digestRunId));
      const generated = await db.select().from(t.digestItems).where(eq(t.digestItems.digestRunId, run.id)).orderBy(t.digestItems.rank);
      assert.equal(legacy.length, 2);
      assert.deepEqual(generated.map((i) => i.rank), [1, 2, 3]);
    });

    test('message usage metadata rules', async () => {
      const agentRow = and(eq(t.messages.conversationId, ids.conv), eq(t.messages.sender, 'agent'));
      const userRow = and(eq(t.messages.conversationId, ids.conv), eq(t.messages.sender, 'user'));
      await db.update(t.messages).set({ promptTokens: 120, completionTokens: 45, usageSource: 'reported' }).where(agentRow);
      await db.update(t.messages).set({ usageSource: 'estimated' }).where(agentRow);
      await rejects(db.update(t.messages).set({ promptTokens: 5 }).where(userRow), /messages_usage_agent_only/);
      await rejects(db.update(t.messages).set({ usageSource: 'guessed' }).where(agentRow), /messages_usage_source_valid/);
      await rejects(db.update(t.messages).set({ completionTokens: -1 }).where(agentRow), /messages_completion_tokens_nonneg/);
      await rejects(db.update(t.messages).set({ promptTokens: -1 }).where(agentRow), /messages_prompt_tokens_nonneg/);
      // Null usage on an agent row stays allowed (history that predates metering).
      await db.update(t.messages).set({ promptTokens: null, completionTokens: null, usageSource: null }).where(agentRow);
    });

    test('user usage counters: non-negative, atomic day rollover write', async () => {
      await rejects(db.update(t.users).set({ aiTokensUsed: -1 }).where(eq(t.users.id, ids.student)), /users_ai_tokens_used_nonneg/);
      const [u] = await db.update(t.users).set({ aiUsageDay: day('2026-09-13'), aiTokensUsed: 4321 }).where(eq(t.users.id, ids.student)).returning({ day: t.users.aiUsageDay, used: t.users.aiTokensUsed });
      assert.deepEqual(u, { day: '2026-09-13', used: 4321 });
      const [u2] = await db
        .update(t.users)
        .set({ aiTokensUsed: sql`${t.users.aiTokensUsed} + 100` })
        .where(and(eq(t.users.id, ids.student), eq(t.users.aiUsageDay, day('2026-09-13'))))
        .returning({ used: t.users.aiTokensUsed });
      assert.equal(u2.used, 4421);
    });

    test('cascades: generator set null; run → items; conversation → summaries; class → runs', async () => {
      await db.delete(t.users).where(eq(t.users.id, ids.instructor));
      const runs = await db.select().from(t.digestRuns).where(eq(t.digestRuns.classId, ids.cls));
      assert.equal(runs.length, 1);
      assert.equal(runs[0].generatedBy, null);

      await db.delete(t.digestRuns).where(eq(t.digestRuns.id, runs[0].id));
      assert.equal((await db.select().from(t.digestItems).where(isNotNull(t.digestItems.digestRunId))).length, 0);
      assert.equal((await db.select().from(t.digestItems).where(isNull(t.digestItems.digestRunId))).length, 2, 'legacy items survive run deletion');

      await db.delete(t.conversations).where(eq(t.conversations.id, ids.conv));
      assert.equal((await db.select().from(t.conversationDailySummaries)).length, 0);

      await db.insert(t.digestRuns).values({ classId: ids.cls, windowStartDay: day('2026-09-07'), windowEndDay: day('2026-09-13'), timeZone: 'America/Chicago' });
      await db.delete(t.classes).where(eq(t.classes.id, ids.cls));
      assert.equal((await db.select().from(t.digestRuns)).length, 0);
      assert.equal((await db.select().from(t.digestItems)).length, 0);
    });
  });

  describe('seed compatibility (disposable database only)', () => {
    test('npm run db:seed equivalent succeeds and leaves digest items without run IDs', async () => {
      await resetSchema();
      await migrate(db, { migrationsFolder });
      // Pre-populate the new tables so the seed's truncate must handle them.
      const [cls] = await db.insert(t.classes).values({ code: 'X 1', name: 'Tmp' }).returning();
      await db.insert(t.digestRuns).values({ classId: cls.id, windowStartDay: day('2026-09-07'), windowEndDay: day('2026-09-13'), timeZone: 'America/Chicago' });
      const { stdout } = await promisify(execFile)(process.execPath, ['src/seed.js'], {
        cwd: serverDir,
        env: { ...process.env, DATABASE_URL: url, DATABASE_SSL: process.env.TEST_DATABASE_SSL === 'true' ? 'true' : 'false', VLLM_BASE_URL: '' },
      });
      assert.match(stdout, /Seeded \d+ users/);
      assert.equal((await db.select().from(t.digestRuns)).length, 0);
      assert.equal((await db.select().from(t.conversationDailySummaries)).length, 0);
      const items = await db.select().from(t.digestItems);
      assert.ok(items.length > 0);
      for (const i of items) assert.deepEqual([i.digestRunId, i.rank, i.topic], [null, null, null]);
      const [{ n }] = (await pool.query('select count(*)::int n from messages')).rows;
      assert.ok(n > 0, 'seeded conversations have messages');
      const [{ nulls }] = (await pool.query('select count(*)::int nulls from messages where prompt_tokens is null and completion_tokens is null and usage_source is null')).rows;
      assert.equal(nulls, n, 'seeded messages carry no fabricated usage');
    });
  });

  after(async () => {
    await pool.end();
  });
}
