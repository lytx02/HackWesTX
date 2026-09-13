import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:1/unused';

const {
  createUsageService,
  getCentralDay,
  getNextCentralMidnight,
  MISSING_USAGE_COMPLETION_ESTIMATE,
  parseDailyTokenLimit,
} = await import('../src/usage.js');

function memoryStore(initial = {}) {
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

const user = (day = null, used = 0) => ({ aiUsageDay: day, aiTokensUsed: used });

test('DAILY_TOKEN_LIMIT accepts a non-default positive safe integer and rejects configured invalid values', () => {
  assert.equal(parseDailyTokenLimit(undefined), 50_000);
  assert.equal(parseDailyTokenLimit('1234'), 1234);
  assert.equal(parseDailyTokenLimit(' 1234 '), 1234);
  for (const value of ['', '0', '-1', '1.5', 'nope', String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(() => parseDailyTokenLimit(value), /positive safe integer/);
  }
});

test('an invalid configured DAILY_TOKEN_LIMIT rejects module startup', () => {
  const serverDir = fileURLToPath(new URL('../', import.meta.url));
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', "await import('./src/usage.js')"], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: 'postgres://unused:unused@localhost:1/unused', DAILY_TOKEN_LIMIT: 'invalid' },
    encoding: 'utf8',
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /DAILY_TOKEN_LIMIT must be a positive safe integer/);
});

test('Central day and next midnight are DST-aware', () => {
  assert.equal(getCentralDay(new Date('2026-09-13T04:59:59.999Z')), '2026-09-12');
  assert.equal(getCentralDay(new Date('2026-09-13T05:00:00.000Z')), '2026-09-13');
  assert.equal(getNextCentralMidnight(new Date('2026-09-13T12:00:00Z')).toISOString(), '2026-09-14T05:00:00.000Z');

  // The day ending at the spring transition is 23 hours; the day ending at
  // the fall transition is 25 hours.
  const springStart = getNextCentralMidnight(new Date('2026-03-07T12:00:00Z'));
  const springEnd = getNextCentralMidnight(new Date('2026-03-08T12:00:00Z'));
  assert.equal(springStart.toISOString(), '2026-03-08T06:00:00.000Z');
  assert.equal(springEnd.toISOString(), '2026-03-09T05:00:00.000Z');
  assert.equal(springEnd - springStart, 23 * 60 * 60 * 1000);

  const fallStart = getNextCentralMidnight(new Date('2026-10-31T12:00:00Z'));
  const fallEnd = getNextCentralMidnight(new Date('2026-11-01T12:00:00Z'));
  assert.equal(fallStart.toISOString(), '2026-11-01T05:00:00.000Z');
  assert.equal(fallEnd.toISOString(), '2026-11-02T06:00:00.000Z');
  assert.equal(fallEnd - fallStart, 25 * 60 * 60 * 1000);
});

test('read-only usage projects a stale DB day as zero without writing', async () => {
  const store = memoryStore({ student: user('2026-09-12', 999) });
  const service = createUsageService({ store, limit: 1234, now: () => new Date('2026-09-13T12:00:00Z') });
  assert.deepEqual(await service.getUsage('student'), {
    limit: 1234,
    used: 0,
    remaining: 1234,
    resetsAt: '2026-09-14T05:00:00.000Z',
  });
  assert.equal(store.writes.length, 0);
});

test('usage accumulates across class, helper, and generation calls for both roles', async () => {
  const store = memoryStore({ student: user(), professor: user() });
  const service = createUsageService({ store, limit: 100, now: () => new Date('2026-09-13T12:00:00Z') });
  const call = (id, promptTokens, completionTokens) => service.withUsageBudget(id, async ({ beforeModelCall, recordUsage }) => {
    await beforeModelCall();
    await recordUsage({ promptTokens, completionTokens, source: 'reported' });
  });
  await call('student', 10, 5); // one class
  await call('student', 7, 3); // another class/helper; same user counter
  await call('professor', 20, 4); // professor-triggered generation
  await call('professor', 3, 1); // professor helper
  assert.equal((await service.getUsage('student')).used, 25);
  assert.equal((await service.getUsage('professor')).used, 28);
});

test('multi-call work settles and rechecks, allowing one final overage but no later call', async () => {
  const store = memoryStore({ professor: user() });
  const service = createUsageService({ store, limit: 10, now: () => new Date('2026-09-13T12:00:00Z') });
  await assert.rejects(
    service.withUsageBudget('professor', async ({ beforeModelCall, recordUsage }) => {
      await beforeModelCall();
      await recordUsage({ promptTokens: 6, completionTokens: 0, source: 'reported' });
      await beforeModelCall();
      await recordUsage({ promptTokens: 6, completionTokens: 0, source: 'reported' });
      await beforeModelCall();
    }),
    (error) => error.status === 429
      && error.code === 'ai_quota_exceeded'
      && error.limit === 10
      && error.resetsAt === '2026-09-14T05:00:00.000Z'
      && error.message.includes('10-token allowance')
  );
  assert.equal(store.rows.get('professor').aiTokensUsed, 12);
  assert.equal(store.writes.length, 2);
});

test('one in-process operation per user rejects concurrency and always releases the gate', async () => {
  const store = memoryStore({ student: user() });
  const service = createUsageService({ store, now: () => new Date('2026-09-13T12:00:00Z') });
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const first = service.withUsageBudget('student', async () => blocker);
  await assert.rejects(
    service.withUsageBudget('student', async () => {}),
    (error) => error.status === 409 && error.code === 'ai_request_in_progress'
  );
  release();
  await first;
  await service.withUsageBudget('student', async () => {});
});

test('missing usage is explicit, estimated, non-zero, and charged once', async () => {
  const store = memoryStore({ student: user() });
  const service = createUsageService({ store, now: () => new Date('2026-09-13T12:00:00Z') });
  let settled;
  await service.withUsageBudget('student', async ({ beforeModelCall, recordUsage }) => {
    await beforeModelCall();
    settled = await recordUsage(null);
  });
  assert.deepEqual(settled, { promptTokens: 1, completionTokens: MISSING_USAGE_COMPLETION_ESTIMATE, source: 'estimated' });
  assert.deepEqual(store.writes, [{ id: 'student', day: '2026-09-13', tokens: MISSING_USAGE_COMPLETION_ESTIMATE + 1 }]);
});

test('disconnect/error after admission auto-settles before releasing the gate', async () => {
  const store = memoryStore({ student: user() });
  const service = createUsageService({ store, now: () => new Date('2026-09-13T12:00:00Z') });
  const disconnected = new Error('disconnected');
  await assert.rejects(
    service.withUsageBudget('student', async ({ beforeModelCall }) => {
      await beforeModelCall();
      throw disconnected;
    }),
    (error) => error === disconnected
  );
  assert.equal(store.rows.get('student').aiTokensUsed, MISSING_USAGE_COMPLETION_ESTIMATE + 1);
  await service.withUsageBudget('student', async () => {});
});

test('assistant persistence failure after model settlement does not refund consumption', async () => {
  const store = memoryStore({ student: user() });
  const service = createUsageService({ store, now: () => new Date('2026-09-13T12:00:00Z') });
  await assert.rejects(
    service.withUsageBudget('student', async ({ beforeModelCall, recordUsage }) => {
      await beforeModelCall();
      await recordUsage({ promptTokens: 8, completionTokens: 3, source: 'reported' });
      throw new Error('assistant message insert failed');
    }),
    /assistant message insert failed/
  );
  assert.equal(store.rows.get('student').aiTokensUsed, 11);
  assert.equal(store.writes.length, 1);
});

test('calls spanning midnight settle to admission day without overwriting the newer counter', async () => {
  const store = memoryStore({ student: user('2026-03-08', 5) });
  let clock = new Date('2026-03-09T04:59:59Z'); // 23:59:59 Central, after spring DST shift
  const service = createUsageService({ store, limit: 100, now: () => clock });
  await service.withUsageBudget('student', async ({ beforeModelCall, recordUsage }) => {
    await beforeModelCall();
    clock = new Date('2026-03-09T05:00:01Z'); // next Central day
    await recordUsage({ promptTokens: 2, completionTokens: 1, source: 'reported' });
    assert.equal((await service.getUsage('student')).used, 0);
    await beforeModelCall();
    await recordUsage({ promptTokens: 4, completionTokens: 1, source: 'reported' });
  });
  assert.deepEqual(store.writes.map(({ day, tokens }) => ({ day, tokens })), [
    { day: '2026-03-08', tokens: 3 },
    { day: '2026-03-09', tokens: 5 },
  ]);
  assert.equal(store.rows.get('student').aiUsageDay, '2026-03-09');
  assert.equal(store.rows.get('student').aiTokensUsed, 5);
});

test('a prior-day in-flight settlement cannot overwrite usage already written for a newer day', async () => {
  const store = memoryStore({ student: user('2026-11-01', 0) });
  let clock = new Date('2026-11-02T05:59:59Z'); // 23:59:59 Central on fall-back day
  const service = createUsageService({ store, now: () => clock });
  await service.withUsageBudget('student', async ({ beforeModelCall, recordUsage }) => {
    await beforeModelCall();
    // Simulate a newer-day writer (for example another API instance) winning
    // before this admitted call settles.
    store.rows.set('student', user('2026-11-02', 9));
    clock = new Date('2026-11-02T06:00:01Z');
    await recordUsage({ promptTokens: 2, completionTokens: 1, source: 'reported' });
  });
  assert.deepEqual(store.rows.get('student'), user('2026-11-02', 9));
});
