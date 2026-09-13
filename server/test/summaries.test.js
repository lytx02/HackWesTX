import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:1/unused';

const {
  CONTEXT_MESSAGE_LIMIT,
  MAX_ATTEMPTS,
  MAX_SUMMARY_LINE_CHARS,
  createSummariesService,
  loadDigestSources,
  redactIdentifiers,
  summarizeDay,
  validateSummary,
} = await import('../src/summaries.js');
const {
  addDays,
  centralDayEndIso,
  centralDayFor,
  centralDayStartIso,
  getDigestWindow,
  isCentralDay,
  previousCompletedCentralDay,
} = await import('../src/summary-time.js');

const DAY = '2026-09-13';
const TWO_LINES = 'Topics: recursion and base cases\nNo clear unresolved friction.';
const fixedNow = () => new Date('2026-09-13T16:00:00.000Z');
const summaryKey = (conversationId, summaryDay) => `${conversationId}|${summaryDay}`;
const msg = (id, conversationId, sender, body, createdAt) => ({ id, conversationId, sender, body, createdAt: new Date(createdAt) });
const at = (value) => (value instanceof Date ? value.getTime() : new Date(value).getTime());

function createMemoryStore({ conversations = [], enrollments = [], messages = [], summaries = [] } = {}) {
  const conversationRows = conversations.map((row) => ({ ...row }));
  const enrollmentRows = enrollments.map((row) => ({ ...row }));
  const messageRows = messages.map((row) => ({ ...row }));
  const summaryRows = new Map(summaries.map((row) => [summaryKey(row.conversationId, row.summaryDay), { ...row }]));
  let nextId = 1;

  const ownerOf = (conversation) => conversation.userId ?? conversation.studentId;
  const inRange = (value, startIso, endIso) => at(value) >= at(startIso) && at(value) < at(endIso);

  return {
    conversationRows,
    enrollmentRows,
    messageRows,
    summaries: summaryRows,

    async listStudentConversationDays({ classId, startIso, endIso }) {
      const found = new Map();
      for (const conversation of conversationRows) {
        if (classId && conversation.classId !== classId) continue;
        const owner = ownerOf(conversation);
        const enrollment = enrollmentRows.find((e) => e.userId === owner && e.classId === conversation.classId);
        if (!enrollment || enrollment.role !== 'student') continue;
        const asked = messageRows.some(
          (m) => m.conversationId === conversation.id && m.sender === 'user' && inRange(m.createdAt, startIso, endIso)
        );
        if (asked) found.set(conversation.id, { conversationId: conversation.id, studentId: owner, classId: conversation.classId });
      }
      return [...found.values()];
    },

    async loadMessages({ conversationId, startIso, endIso }) {
      return messageRows
        .filter((m) => m.conversationId === conversationId && inRange(m.createdAt, startIso, endIso))
        .sort((a, b) => at(a.createdAt) - at(b.createdAt) || String(a.id).localeCompare(String(b.id)));
    },

    async loadPreviousContext({ conversationId, beforeIso, limit }) {
      return messageRows
        .filter((m) => m.conversationId === conversationId && at(m.createdAt) < at(beforeIso))
        .sort((a, b) => at(b.createdAt) - at(a.createdAt) || String(b.id).localeCompare(String(a.id)))
        .slice(0, limit)
        .reverse();
    },

    async loadSummary({ conversationId, summaryDay }) {
      const row = summaryRows.get(summaryKey(conversationId, summaryDay));
      return row ? { ...row } : null;
    },

    async upsertSummary(row) {
      const key = summaryKey(row.conversationId, row.summaryDay);
      const existing = summaryRows.get(key);
      if (existing?.sourceThroughAt && at(existing.sourceThroughAt) > at(row.sourceThroughAt)) {
        return { updated: false };
      }
      const saved = { id: existing?.id ?? `summary-${nextId++}`, ...existing, ...row };
      summaryRows.set(key, saved);
      return { updated: true };
    },

    async loadDigestSources({ classId, startDay, endDay }) {
      const results = [];
      for (const row of summaryRows.values()) {
        const conversation = conversationRows.find((c) => c.id === row.conversationId);
        if (!conversation) continue;
        if (classId && conversation.classId !== classId) continue;
        const owner = ownerOf(conversation);
        const enrollment = enrollmentRows.find((e) => e.userId === owner && e.classId === conversation.classId);
        if (!enrollment || enrollment.role !== 'student') continue;
        if (row.summaryDay < startDay || row.summaryDay > endDay) continue;
        results.push({
          summaryId: row.id,
          conversationId: row.conversationId,
          studentId: owner,
          day: row.summaryDay,
          body: row.body,
        });
      }
      return results.sort((a, b) => a.day.localeCompare(b.day) || a.conversationId.localeCompare(b.conversationId));
    },
  };
}

