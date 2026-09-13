import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';

process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:1/unused';

const {
  chunkDigestSources,
  enumerateInclusiveDays,
  generateDigest,
  getLatestDigest,
  sanitizeDigestText,
  validateDigestOutput,
} = await import('../src/digests.js');
const { createUsageService } = await import('../src/usage.js');
const { createDigestsRouter } = await import('../src/routes/digests.js');
const { forbidden, isUuid, notFound } = await import('../src/http.js');

const UUID = '11111111-1111-4111-8111-111111111111';
const WINDOW = { startDay: '2026-09-07', endDay: '2026-09-13', timeZone: 'America/Chicago' };
const WINDOW_DAYS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
const NOW = () => new Date('2026-09-13T18:00:00Z');

function usageStore(initial = {}) {
  const rows = new Map(Object.entries(initial).map(([id, row]) => [id, { ...row }]));
  const writes = [];
  return {
    rows,
    writes,
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
      writes.push({ id, day, tokens });
      return { ...row };
    },
  };
}

function digestStore() {
  const runs = [];
  let seq = 0;
  return {
    runs,
    async saveRun(input) {
      seq += 1;
      const run = {
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
        classId: input.classId,
        windowStartDay: input.windowStartDay,
        windowEndDay: input.windowEndDay,
        timeZone: input.timeZone,
        summaryCount: input.summaryCount,
        studentCount: input.studentCount,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        createdAt: new Date(Date.UTC(2026, 8, 13, 12, 0, seq)).toISOString(),
      };
      const items = input.items.map((item, index) => ({
        id: `00000000-0000-4000-8000-${String(seq).padStart(8, '0')}${String(index).padStart(4, '0')}`,
        rank: item.rank,
        topic: item.topic,
        body: item.body,
        kind: item.kind,
      }));
      runs.push({ run, items });
      return { run, items };
    },
    async getLatestRun(classId) {
      const matches = runs.filter((entry) => entry.run.classId === classId);
      return matches.length ? matches[matches.length - 1] : { run: null, items: [] };
    },
  };
}

function makeDeps({ limit = 1_000_000, summarizeDay, loadDigestSources, completeChat, store = digestStore(), getDigestWindow } = {}) {
  const usage = usageStore({ prof: { aiUsageDay: null, aiTokensUsed: 0 } });
  const usageService = createUsageService({ store: usage, limit, now: NOW });
  return {
    usage,
    store,
    deps: {
      summarizeDay: summarizeDay ?? (async () => ({ scanned: 0, updated: 0, skipped: 0, failed: 0 })),
      loadDigestSources: loadDigestSources ?? (async () => []),
      completeChat: completeChat ?? (async () => ({ text: '{"items":[]}', usage: { promptTokens: 1, completionTokens: 1, source: 'reported' } })),
      store,
      getDigestWindow: getDigestWindow ?? (() => WINDOW),
      now: NOW,
      withUsageBudget: usageService.withUsageBudget,
    },
  };
}

const source = (extra = {}) => ({ summaryId: 's1', conversationId: 'c1', studentId: 'student-1', day: '2026-09-13', body: 'Stuck on recursion.', ...extra });

test('generateDigest refreshes today plus the prior six days and bills the professor', async () => {
  const days = [];
  const modelCalls = [];
  const { deps, usage, store } = makeDeps({
    summarizeDay: async ({ day, beforeModelCall, recordUsage }) => {
      days.push(day);
      if (day === WINDOW.endDay) {
        await beforeModelCall();
        await recordUsage({ promptTokens: 10, completionTokens: 4, source: 'reported' });
        return { scanned: 1, updated: 1, skipped: 0, failed: 0 };
      }
      return { scanned: 0, updated: 0, skipped: 1, failed: 0 };
    },
    loadDigestSources: async ({ startDay, endDay }) => {
      assert.equal(startDay, WINDOW.startDay);
      assert.equal(endDay, WINDOW.endDay);
      return [source()];
    },
    completeChat: async (messages) => {
      modelCalls.push(messages);
      return { text: JSON.stringify({ items: [{ topic: 'Recursion', body: 'Reteach base cases.' }] }), usage: { promptTokens: 20, completionTokens: 8, source: 'reported' } };
    },
  });

  const result = await generateDigest({ classId: 'class-1', generatedBy: 'prof', deps });

  assert.deepEqual(days, [WINDOW.endDay, ...WINDOW_DAYS.slice(0, -1)]);
  assert.equal(modelCalls.length, 1);
  assert.equal(result.run.windowStartDay, WINDOW.startDay);
  assert.equal(result.run.windowEndDay, WINDOW.endDay);
  assert.equal(result.run.timeZone, 'America/Chicago');
  assert.equal(result.run.summaryCount, 1);
  assert.equal(result.run.studentCount, 1);
  assert.deepEqual(result.items.map((item) => item.rank), [1]);
  assert.equal(usage.rows.get('prof').aiTokensUsed, 10 + 4 + 20 + 8);
  assert.equal(store.runs.length, 1);
});

