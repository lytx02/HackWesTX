// Agent G assembled checks. Runs without a live database or model:
//  1. the assembled Express app mounts the usage and digest routers behind auth;
//  2. generateDigest drives the summary service, bills the professor, and
//     persists ranked items through an injected store;
//  3. empty sources, quota exhaustion, and per-class concurrency behave.
//
//   node --test test/integration.test.js

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:1/unused';
process.env.VLLM_BASE_URL = '';
process.env.VLLM_MODEL = '';
process.env.VLLM_API_KEY = '';
process.env.DAILY_TOKEN_LIMIT = '5000';

const { app } = await import('../src/index.js');
const { pool } = await import('../src/db.js');
const { createUsageService } = await import('../src/usage.js');
const { generateDigest } = await import('../src/digests.js');

const STUDENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS = '44444444-4444-4444-4444-444444444444';
const WINDOW = { startDay: '2026-09-07', endDay: '2026-09-13', timeZone: 'America/Chicago' };
const NOW = new Date('2026-09-13T18:00:00.000Z');
// generateDigest refreshes today first, then the prior six calendar days.
const REFRESH_ORDER = ['2026-09-13', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];

function usageStore(initial = {}) {
  const rows = new Map(Object.entries(initial).map(([id, row]) => [id, { ...row }]));
  return {
    rows,
    async read(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async settle(id, day, tokens) {
      const row = rows.get(id);
      if (!row) return null;
      if (row.aiUsageDay == null || row.aiUsageDay < day) {
        row.aiUsageDay = day;
        row.aiTokensUsed = tokens;
      } else if (row.aiUsageDay === day) {
        row.aiTokensUsed += tokens;
      }
      return { ...row };
    },
  };
}

const usageService = (store = usageStore({ professor: { aiUsageDay: null, aiTokensUsed: 0 } })) =>
  createUsageService({ store, limit: 5000, now: () => NOW });

function digestStore() {
  let state = { run: null, items: [] };
  return {
    saved: 0,
    async saveRun(input) {
      this.saved += 1;
      state = {
        run: {
          id: `run-${this.saved}`,
          classId: input.classId,
          windowStartDay: input.windowStartDay,
          windowEndDay: input.windowEndDay,
          timeZone: input.timeZone,
          summaryCount: input.summaryCount,
          studentCount: input.studentCount,
          createdAt: NOW,
        },
        items: input.items.map((item, index) => ({ id: `item-${index}`, ...item })),
      };
      return state;
    },
    async getLatestRun() {
      return state;
    },
  };
}

const okSummarize = (seen) => async ({ day }) => {
  seen?.push(day);
  return { scanned: 0, updated: 0, skipped: 0, failed: 0 };
};

let server;
let base;

before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('assembled app mounts usage and digest routes behind authentication', async () => {
  assert.equal((await fetch(`${base}/ai/usage`)).status, 401);
  assert.equal((await fetch(`${base}/classes/${CLASS}/digest`)).status, 401);
  assert.equal((await fetch(`${base}/classes/${CLASS}/digest/generate`, { method: 'POST' })).status, 401);
  // The class router installs auth for every path, so unknown paths are also
  // guarded before the trailing 404 handler can run.
  assert.equal((await fetch(`${base}/not-a-route`)).status, 401);
  const payload = await (await fetch(`${base}/ai/usage`)).json();
  assert.equal(typeof payload.error, 'string');
});

test('generateDigest refreshes seven days, bills once, and persists ranked items', async () => {
  const store = digestStore();
  const usage = usageService();
  const days = [];
  const result = await generateDigest({
    classId: CLASS,
    generatedBy: 'professor',
    deps: {
      summarizeDay: okSummarize(days),
      loadDigestSources: async () => [
        { summaryId: 's1', conversationId: 'c1', studentId: STUDENT, day: '2026-09-11', body: 'Asked about recursion.\nNo clear unresolved friction.' },
        { summaryId: 's2', conversationId: 'c2', studentId: STUDENT, day: '2026-09-12', body: 'Confused by base cases.\nUnresolved: termination.' },
      ],
      getDigestWindow: () => WINDOW,
      completeChat: async () => ({
        text: JSON.stringify({ items: [{ topic: 'Recursion base cases', body: 'Students stalled on termination. Reteach base-case design.' }] }),
        usage: { promptTokens: 120, completionTokens: 40, source: 'reported' },
      }),
      withUsageBudget: usage.withUsageBudget,
      store,
      now: () => NOW,
    },
  });

  assert.deepEqual(days, REFRESH_ORDER);
  assert.equal(result.run.summaryCount, 2);
  assert.equal(result.run.studentCount, 1);
  assert.equal(result.run.windowStartDay, '2026-09-07');
  assert.equal(result.run.windowEndDay, '2026-09-13');
  assert.deepEqual(result.items.map((i) => [i.rank, i.kind]), [[1, 'suggestion']]);
  assert.equal((await usage.getUsage('professor')).used, 160);
  assert.equal(store.saved, 1);
});

test('a digest with no eligible sources succeeds with zero model calls and no charge', async () => {
  const store = digestStore();
  const usage = usageService();
  let modelCalls = 0;
  const result = await generateDigest({
    classId: CLASS,
    generatedBy: 'professor',
    deps: {
      summarizeDay: okSummarize(),
      loadDigestSources: async () => [],
      getDigestWindow: () => WINDOW,
      completeChat: async () => {
        modelCalls += 1;
        return { text: '{}', usage: null };
      },
      withUsageBudget: usage.withUsageBudget,
      store,
      now: () => NOW,
    },
  });
  assert.equal(modelCalls, 0);
  assert.equal(result.run.summaryCount, 0);
  assert.deepEqual(result.items, []);
  assert.equal((await usage.getUsage('professor')).used, 0);
});

test('quota exhaustion propagates ai_quota_exceeded and saves no run', async () => {
  const store = digestStore();
  const quota = Object.assign(new Error('You have used your allowance.'), {
    status: 429,
    code: 'ai_quota_exceeded',
    limit: 5000,
    resetsAt: '2026-09-14T05:00:00.000Z',
  });
  await assert.rejects(
    generateDigest({
      classId: CLASS,
      generatedBy: 'professor',
      deps: {
        summarizeDay: okSummarize(),
        loadDigestSources: async () => [],
        getDigestWindow: () => WINDOW,
        completeChat: async () => ({ text: '{}', usage: null }),
        withUsageBudget: async () => {
          throw quota;
        },
        store,
        now: () => NOW,
      },
    }),
    (error) => error.code === 'ai_quota_exceeded' && error.status === 429 && error.limit === 5000
  );
  assert.equal(store.saved, 0);
});

test('concurrent generation for one class is rejected with digest_in_progress', async () => {
  const store = digestStore();
  const usage = usageService();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const deps = {
    summarizeDay: async () => {
      await gate;
      return { scanned: 0, updated: 0, skipped: 0, failed: 0 };
    },
    loadDigestSources: async () => [],
    getDigestWindow: () => WINDOW,
    completeChat: async () => ({ text: '{}', usage: null }),
    withUsageBudget: usage.withUsageBudget,
    store,
    now: () => NOW,
  };

  const first = generateDigest({ classId: CLASS, generatedBy: 'professor', deps });
  await assert.rejects(
    generateDigest({ classId: CLASS, generatedBy: 'professor', deps }),
    (error) => error.code === 'digest_in_progress' && error.status === 409
  );
  release();
  await first;
});