function studentStore() {
  return createMemoryStore({
    conversations: [{ id: 'c1', classId: 'class-a', userId: 'student-1' }],
    enrollments: [{ userId: 'student-1', classId: 'class-a', role: 'student' }],
    messages: [msg('m1', 'c1', 'user', 'How do I choose a pivot?', '2026-09-13T15:00:00.000Z')],
  });
}

function mockModel(responder) {
  const calls = [];
  const complete = async (messages, options) => {
    calls.push({ messages, options });
    const index = calls.length;
    const result = typeof responder === 'function' ? responder({ index, messages, options }) : responder;
    return typeof result === 'string'
      ? { text: result, usage: { promptTokens: 1, completionTokens: 1, source: 'reported' } }
      : result;
  };
  return { complete, calls };
}

test('getDigestWindow returns today and the preceding six Central dates inclusive', () => {
  assert.deepEqual(getDigestWindow(new Date('2026-09-13T12:00:00Z')), {
    startDay: '2026-09-07',
    endDay: '2026-09-13',
    timeZone: 'America/Chicago',
  });
  assert.equal(getDigestWindow(new Date('2026-09-13T04:59:59.999Z')).endDay, '2026-09-12');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(centralDayFor(new Date('2026-09-13T05:00:00Z')), '2026-09-13');
  assert.ok(isCentralDay('2026-02-28'));
  assert.ok(!isCentralDay('2026-02-30'));
  assert.ok(!isCentralDay('nope'));
});

test('previousCompletedCentralDay returns the day before the current Central date', () => {
  assert.equal(previousCompletedCentralDay(new Date('2026-09-13T12:00:00Z')), '2026-09-12');
  assert.equal(previousCompletedCentralDay(new Date('2026-09-13T04:59:00Z')), '2026-09-11');
});

test('Central day instants are DST-aware across spring-forward and fall-back', () => {
  assert.equal(centralDayStartIso('2026-03-08'), '2026-03-08T06:00:00.000Z');
  assert.equal(centralDayEndIso('2026-03-08'), '2026-03-09T05:00:00.000Z');
  assert.equal(new Date(centralDayEndIso('2026-03-08')) - new Date(centralDayStartIso('2026-03-08')), 23 * 60 * 60 * 1000);

  assert.equal(centralDayStartIso('2026-11-01'), '2026-11-01T05:00:00.000Z');
  assert.equal(centralDayEndIso('2026-11-01'), '2026-11-02T06:00:00.000Z');
  assert.equal(new Date(centralDayEndIso('2026-11-01')) - new Date(centralDayStartIso('2026-11-01')), 25 * 60 * 60 * 1000);
});

test('summary validation de-identifies output and requires exactly two nonempty lines', () => {
  const body = validateSummary('Asked about recursion, email bob@okstate.edu\nNo friction, see https://example.com/help');
  assert.deepEqual(body.split('\n'), [
    'Asked about recursion, email [email]',
    'No friction, see [link]',
  ]);
  assert.throws(() => validateSummary('only one line'), /exactly two nonempty lines/);
  assert.throws(() => validateSummary('a\n\nb\nc'), /exactly two nonempty lines/);
  assert.equal(redactIdentifiers('call 555-123-4567 or @helper now'), 'call [phone] or [handle] now');
});