test('unchanged daily rows are reused without refresh model calls', async () => {
  const days = [];
  const { deps, usage } = makeDeps({
    summarizeDay: async ({ day }) => {
      days.push(day);
      return { scanned: 2, updated: 0, skipped: 2, failed: 0 };
    },
    loadDigestSources: async () => [source()],
    completeChat: async () => ({ text: '{"items":[]}', usage: { promptTokens: 3, completionTokens: 3, source: 'reported' } }),
  });
  await generateDigest({ classId: 'class-1', generatedBy: 'prof', deps });
  assert.equal(days.length, 7);
  assert.equal(usage.writes.length, 1);
  assert.equal(usage.rows.get('prof').aiTokensUsed, 6);
});

test('empty sources save a successful empty run with zero model calls and zero tokens', async () => {
  let modelCalls = 0;
  const { deps, usage, store } = makeDeps({
    summarizeDay: async () => ({ scanned: 0, updated: 0, skipped: 0, failed: 0 }),
    loadDigestSources: async () => [],
    completeChat: async () => {
      modelCalls += 1;
      return { text: '{}', usage: null };
    },
  });
  const result = await generateDigest({ classId: 'class-1', generatedBy: 'prof', deps });
  assert.equal(modelCalls, 0);
  assert.equal(result.run.summaryCount, 0);
  assert.equal(result.run.studentCount, 0);
  assert.deepEqual(result.items, []);
  assert.equal(usage.rows.get('prof').aiTokensUsed, 0);
  assert.equal(usage.writes.length, 0);
  assert.equal(store.runs.length, 1);
});

for (const count of [0, 1, 3]) {
  test(`generateDigest accepts ${count} item(s)`, async () => {
    const items = Array.from({ length: count }, (_, index) => ({ topic: `Topic ${index + 1}`, body: `Body ${index + 1}` }));
    const { deps, store } = makeDeps({
      loadDigestSources: async () => [source(), source({ summaryId: 's2', conversationId: 'c2', studentId: 'student-2' })],
      completeChat: async () => ({ text: JSON.stringify({ items }), usage: { promptTokens: 4, completionTokens: 4, source: 'reported' } }),
    });
    const result = await generateDigest({ classId: 'class-1', generatedBy: 'prof', deps });
    assert.equal(result.items.length, count);
    assert.equal(result.run.summaryCount, 2);
    assert.equal(result.run.studentCount, 2);
    assert.equal(store.runs.length, 1);
  });
}

test('invalid model output is rejected and the previous digest is retained', async () => {
  const store = digestStore();
  const previous = await store.saveRun({
    classId: 'class-1',
    generatedBy: 'prof',
    windowStartDay: WINDOW.startDay,
    windowEndDay: WINDOW.endDay,
    timeZone: WINDOW.timeZone,
    summaryCount: 1,
    studentCount: 1,
    promptTokens: 1,
    completionTokens: 1,
    items: [{ rank: 1, topic: 'Old topic', body: 'Old body', kind: 'suggestion' }],
  });
  const { deps } = makeDeps({
    store,
    loadDigestSources: async () => [source()],
    completeChat: async () => ({ text: 'not json at all', usage: { promptTokens: 1, completionTokens: 1, source: 'reported' } }),
  });
  await assert.rejects(
    generateDigest({ classId: 'class-1', generatedBy: 'prof', deps }),
    (error) => error.status === 502 && error.code === 'digest_invalid_output'
  );
  assert.equal(store.runs.length, 1);
  assert.deepEqual(await getLatestDigest('class-1', { store }), previous);
});