test('summaries are de-identified and capped to the configured line length', async () => {
  const store = studentStore();
  const { complete } = mockModel(() => `${'a'.repeat(900)} bob@okstate.edu\n${'b'.repeat(900)} https://example.com/x`);
  const counts = await summarizeDay({ day: DAY, deps: { store, complete, now: fixedNow } });
  assert.deepEqual(counts, { scanned: 1, updated: 1, skipped: 0, failed: 0 });
  const [row] = [...store.summaries.values()];
  const lines = row.body.split('\n');
  assert.equal(lines.length, 2);
  for (const line of lines) assert.ok(line.length <= MAX_SUMMARY_LINE_CHARS);
  assert.doesNotMatch(row.body, /bob@okstate\.edu|https?:\/\//);
});

test('invalid model output is retried a bounded number of times then counted failed with no write', async () => {
  const store = studentStore();
  const { complete, calls } = mockModel(() => 'only one line');
  const counts = await summarizeDay({ day: DAY, deps: { store, complete, now: fixedNow } });
  assert.deepEqual(counts, { scanned: 1, updated: 0, skipped: 0, failed: 1 });
  assert.equal(calls.length, MAX_ATTEMPTS);
  assert.equal(store.summaries.size, 0);
});

test('only student conversations in the requested class contribute', async () => {
  const store = createMemoryStore({
    conversations: [
      { id: 'c-student', classId: 'class-a', userId: 'student-1' },
      { id: 'c-instructor', classId: 'class-a', userId: 'prof-1' },
      { id: 'c-other', classId: 'class-b', userId: 'student-2' },
    ],
    enrollments: [
      { userId: 'student-1', classId: 'class-a', role: 'student' },
      { userId: 'prof-1', classId: 'class-a', role: 'instructor' },
      { userId: 'student-2', classId: 'class-b', role: 'student' },
    ],
    messages: [
      msg('m1', 'c-student', 'user', 'How do pointers work?', '2026-09-13T15:00:00Z'),
      msg('m2', 'c-instructor', 'user', 'Instructor note', '2026-09-13T15:00:00Z'),
      msg('m3', 'c-other', 'user', 'Other class question', '2026-09-13T15:00:00Z'),
    ],
  });
  const { complete, calls } = mockModel(() => TWO_LINES);
  const counts = await summarizeDay({ day: DAY, classId: 'class-a', deps: { store, complete, now: fixedNow } });
  assert.deepEqual(counts, { scanned: 1, updated: 1, skipped: 0, failed: 0 });
  assert.equal(calls.length, 1);
  assert.deepEqual([...store.summaries.keys()], [summaryKey('c-student', DAY)]);
});

test('snapshots use the inclusive [Central start, Central end) window', async () => {
  const store = createMemoryStore({
    conversations: [{ id: 'c1', classId: 'class-a', userId: 'student-1' }],
    enrollments: [{ userId: 'student-1', classId: 'class-a', role: 'student' }],
    messages: [
      msg('before', 'c1', 'user', 'yesterday question', '2026-09-13T04:59:59.999Z'),
      msg('inside', 'c1', 'user', 'today question', '2026-09-13T05:00:00.000Z'),
      msg('after', 'c1', 'user', 'tomorrow question', '2026-09-14T05:00:00.000Z'),
    ],
  });
  const { complete } = mockModel(() => TWO_LINES);
  const counts = await summarizeDay({ day: DAY, deps: { store, complete, now: fixedNow } });
  assert.deepEqual(counts, { scanned: 1, updated: 1, skipped: 0, failed: 0 });
  const [row] = [...store.summaries.values()];
  assert.equal(row.messageCount, 1);
  assert.equal(row.sourceThroughMessageId, 'inside');
});

test('repeating an unchanged day performs no model call and reports skipped', async () => {
  const store = studentStore();
  const first = mockModel(() => TWO_LINES);
  await summarizeDay({ day: DAY, deps: { store, complete: first.complete, now: fixedNow } });
  const second = mockModel(() => TWO_LINES);
  const counts = await summarizeDay({ day: DAY, deps: { store, complete: second.complete, now: fixedNow } });
  assert.deepEqual(counts, { scanned: 1, updated: 0, skipped: 1, failed: 0 });
  assert.equal(second.calls.length, 0);
});

test('on-demand refresh then nightly finalize update a single row in place', async () => {
  const store = studentStore();
  const before = [];
  const record = [];
  const onDemand = mockModel(() => 'Line A\nLine B');
  await summarizeDay({
    day: DAY,
    beforeModelCall: async () => { before.push(1); },
    recordUsage: async (usage) => { record.push(usage); },
    deps: { store, complete: onDemand.complete, now: fixedNow },
  });
  const firstId = [...store.summaries.values()][0].id;

  store.messageRows.push(msg('m2', 'c1', 'user', 'follow-up question', '2026-09-13T18:00:00.000Z'));

  const nightly = mockModel(() => 'Line C\nLine D');
  const counts = await summarizeDay({ day: DAY, deps: { store, complete: nightly.complete, now: fixedNow } });
  assert.deepEqual(counts, { scanned: 1, updated: 1, skipped: 0, failed: 0 });
  assert.equal(store.summaries.size, 1);
  assert.equal([...store.summaries.values()][0].id, firstId);
  assert.equal(before.length, 1);
  assert.equal(record.length, 1);
});

test('a late-arriving message after a completed run stays eligible', async () => {
  const store = studentStore();
  const first = mockModel(() => TWO_LINES);
  await summarizeDay({ day: DAY, deps: { store, complete: first.complete, now: fixedNow } });
  store.messageRows.push(msg('late', 'c1', 'user', 'I am still stuck on the base case', '2026-09-13T20:00:00.000Z'));
  const second = mockModel(() => 'New line one\nNew line two');
  const counts = await summarizeDay({ day: DAY, deps: { store, complete: second.complete, now: fixedNow } });
  assert.deepEqual(counts, { scanned: 1, updated: 1, skipped: 0, failed: 0 });
  assert.equal(second.calls.length, 1);
  assert.equal([...store.summaries.values()][0].sourceThroughMessageId, 'late');
});

test('an older overlapping job cannot overwrite a newer successful snapshot', async () => {
  const store = studentStore();
  const newer = {
    id: 'summary-newer',
    conversationId: 'c1',
    summaryDay: DAY,
    body: 'newer\nsnapshot',
    messageCount: 2,
    sourceThroughAt: new Date('2026-09-13T19:00:00.000Z'),
    sourceThroughMessageId: 'newer-msg',
    snapshotAt: new Date('2026-09-13T19:05:00.000Z'),
  };
  store.summaries.set(summaryKey('c1', DAY), { ...newer });
  const staleRead = {
    ...newer,
    body: 'old\nsnapshot',
    sourceThroughAt: new Date('2026-09-13T10:00:00.000Z'),
    sourceThroughMessageId: 'old-msg',
  };
  const racingStore = { ...store, loadSummary: async () => ({ ...staleRead }) };
  const { complete, calls } = mockModel(() => 'race\nresult');
  const counts = await summarizeDay({ day: DAY, deps: { store: racingStore, complete, now: fixedNow } });
  assert.deepEqual(counts, { scanned: 1, updated: 0, skipped: 1, failed: 0 });
  assert.equal(calls.length, 1);
  assert.equal(store.summaries.get(summaryKey('c1', DAY)).body, 'newer\nsnapshot');
});

test('overflow input is chunked and consolidated without dropping early questions', async () => {
  const messages = [];
  for (let i = 0; i < 40; i += 1) {
    const hour = String(10 + Math.floor(i / 6)).padStart(2, '0');
    const minute = String((i % 6) * 10).padStart(2, '0');
    messages.push(
      msg(
        `m${i}`,
        'c1',
        i % 2 === 0 ? 'user' : 'agent',
        `question ${i} ` + 'x'.repeat(400),
        `2026-09-13T${hour}:${minute}:00.000Z`
      )
    );
  }
  const store = createMemoryStore({
    conversations: [{ id: 'c1', classId: 'class-a', userId: 'student-1' }],
    enrollments: [{ userId: 'student-1', classId: 'class-a', role: 'student' }],
    messages,
  });
  const { complete, calls } = mockModel(({ index }) => `Batch ${index} topic\nBatch ${index} friction`);
  const counts = await summarizeDay({ day: DAY, deps: { store, complete, now: fixedNow } });
  assert.deepEqual(counts, { scanned: 1, updated: 1, skipped: 0, failed: 0 });
  assert.ok(calls.length >= 3, `expected chunked calls, got ${calls.length}`);
  const prompts = calls.map((call) => call.messages.map((message) => message.content).join('\n')).join('\n');
  assert.match(prompts, /question 0/);
  assert.match(calls[calls.length - 1].messages.map((m) => m.content).join('\n'), /Batch 1 topic/);
});

test('billing callbacks run once per model call and quota errors stop the run', async () => {
  const store = studentStore();
  const before = [];
  const record = [];
  const ok = mockModel(() => TWO_LINES);
  await summarizeDay({
    day: DAY,
    beforeModelCall: async () => { before.push(1); },
    recordUsage: async (usage) => { record.push(usage); },
    deps: { store, complete: ok.complete, now: fixedNow },
  });
  assert.equal(ok.calls.length, 1);
  assert.equal(before.length, 1);
  assert.equal(record.length, 1);
  assert.equal(record[0].source, 'reported');

  const quota = Object.assign(new Error('quota'), {
    code: 'ai_quota_exceeded',
    status: 429,
    limit: 10,
    resetsAt: '2026-09-14T05:00:00.000Z',
  });
  const failing = mockModel(() => { throw quota; });
  const store2 = studentStore();
  const before2 = [];
  const recorded2 = [];
  await assert.rejects(
    summarizeDay({
      day: DAY,
      beforeModelCall: async () => { before2.push(1); },
      recordUsage: async (usage) => { recorded2.push(usage); },
      deps: { store: store2, complete: failing.complete, now: fixedNow },
    }),
    (error) => error.code === 'ai_quota_exceeded'
  );
  assert.equal(before2.length, 1);
  assert.equal(failing.calls.length, 1);
  assert.equal(recorded2.length, 1);
  assert.equal(store2.summaries.size, 0);
});

test('a quota error thrown by beforeModelCall stops the run before any inference', async () => {
  const store = studentStore();
  const quota = Object.assign(new Error('quota'), { code: 'ai_quota_exceeded' });
  const { complete, calls } = mockModel(() => TWO_LINES);
  await assert.rejects(
    summarizeDay({
      day: DAY,
      beforeModelCall: async () => { throw quota; },
      recordUsage: async () => {},
      deps: { store, complete, now: fixedNow },
    }),
    (error) => error.code === 'ai_quota_exceeded'
  );
  assert.equal(calls.length, 0);
});

test('a failed generation writes nothing and the source succeeds on a later run', async () => {
  const store = studentStore();
  const failing = mockModel(() => { throw new Error('model down'); });
  const counts = await summarizeDay({ day: DAY, deps: { store, complete: failing.complete, now: fixedNow } });
  assert.deepEqual(counts, { scanned: 1, updated: 0, skipped: 0, failed: 1 });
  assert.equal(store.summaries.size, 0);
  assert.equal(failing.calls.length, MAX_ATTEMPTS);

  const retry = mockModel(() => TWO_LINES);
  const second = await summarizeDay({ day: DAY, deps: { store, complete: retry.complete, now: fixedNow } });
  assert.deepEqual(second, { scanned: 1, updated: 1, skipped: 0, failed: 0 });
});

test('earlier context is labelled and only the summary-day messages drive the watermark', async () => {
  const store = createMemoryStore({
    conversations: [{ id: 'c1', classId: 'class-a', userId: 'student-1' }],
    enrollments: [{ userId: 'student-1', classId: 'class-a', role: 'student' }],
    messages: [
      msg('old', 'c1', 'user', 'OLD-FRICTION token', '2026-09-12T15:00:00Z'),
      msg('today', 'c1', 'user', 'NEW-QUESTION token', '2026-09-13T15:00:00Z'),
    ],
  });
  const { complete, calls } = mockModel(() => TWO_LINES);
  await summarizeDay({ day: DAY, deps: { store, complete, now: fixedNow } });
  const prompt = calls[0].messages.map((message) => message.content).join('\n');
  assert.match(prompt, /Earlier context/);
  assert.match(prompt, /OLD-FRICTION/);
  assert.equal([...store.summaries.values()][0].sourceThroughMessageId, 'today');
  assert.equal(CONTEXT_MESSAGE_LIMIT, 4);
});

test('loadDigestSources returns student summaries inside the inclusive window only', async () => {
  const base = { messageCount: 1, snapshotAt: new Date('2026-09-13T16:00:00Z') };
  const store = createMemoryStore({
    conversations: [
      { id: 'c1', classId: 'class-a', userId: 'student-1' },
      { id: 'c2', classId: 'class-a', userId: 'prof-1' },
    ],
    enrollments: [
      { userId: 'student-1', classId: 'class-a', role: 'student' },
      { userId: 'prof-1', classId: 'class-a', role: 'instructor' },
    ],
    summaries: [
      { id: 's1', conversationId: 'c1', summaryDay: '2026-09-07', body: 'a\nb', sourceThroughAt: new Date('2026-09-07T15:00:00Z'), sourceThroughMessageId: 'x', ...base },
      { id: 's2', conversationId: 'c1', summaryDay: '2026-09-13', body: 'c\nd', sourceThroughAt: new Date('2026-09-13T15:00:00Z'), sourceThroughMessageId: 'y', ...base },
      { id: 's3', conversationId: 'c1', summaryDay: '2026-09-14', body: 'e\nf', sourceThroughAt: new Date('2026-09-14T15:00:00Z'), sourceThroughMessageId: 'z', ...base },
      { id: 's4', conversationId: 'c2', summaryDay: '2026-09-10', body: 'g\nh', sourceThroughAt: new Date('2026-09-10T15:00:00Z'), sourceThroughMessageId: 'w', ...base },
    ],
  });
  const rows = await loadDigestSources({
    classId: 'class-a',
    startDay: '2026-09-07',
    endDay: '2026-09-13',
    deps: { store },
  });
  assert.deepEqual(rows.map((row) => row.summaryId).sort(), ['s1', 's2']);
  assert.ok(rows.every((row) => row.studentId === 'student-1'));
});

test('the service factory injects defaults while per-call options still override', async () => {
  const store = studentStore();
  const { complete, calls } = mockModel(() => TWO_LINES);
  const service = createSummariesService({ store, complete, now: fixedNow });
  const counts = await service.summarizeDay({ day: DAY });
  assert.deepEqual(counts, { scanned: 1, updated: 1, skipped: 0, failed: 0 });
  assert.equal(calls.length, 1);
  const rows = await service.loadDigestSources({ classId: 'class-a', startDay: DAY, endDay: DAY });
  assert.equal(rows.length, 1);
});