test('a failed refresh preserves the previous digest', async () => {
  const store = digestStore();
  const previous = await store.saveRun({
    classId: 'class-1',
    generatedBy: 'prof',
    windowStartDay: WINDOW.startDay,
    windowEndDay: WINDOW.endDay,
    timeZone: WINDOW.timeZone,
    summaryCount: 1,
    studentCount: 1,
    promptTokens: 1,
    completionTokens: 1,
    items: [{ rank: 1, topic: 'Kept', body: 'Kept body', kind: 'suggestion' }],
  });
  const { deps } = makeDeps({
    store,
    summarizeDay: async ({ day }) => (day === WINDOW.endDay ? { scanned: 1, updated: 0, skipped: 0, failed: 1 } : { scanned: 0, updated: 0, skipped: 1, failed: 0 }),
  });
  await assert.rejects(
    generateDigest({ classId: 'class-1', generatedBy: 'prof', deps }),
    (error) => error.status === 502 && error.code === 'digest_refresh_failed'
  );
  assert.equal(store.runs.length, 1);
  assert.deepEqual(await getLatestDigest('class-1', { store }), previous);
});

test('a model outage preserves the previous digest', async () => {
  const store = digestStore();
  await store.saveRun({
    classId: 'class-1',
    generatedBy: 'prof',
    windowStartDay: WINDOW.startDay,
    windowEndDay: WINDOW.endDay,
    timeZone: WINDOW.timeZone,
    summaryCount: 1,
    studentCount: 1,
    promptTokens: 1,
    completionTokens: 1,
    items: [{ rank: 1, topic: 'Kept', body: 'Kept body', kind: 'suggestion' }],
  });
  const { deps } = makeDeps({
    store,
    loadDigestSources: async () => [source()],
    completeChat: async () => {
      throw new Error('model down');
    },
  });
  await assert.rejects(
    generateDigest({ classId: 'class-1', generatedBy: 'prof', deps }),
    (error) => error.status === 502 && error.code === 'digest_generation_failed'
  );
  assert.equal(store.runs.length, 1);
});

test('repeated generation retains runs and returns only the newest', async () => {
  let calls = 0;
  const { deps, store } = makeDeps({
    summarizeDay: async () => ({ scanned: 0, updated: 0, skipped: 1, failed: 0 }),
    loadDigestSources: async () => [source()],
    completeChat: async () => {
      calls += 1;
      return { text: JSON.stringify({ items: [{ topic: `Topic ${calls}`, body: 'Body' }] }), usage: { promptTokens: 1, completionTokens: 1, source: 'reported' } };
    },
  });
  await generateDigest({ classId: 'class-1', generatedBy: 'prof', deps });
  await generateDigest({ classId: 'class-1', generatedBy: 'prof', deps });
  assert.equal(store.runs.length, 2);
  const latest = await getLatestDigest('class-1', { store });
  assert.equal(latest.items[0].topic, 'Topic 2');
});

test('quota exhaustion midway through refresh stops remaining calls and keeps the quota code', async () => {
  const days = [];
  let modelCalls = 0;
  const { deps, store } = makeDeps({
    limit: 10,
    summarizeDay: async ({ day, beforeModelCall, recordUsage }) => {
      days.push(day);
      await beforeModelCall();
      await recordUsage({ promptTokens: 6, completionTokens: 0, source: 'reported' });
      return { scanned: 1, updated: 1, skipped: 0, failed: 0 };
    },
    loadDigestSources: async () => [],
    completeChat: async () => {
      modelCalls += 1;
      return { text: '{"items":[]}', usage: null };
    },
  });
  await assert.rejects(
    generateDigest({ classId: 'class-1', generatedBy: 'prof', deps }),
    (error) => error.status === 429 && error.code === 'ai_quota_exceeded' && error.limit === 10 && typeof error.resetsAt === 'string'
  );
  assert.equal(days.length, 3);
  assert.equal(days[2], '2026-09-08');
  assert.equal(modelCalls, 0);
  assert.equal(store.runs.length, 0);
});

test('quota exhaustion after refresh stops the digest call and keeps the quota code', async () => {
  let modelCalls = 0;
  const { deps, store } = makeDeps({
    limit: 10,
    summarizeDay: async ({ day, beforeModelCall, recordUsage }) => {
      if (day === WINDOW.endDay) {
        await beforeModelCall();
        await recordUsage({ promptTokens: 10, completionTokens: 0, source: 'reported' });
      }
      return { scanned: 0, updated: 1, skipped: 0, failed: 0 };
    },
    loadDigestSources: async () => [source()],
    completeChat: async () => {
      modelCalls += 1;
      return { text: '{"items":[]}', usage: null };
    },
  });
  await assert.rejects(
    generateDigest({ classId: 'class-1', generatedBy: 'prof', deps }),
    (error) => error.code === 'ai_quota_exceeded'
  );
  assert.equal(modelCalls, 0);
  assert.equal(store.runs.length, 0);
});

test('overlapping generation for the same class is rejected and the gate always releases', async () => {
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const { deps } = makeDeps({
    summarizeDay: async () => ({ scanned: 0, updated: 0, skipped: 1, failed: 0 }),
    loadDigestSources: async () => [source()],
    completeChat: async () => {
      calls += 1;
      await blocked;
      return { text: '{"items":[]}', usage: { promptTokens: 1, completionTokens: 1, source: 'reported' } };
    },
  });
  const first = generateDigest({ classId: 'class-1', generatedBy: 'prof', deps });
  await assert.rejects(
    generateDigest({ classId: 'class-1', generatedBy: 'prof', deps }),
    (error) => error.status === 409 && error.code === 'digest_in_progress'
  );
  release();
  await first;
  await generateDigest({ classId: 'class-1', generatedBy: 'prof', deps });
  assert.equal(calls, 2);
});

test('getLatestDigest returns the empty shape when a class has no runs', async () => {
  assert.deepEqual(await getLatestDigest('class-x', { store: digestStore() }), { run: null, items: [] });
});

test('sanitizeDigestText neutralizes HTML and control characters', () => {
  assert.equal(sanitizeDigestText('<b>Recursion</b><script>alert(1)</script>'), 'Recursion alert(1)');
  assert.equal(sanitizeDigestText('  a\u0000b\tc\n'), 'a b c');
  assert.equal(sanitizeDigestText(123), '');
});

test('validateDigestOutput enforces 0 to 3 unique bounded items', () => {
  assert.deepEqual(validateDigestOutput('{"items":[]}'), []);
  assert.deepEqual(
    validateDigestOutput('```json\n{"items":[{"topic":"T","body":"B"}]}\n```').map((item) => item.rank),
    [1]
  );
  assert.throws(
    () => validateDigestOutput('{"items":[{"topic":"T","body":"B"},{"topic":"t","body":"C"}]}'),
    (error) => error.code === 'digest_invalid_output'
  );
  assert.throws(() => validateDigestOutput('not json'), (error) => error.code === 'digest_invalid_output');
  assert.throws(
    () => validateDigestOutput(JSON.stringify({ items: Array.from({ length: 4 }, (_, index) => ({ topic: `T${index}`, body: 'B' })) })),
    (error) => error.code === 'digest_invalid_output'
  );
  assert.throws(() => validateDigestOutput('{"items":[{"topic":"","body":"B"}]}'), (error) => error.code === 'digest_invalid_output');
});

test('chunkDigestSources splits oversized weeks without dropping lines', () => {
  const lines = ['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10)];
  assert.deepEqual(chunkDigestSources(lines, 25), [['a'.repeat(10), 'b'.repeat(10)], ['c'.repeat(10)]]);
  assert.deepEqual(chunkDigestSources(lines, 1000), [lines]);
});

test('enumerateInclusiveDays spans the seven-day Central window across DST', () => {
  assert.deepEqual(enumerateInclusiveDays('2026-09-07', '2026-09-13'), WINDOW_DAYS);
  const fall = enumerateInclusiveDays('2026-10-29', '2026-11-04');
  assert.equal(fall.length, 7);
  assert.equal(fall[0], '2026-10-29');
  assert.equal(fall[6], '2026-11-04');
});

test('generateDigest uses Agent D real getDigestWindow for the frozen seven-day window', async () => {
  const { getDigestWindow } = await import('../src/summary-time.js');
  const days = [];
  const { deps } = makeDeps({
    getDigestWindow,
    summarizeDay: async ({ day }) => {
      days.push(day);
      return { scanned: 0, updated: 0, skipped: 1, failed: 0 };
    },
    loadDigestSources: async ({ startDay, endDay }) => {
      assert.equal(startDay, '2026-09-07');
      assert.equal(endDay, '2026-09-13');
      return [source()];
    },
    completeChat: async () => ({ text: '{"items":[]}', usage: { promptTokens: 1, completionTokens: 1, source: 'reported' } }),
  });
  await generateDigest({ classId: 'class-1', generatedBy: 'prof', deps });
  assert.deepEqual(days, [WINDOW.endDay, ...WINDOW_DAYS.slice(0, -1)]);
});

test('Agent D summary module exposes the frozen digest-source interface', async () => {
  const summaries = await import('../src/summaries.js');
  assert.equal(typeof summaries.summarizeDay, 'function');
  assert.equal(typeof summaries.loadDigestSources, 'function');
});

function fakeMembership(req, _res, next) {
  if (!isUuid(req.params.classId)) return next(notFound('Class not found'));
  const role = req.headers['x-class-role'];
  if (role === 'none') return next(forbidden('You are not a member of this class'));
  if (role !== 'student' && role !== 'instructor') return next(forbidden('You are not a member of this class'));
  req.membership = role;
  req.cls = { id: req.params.classId };
  next();
}

function buildApp({ generate, latest } = {}) {
  const router = createDigestsRouter({
    auth: (req, _res, next) => {
      req.user = { id: 'prof-id', role: 'instructor' };
      next();
    },
    membership: fakeMembership,
    generate: generate ?? (async ({ classId }) => ({ run: { id: 'run-1', classId }, items: [] })),
    latest: latest ?? (async () => ({ run: null, items: [] })),
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.status ?? 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  });
  return app;
}

async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('digest routes deny students, non-members, and unknown classes; allow the class instructor', async () => {
  await withServer(buildApp(), async (base) => {
    const missing = await fetch(`${base}/classes/not-a-uuid/digest`, { headers: { 'x-class-role': 'instructor' } });
    assert.equal(missing.status, 404);

    const nonMember = await fetch(`${base}/classes/${UUID}/digest`, { headers: { 'x-class-role': 'none' } });
    assert.equal(nonMember.status, 403);

    // req.user.role is instructor globally, but this class membership is student.
    const student = await fetch(`${base}/classes/${UUID}/digest`, { headers: { 'x-class-role': 'student' } });
    assert.equal(student.status, 403);

    const instructor = await fetch(`${base}/classes/${UUID}/digest`, { headers: { 'x-class-role': 'instructor' } });
    assert.equal(instructor.status, 200);
    assert.deepEqual(await instructor.json(), { run: null, items: [] });
  });
});

test('POST generate requires the class instructor and passes the caller identity and a signal', async () => {
  const calls = [];
  const app = buildApp({
    generate: async (input) => {
      calls.push(input);
      return { run: { id: 'run-1', classId: input.classId }, items: [] };
    },
  });
  await withServer(app, async (base) => {
    const denied = await fetch(`${base}/classes/${UUID}/digest/generate`, {
      method: 'POST',
      headers: { 'x-class-role': 'student', 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(denied.status, 403);

    const ok = await fetch(`${base}/classes/${UUID}/digest/generate`, {
      method: 'POST',
      headers: { 'x-class-role': 'instructor', 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(ok.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].classId, UUID);
    assert.equal(calls[0].generatedBy, 'prof-id');
    assert.ok(calls[0].signal);
  });
});
