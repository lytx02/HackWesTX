# RunPod, daily conversation summaries, and instructor digests

Status: finalized implementation plan; ready to distribute to agents. Application changes are not implemented.
Based on repository commit `9564d65` and the user's clarified requirements.
This document overrides conflicting proposals in `docs/erd-v3.md` for this task.

## 1. Agreed scope

- Keep Express, Drizzle, `pg`, and the existing Vultr Postgres connection in `server/src/db.js`.
- Keep the current Auth0/demo login, institutions, announcements, global base prompt, and Canvas integration. Do not implement the ERD's optional removals or Canvas upgrade tiers.
- Canvas courses remain identified by the existing host/course-ID key. Never merge courses merely because their display names match. Keep existing manual course behavior; UUID joining is deferred.
- Persist chat messages so users can reopen old conversations. Do not prune transcripts or require a database reset.
- At end of day, save a two-line summary for each student conversation with new activity. Describe questions, doubts, topics, and unresolved friction. Preserve a separate row for each conversation/day.
- Summaries are internal inputs to instructor digests. Do not insert summaries or digests as chat messages, or add them to the student's model context.
- A professor clicks Generate digest for a class. Refresh today's changed student conversation summaries, then combine them with saved summaries from the previous six Central calendar days into zero to three ranked topics to reteach. Emphasize the strongest recurring friction; do not fabricate three items when fewer are supported.
- Only student class chats contribute, using the owner's enrollment role in that class. Instructor chats and the unpersisted floating helper do not contribute.
- Every user, including professors, has an input-plus-output allowance configured by `DAILY_TOKEN_LIMIT` (default `50000`), shared across classes, the floating helper, and professor-triggered summary/digest generation. Reset at midnight `America/Chicago`. Show an actionable quota error with the configured limit and reset time.
- RunPod GPU pod configuration comes from `VLLM_BASE_URL`, `VLLM_MODEL`, and `VLLM_API_KEY`. Never hardcode the endpoint, a guessed Qwen model ID, or credentials. The user described their served model as Qwen3.8; use the exact deployment value supplied through the environment.
- Keep this a single-API-instance hackathon implementation with a scheduled summary command. No Redis, distributed queue, new auth system, or broad refactoring.

## 2. Final decisions and environment configuration

All product decisions required for these prompts are resolved.

| ID | Behavior | Final decision |
| --- | --- | --- |
| D1 | Allowance reset | Midnight Central (`America/Chicago`), with DST-aware calendar boundaries. |
| D2 | Digest window | Today's refreshed summaries plus saved summaries from the previous six Central calendar days. |
| D3 | Manual generation billing | Charge all on-demand summary refresh and digest calls to the requesting professor. Automatic nightly summaries are system cost. |

Use `America/Chicago` for both summary dates and allowance resets, including DST; do not use UTC `current_date`, a fixed UTC offset, or a rolling 24-hour timer. Refresh only changed summaries and expose the added latency in the UI. Today's summary is updated in place under the existing conversation/day unique key; the nightly command fills in any activity since that snapshot. A digest generated on September 13 covers September 7 through September 13 inclusive, not seven prior days plus today.

Required API environment variables: `VLLM_BASE_URL`, `VLLM_MODEL`, `VLLM_API_KEY`, and `DAILY_TOKEN_LIMIT=50000`. The allowance must be a positive safe integer; use 50000 only when unset and reject invalid configured values at startup. Server responses and UI/error copy must use the effective configured value, never a hardcoded 50,000. Keys and model credentials remain server-side. Deployment supplies the exact served model name.

MVP allowance semantics: check the current DB counter before each user-triggered model call, serialize calls for the same user within the API process, and atomically add actual usage. An accepted final request may finish above the configured limit; all later calls are rejected until the next Central midnight. This is a request admission limit, not an exact GPU billing ceiling. Do not claim otherwise. A strict pre-reserved token ceiling is a separate enhancement. In a multi-call digest operation, settle and recheck between calls so an exhausted allowance cannot start additional summary/chunk/reduction calls.

## 3. Shared schema contract (Agent A owns all schema changes)

Use Drizzle camelCase exports/fields with snake_case SQL names. All additions are forward migrations after `0002`; keep existing migration history.

### Existing tables

- `users`: add `aiUsageDay` (nullable date, Central calendar day) and `aiTokensUsed` (integer, non-null, default 0, nonnegative). Existing users start unused; a different Central date means zero current usage until the next atomic rollover/write. No reset cron is required.
- `messages`: add nullable `promptTokens` and `completionTokens` (nonnegative integers, agent rows only), and `usageSource` (nullable text: `reported` or `estimated`). Existing rows remain readable without fabricated token counts.
- `digestItems`: add nullable `digestRunId` FK to `digestRuns`, cascade on run deletion; nullable `rank` integer constrained to 1..3 when set; nullable `topic` text. Unique `(digestRunId, rank)`. Keep existing `kind` and `body`. New generated items use kind `suggestion`, rank 1..3, a topic title, and a short body explaining friction and a reteaching action. Existing seed items have null run IDs and are not presented as generated insights.

### New `conversationDailySummaries` / `conversation_daily_summaries`

- `id` UUID PK, default random.
- `conversationId` UUID FK to conversations, non-null, cascade.
- `summaryDay` date, non-null; interpreted using `America/Chicago`.
- `body` text, non-null; exactly two nonempty lines with capped length.
- `messageCount` integer, non-null; number of source messages in that day's successful snapshot.
- `sourceThroughAt` timestamptz and `sourceThroughMessageId` UUID: last source message under deterministic `(createdAt, id)` ordering. The ID is a watermark, not a cascade-triggering FK.
- `snapshotAt` timestamptz, non-null: when the input snapshot was selected.
- `createdAt`, `updatedAt` timestamptz, non-null.
- Unique `(conversationId, summaryDay)`; index `(summaryDay, conversationId)`.

Do not add a lone rolling `conversations.summary` as a substitute for daily rows. Do not duplicate class/user foreign keys into summaries; derive them through conversations.

### New `digestRuns` / `digest_runs`

- `id` UUID PK, default random.
- `classId` UUID FK to classes, non-null, cascade.
- `generatedBy` UUID FK to users, nullable, on delete set null.
- `windowStartDay`, `windowEndDay` dates, non-null, both inclusive; exactly seven calendar days.
- `timeZone` text, non-null.
- `summaryCount`, `studentCount` integers, non-null, default 0.
- `promptTokens`, `completionTokens` nullable integers: total reported/estimated model usage for this run.
- `createdAt` timestamptz, non-null; index `(classId, createdAt)`.

A run represents a successful result, including a valid zero-item result. Insert the run and its items in one short transaction after generation and validation. A failure must not erase the last successful digest. GET returns only the newest successful run, never accumulated items from all runs. Multiple successful generations can be retained for this MVP without building a history UI.

## 4. Shared module and HTTP contracts

These exports are frozen for parallel work. An owner may improve internals but must coordinate interface changes.

### Model transport: Agent B

```js
// Retain existing string-delta behavior for callers.
streamChat(messages, { signal, onUsage, maxTokens, temperature } = {})
// Async iterator of text strings. Await onUsage once when final usage is known.

completeChat(messages, { signal, maxTokens, temperature } = {})
// Promise<{ text, usage: { promptTokens, completionTokens, source } | null }>

// Keep existing isConfigured, ping, getModel, toChatMessages, and chat exports.
// chat still resolves to a string for backward compatibility.
```

`source` is `reported` for server usage. Unknown usage is null, never a silently invented zero. Request streamed usage and handle a usage-only event with an empty choices array. Summary/digest callers validate JSON themselves, avoiding reliance on an unverified model's structured-output extensions. Configurable context/input bounds must protect all call types; never assume a last-30-messages cap guarantees the context fits. Preserve original DB history even if model input must be bounded. Background inputs that exceed the bound must be chunked by the calling service or rejected explicitly, never silently truncated by the transport.

### Budget and chat integration: Agent C

```js
withUsageBudget(userId, async ({ beforeModelCall, recordUsage, usage }) => { /* model calls */ })
// Holds one in-process user gate; resets/reads current DB usage before work.
// Await beforeModelCall() immediately before EVERY inference call, including retries.
// Await recordUsage({ promptTokens, completionTokens, source }) after each call;
// charge each call exactly once, even if later validation/persistence fails.
// `usage` is the entry snapshot; beforeModelCall() rechecks the live allowance.

getUsage(userId)
// Promise<{ limit: number, used, remaining, resetsAt: ISOString }>
// limit comes from DAILY_TOKEN_LIMIT; resetsAt is the next Central midnight.

// New routes/usage.js exports usageRouter, requiring requireUser.
GET /ai/usage
```

Place `withUsageBudget` and `getUsage` in `server/src/usage.js`. Every route must check the budget before storing a new user message or opening an SSE stream. Model consumption is still charged if the model succeeded but digest JSON validation or message persistence subsequently failed. For interrupted/missing usage, use an explicit conservative estimate, mark it estimated, and test it; do not represent estimates as exact server tokenization. Do not charge stub replies. `recordUsage` is async; streaming transport awaits its callback and background services await it before starting another call. Attribute a call to the Central day on which beforeModelCall admitted it; settling an in-flight call across midnight must not overwrite usage for a newer day. The single-user gate includes settlement, and read-only getUsage projects a stale stored day as zero without changing the row.

Quota rejection: HTTP 429, `code: 'ai_quota_exceeded'`, `limit`, `resetsAt`, and `error: 'You have used your <formatted configured limit>-token allowance. Come back after <reset time>.'` An already running request from the same user returns 409 `ai_request_in_progress`. When an error occurs after SSE starts, preserve `code`, `status`, `limit`, and `resetsAt` in the `error` event. Agent G serializes these fields through the central error handler; Agent F preserves them in ApiError.

### Daily summaries: Agent D

```js
// server/src/summaries.js
summarizeDay({ day, classId, signal, beforeModelCall, recordUsage } = {})
// Promise<{ scanned, updated, skipped, failed }>
// day required YYYY-MM-DD; classId optional.
// Billing callbacks required for professor-triggered runs; omitted for nightly runs.

loadDigestSources({ classId, startDay, endDay })
// Promise<Array<{ summaryId, conversationId, studentId, day, body }>>
// Internal data only. Restrict to student enrollments and inclusive date window.
```

`server/src/summary-time.js` exports `getDigestWindow(now = new Date())` returning `{ startDay, endDay, timeZone: 'America/Chicago' }`: endDay is today's Central date, startDay is six calendar days earlier. Also export date-boundary helpers needed by the daily CLI. Agent D owns digest-window semantics; no separate timezone calculation in digest routes or frontend. Freeze a digest's window at request start, even if generation crosses midnight.

Select only days with student questions. Regenerate a saved day's row only if its source messages changed. Successful summary writes do not themselves count as activity. Use deterministic ordering and snapshot watermarks; never mark messages arriving during model generation as covered. Newer successful snapshots must not be overwritten by older overlapping jobs. No DB transaction stays open during model calls.

Summarize that day's messages, using limited earlier context only when needed to interpret references. Do not count older friction as a new question merely because it appeared in the contextual prefix. If the day's input exceeds model limits, summarize bounded chunks and consolidate to two lines; do not silently ignore earlier questions. Use bounded retries; failures leave source data eligible for the next command.

Two-line format: line 1 names topics and questions; line 2 describes unresolved doubts/friction, or explicitly states no clear unresolved friction. No names, emails, student IDs, raw transcript quotes, or commands copied from student text. Treat transcript content as untrusted data. Redact obvious identifiers before generation and validate the output. This is MVP de-identification, not a guarantee against every contextual identifier.

### Digests: Agent E

```js
// server/src/digests.js
generateDigest({ classId, generatedBy, signal })
// Promise<{ run, items }> ; charges generatedBy via withUsageBudget.
getLatestDigest(classId)
// Promise<{ run: null, items: [] } | { run, items }>

// New routes/digests.js exports digestsRouter.
GET  /classes/:classId/digest
POST /classes/:classId/digest/generate
// Both require signed-in membership.role === 'instructor'. POST body is {}.
```

Public run fields: `id`, `classId`, `windowStartDay`, `windowEndDay`, `timeZone`, `summaryCount`, `studentCount`, `createdAt`. Public item fields: `id`, `rank`, `topic`, `body`, `kind`. Do not return raw summaries, owner IDs, message IDs, or individual attribution. Never accept a caller-supplied class/user identity as authority; validate using route membership.

Generate flow: acquire the class gate and the professor's usage gate once, freeze the Central date window, and call summarizeDay for today/class with both billing callbacks. Refresh missing/stale days within the previous six days as catch-up if needed, reusing all unchanged stored summaries without model calls. Charge any on-demand catch-up to the requesting professor too. Then load the selected seven days and generate the digest under the same gate. Do not nest another withUsageBudget inside summarizeDay. If any required refresh fails, return an error and keep the last successful digest instead of claiming the new digest includes current activity; successfully refreshed daily rows remain reusable for a retry. Budget exhaustion must stop retries/remaining calls immediately and preserve the quota code.

After refresh, no sources: save and return a successful empty run without a digest model call. If there were no eligible chats at all, the whole operation uses zero model tokens. Model output schema: `{ items: [{ topic: string, body: string }] }`, length 0..3, nonempty bounded strings, unique topics. Rank by recurring unresolved difficulty, with breadth across distinct students stronger evidence than repeated messages by one student. Use request-local anonymous labels to distinguish contributors without transmitting DB IDs. Never claim numeric support not derived from sources. Single-student demo data is allowed; no minimum cohort threshold.

Use all eligible summaries within bounded model requests; chunk and consolidate if necessary instead of taking an arbitrary first N. Account for every inference call when billed. Model output is data, never HTML or executable instructions. Validation failures and model outages retain the previous digest and return an actionable error. Prevent overlapping generation for a class within the one API instance; frontend disables the button while pending.

`GET /classes/:classId` remains compatible, but its `digest` array must be empty for students and contain only latest-run items for instructors. The dedicated digest endpoint carries generation metadata and drives the new UI.

## 5. Exclusive ownership and launch sequence

All agents may read the repository. Only the assigned owner edits each path, including test files. Do not generate another agent's migrations, edit shared manifests, or perform drive-by fixes. Request contract changes through the coordinator.

| Agent | Exclusive paths |
| --- | --- |
| A: database | `server/src/schema.js`, `server/src/seed.js`, `server/drizzle/**`, `server/test/database.test.js` |
| B: RunPod transport | `server/src/llm.js`, `server/scripts/ping-vllm.js`, `server/test/llm.test.js` |
| C: budget + chat | `server/src/usage.js`, `server/src/routes/usage.js`, `server/src/agent.js`, `server/src/routes/agent.js`, `server/src/routes/conversations.js`, `server/src/sse.js`, `server/src/http.js`, `server/test/usage.test.js`, `server/test/chat.test.js` |
| D: daily summaries | `server/src/summaries.js`, `server/src/summary-time.js`, `server/scripts/summarize-day.js`, `server/test/summaries.test.js` |
| E: digest backend | `server/src/digests.js`, `server/src/routes/digests.js`, `server/src/routes/classes.js`, `server/test/digests.test.js` |
| F: frontend | `src/api/client.js`, `src/api/hooks.js`, `src/api/stream.js`, `src/components/AgentChat.jsx`, `src/components/DigestTile.jsx`, `src/pages/instructor/InstructorClassView.jsx`, `src/pages/student/ChatView.jsx`, `src/theme/global.css` |
| G: integration/deployment | `server/src/index.js`, `server/package.json`, `server/package-lock.json`, root `package.json` and `package-lock.json`, `server/.env.example`, `deploy/**`, `README.md`, `server/test/integration.test.js` |

`docs/implementation-plan.md` and `docs/erd-v3.md` remain coordinator-owned. No agent edits `server/.env` or production configuration secrets. Leave `server/src/db.js` unchanged unless the coordinator identifies a concrete defect; the existing TLS and small pool are part of the working deployment.

1. Coordinator distributes this finalized contract with the relevant prompt to every agent; no further product decision is pending.
2. Launch A-F in parallel; launch G for entry-point/config preparation if an additional agent is available. Separate worktrees are preferred. A publishes exact schema exports early, B publishes the model interface early, and C publishes budget exports early.
3. Agents implement against the frozen interfaces with injected/mocked dependencies until prerequisite implementations are available. New services must be importable without immediately starting a server/job. Prefer dependency injection or small factories for tests instead of introducing new shared test infrastructure.
4. Merge A first, then B/C/D, then E/F. G integrates the assembled changes and completes combined checks. Shared-checkout users keep the same file ownership and avoid concurrent git staging/commits.
5. Apply migrations once from the integration owner after review and an appropriate backup of the existing DB. Never run the destructive seed command on the shared Vultr DB. This planning task does not itself execute migrations or deploy.

## 6. Copy-paste agent prompts

Ready to send. Give each agent its prompt and ensure this exact contract is in its checkout. Each prompt's referenced contract is mandatory.

### Agent A — database

Read docs/implementation-plan.md completely; implement Agent A's schema contract and only its owned files. Read the live schema and migrations 0000-0002 first. Add daily summaries, successful digest runs, ranked digest items, user usage counters, and nullable message usage metadata exactly as specified. Preserve existing users, chats, Canvas IDs/tokens, settings, and auth tables. Generate one forward Drizzle migration with matching journal/snapshot metadata; inspect the SQL. Update seed compatibility without running it against shared data. Verify a fresh disposable database and an upgraded disposable database containing existing chats; verify unique day summaries, ranks, and cascades. Do not migrate production. Report changed files, exported schema fields, validation results, and any dependencies. Do not modify manifests, transport, routes, or this contract.

### Agent B — RunPod model transport

Read docs/implementation-plan.md completely; implement Agent B only. Extend the existing llm.js rather than creating another provider layer. Preserve string-delta streaming and legacy chat exports; add completeChat and usage callbacks exactly as contracted. Use only environment configuration for model, URL, and key. Request and parse terminal usage, including usage-only chunks, fragmented SSE, CRLF, missing usage, server errors, timeout, abort, and abrupt EOF. Never treat an abruptly terminated stream as a successful full response. Bound inputs and make per-call output/temperature overrides available to background services. Preserve DB history by changing only outgoing prompts. Verify with mocked HTTP streams; extend ping to display completion and usage diagnostics without credentials. Do not call a paid/live endpoint without an existing configured test target and task authorization. Tell G which env entries are needed rather than editing .env.example. Report compatibility and remaining live verification requirements.

### Agent C — usage enforcement and chat integration

Read docs/implementation-plan.md completely; implement Agent C only. Implement usage.js and the usage router against Agent A's aiUsageDay/aiTokensUsed fields and Agent B's usage callback. Read DAILY_TOKEN_LIMIT from the server environment, default 50000, and reject invalid configured values. Apply it to every role across class chats, helper requests, and professor-triggered generation. Reset at midnight America/Chicago using DST-aware dates, not a rolling 24-hour interval or UTC midnight. Implement beforeModelCall and awaited recordUsage exactly as contracted so Agent E can meter every refresh, retry, and digest call. Read/reset counters from DB, use atomic updates, and settle consumed tokens on error/disconnect. Serialize one model operation per user inside the API process; always release the gate. Implement explicit missing-usage fallback with estimated metadata. Check quota before inserting a user turn or opening SSE. Pass usage through agent.js and persist token metadata on assistant messages. Keep current prompt settings and stub behavior. Persist/reload conversations, preserve partial-output behavior with accurate error handling, and keep class authorization valid for existing conversations. Error strings and usage responses must use the configured limit and next Central midnight. Tests must exercise a non-default limit, invalid env values, Central midnight and both DST transitions, calls spanning midnight, cumulative use across classes/helper/generation, both roles, multi-call budget exhaustion, concurrency, missing usage, disconnect, and persistence failure after consumption. Coordinate with G on router mounting/error serialization and F on payloads. Do not edit their files.

### Agent D — end-of-day conversation summaries

Read docs/implementation-plan.md completely; implement Agent D only. Implement the shared summary exports and America/Chicago timezone helpers, using existing messages and student enrollment roles. Summarize changed student conversations per calendar day into exactly two short lines focused on questions/topics and unresolved friction. Persist separate conversation/day rows with snapshot coverage so repeated runs skip unchanged input and late messages remain eligible. Today's on-demand refresh updates the same row the nightly run will later finalize; do not add a duplicate or summarize an unchanged snapshot again. Support class-scoped refresh and await the supplied beforeModelCall/recordUsage callbacks for every model call, chunk, and retry; automated nightly runs omit these callbacks and remain system cost. Propagate quota errors immediately to Agent E. Do not insert summary messages into conversations. Use bounded chunking when input exceeds context; do not silently discard questions. De-identify source/output and treat chat text as untrusted. Build a CLI with --day YYYY-MM-DD and --catch-up-days 7; no-argument runs process the previous completed Central day. Catch-up scans the last seven completed days and handles missing/stale rows after downtime. Implement bounded retries without adding Redis or another service. Do not hold DB transactions during inference. getDigestWindow returns today and the preceding six Central dates, inclusive. Use injected model/DB dependencies for meaningful tests of repeated refreshes, on-demand-then-nightly updates, midnight/DST boundaries, role filtering, overflow, callback billing, failed generations, late arrivals, and stale write protection. Give G the exact CLI invocation for the timer; do not edit systemd files or manifests.

### Agent E — professor digest backend

Read docs/implementation-plan.md completely; implement Agent E only. Add the digest service/routes against the frozen schema, summaries, model, and usage interfaces. Require instructor enrollment for both read and generate; a global instructor role alone is insufficient. On Generate, freeze today's Central date and the preceding six dates; under one professor usage gate, refresh today's changed class conversations, catch up any missing/stale summaries within the prior six days, then combine saved sources into a digest. Reuse unchanged daily rows. Pass beforeModelCall/recordUsage to the summary service without nesting usage gates. Charge every on-demand inference call to the professor against DAILY_TOKEN_LIMIT, including refreshes, retries, and reductions. Stop on quota exhaustion; report a required refresh failure instead of publishing a falsely current digest. Return zero to three ranked, anonymous friction points with concrete reteaching suggestions. Repeated doubts from one student must not masquerade as many students. Validate output shape/length and prevent identifiers/raw summaries reaching responses. Bound large batches and include all inference usage. No-source and valid-no-friction results are successful empty digests. Persist successful run/items atomically and retain previous results on failure. Prevent concurrent generation for the same class within the API instance. Update only the digest selection/visibility in classes.js; preserve Canvas/manual course creation and all unrelated behavior. Tests cover student denial, instructor-in-another-class denial, mixed-role access, today plus prior-six-day boundaries, unchanged-summary reuse, on-demand refresh billing, 0/1/3 items, invalid output, repeated generation, empty sources, generation/refresh failure preserving old data, and quota exhaustion midway through generation. Give G the router export and F example response payloads. Do not edit schema, llm.js, summaries.js, usage.js, or frontend.

### Agent F — frontend digest and quota experience

Read docs/implementation-plan.md completely; implement Agent F only. Add a DigestTile to the instructor class view with Generate digest, pending state that explains current conversations are being summarized, server-provided seven-day dates, last-generated time, and ranked 0-3 topics. Distinguish never generated, successful empty, loading, quota exceeded, and model failure; preserve the last successful digest during failures. Do not add summaries/digests to student chats. Preserve chat history rendering. Carry code/status/limit/resetsAt through both JSON and SSE errors and display the allowance reset time in the user's locale, retaining the unsent draft when quota is rejected. Render the configured limit received from the API; do not hardcode 50,000 or calculate reset times in the browser. Fix the existing streaming-auth mismatch: api/client.js supports an async Auth0 token provider, but api/stream.js currently reads only the legacy localStorage token. Export one shared async token resolver and use it for both transports, retaining legacy login. Handle 401 separately from quota and model errors. Use dedicated digest/usage query keys and invalidate after relevant actions, including failed generation that may have consumed tokens. Avoid new dependencies or broad visual redesigns. Verify with npm run build and targeted/manual flows for Auth0 streaming, legacy streaming, generation, empty digest, refresh failure, quota rejection, and a non-default token limit. Do not edit backend or package manifests; report any required dependency to G.

### Agent G — integration, configuration, and deployment handoff

Read docs/implementation-plan.md completely; implement Agent G only. Mount the new usage and digest routers, preserve existing routes, and serialize code/status/limit/resetsAt metadata as contracted. Update .env.example and README/deployment docs with VLLM_BASE_URL, VLLM_MODEL, VLLM_API_KEY, DAILY_TOKEN_LIMIT=50000, and model/context/summary output limits required by B/D. Specify that DAILY_TOKEN_LIMIT is a positive integer, takes effect on API restart, applies to every role and all on-demand model calls, and resets at midnight America/Chicago. Automatic nightly summaries are system cost. Remove any operational instruction implying a model name must be hardcoded. Keep credentials out of tracked files and browser env. Add a systemd oneshot summary service and daily timer for the existing Vultr layout at 00:05 America/Chicago; use Persistent=true and the D CLI's seven-day catch-up so missed runs recover. Use named Central timezone rules for scheduling and dates, including DST; the allowance rollover is independent of whether the timer runs. Add only necessary scripts/dependencies, coordinating any dependency choice before other agents rely on it. Once A-F are assembled, run disposable DB migration/upgrade checks, backend tests, frontend build, and integrated auth/chat/quota/summary/digest flows. Verify a non-default DAILY_TOKEN_LIMIT, Central midnight/DST, on-demand refresh billing, and today-plus-six-prior-days selection. Correct defects through the owning agents; do not silently edit outside your allowlist. Document exact migration, API restart, timer install, health/ping, and rollback steps. Do not run db:seed on Vultr, edit real secrets, or deploy as part of producing the implementation. Report live RunPod/DB checks separately from mocked/disposable verification, and state exactly what access is still needed for live checks.

## 7. Completion evidence

- Existing Canvas-imported courses and old chat histories remain intact after migration.
- Auth0 and legacy sessions can stream a real configured model reply; model/URL/key are env-driven.
- Every user's class chat, helper, and professor-triggered summary/digest calls consume one shared DAILY_TOKEN_LIMIT allowance; a non-default value works in enforcement and UI. Rejected requests show the next Central midnight, with DST covered.
- Two-line summaries exist only for changed student conversations; repeating a day creates no duplicate rows or needless model calls.
- A professor generates a class-scoped digest using refreshed current conversations plus the previous six nights, and sees 0-3 evidence-supported reteaching topics. Repeated generation reuses unchanged summaries; the next nightly run updates the same daily rows.
- Students and unrelated instructors cannot retrieve digest/source data through either endpoint.
- Missing summaries, no friction, provider failure, malformed model output, quota exhaustion, and scheduled-job downtime have verified behavior.
- Existing DB data is preserved; no shared database seed/reset is part of deployment.

Live verification will need the actual RunPod environment values and authorized access to the deployed API/database host. The supplied model nickname alone is not enough to infer the served-model identifier.

## 8. Agent A extra notes (schema delivered)

Status: implemented and verified on disposable databases on 2026-09-13; not applied to Vultr. Files touched: `server/src/schema.js`, `server/src/seed.js`, `server/drizzle/0003_summaries_digest_runs_usage.sql`, `server/drizzle/meta/0003_snapshot.json`, `server/drizzle/meta/_journal.json`, `server/test/database.test.js`.

### Exported fields (Drizzle camelCase -> SQL snake_case)

- `users`: `aiUsageDay` (`ai_usage_day` date, nullable, `'YYYY-MM-DD'` string) and `aiTokensUsed` (`ai_tokens_used` integer, NOT NULL, default 0, CHECK >= 0).
- `messages`: `promptTokens`, `completionTokens` (nullable integers, CHECK >= 0) and `usageSource` (nullable text, CHECK in `reported`/`estimated`). CHECK `messages_usage_agent_only`: all three must be NULL unless `sender = 'agent'`.
- `conversationDailySummaries` (`conversation_daily_summaries`): `id`, `conversationId` (FK `conversation_daily_summaries_conversation_fk` -> conversations, cascade), `summaryDay` (date), `body`, `messageCount` (CHECK >= 0), `sourceThroughAt`, `sourceThroughMessageId` (uuid, no FK by design), `snapshotAt`, `createdAt`, `updatedAt`. Unique index `conversation_daily_summaries_conv_day_idx (conversation_id, summary_day)`; index `(summary_day, conversation_id)`.
- `digestRuns` (`digest_runs`): `id`, `classId` (FK -> classes, cascade), `generatedBy` (FK -> users, set null), `windowStartDay`, `windowEndDay` (CHECK `window_end_day - window_start_day = 6`), `timeZone`, `summaryCount`, `studentCount` (default 0, CHECK >= 0), `promptTokens`, `completionTokens` (nullable, CHECK >= 0), `createdAt`. Index `(class_id, created_at)`.
- `digestItems`: added `digestRunId` (FK -> digest_runs, cascade, nullable), `rank` (nullable, CHECK 1..3), `topic` (nullable text). Unique index `digest_items_run_rank_idx (digest_run_id, rank)`; NULLs are distinct, so seeded items with null run IDs coexist. `kind` and `body` unchanged.

All date columns use `{ mode: 'string' }`, matching `assignments.dueDate`.

### Migration 0003

- Purely additive: two CREATE TABLE, eight ADD COLUMN, four FKs, four indexes, twelve CHECK constraints. No drops, type changes, or data rewrites. Every CHECK is satisfied by existing rows (new columns are NULL; `ai_tokens_used` defaults to 0).
- Safe to re-run: FKs are wrapped in `duplicate_object` guards and tables/indexes use `IF NOT EXISTS`.
- `drizzle-kit check` passes; `drizzle-kit generate` reports no pending changes; snapshot `0003.prevId` equals `0002.id`.
- The summaries -> conversations FK is explicitly named because Drizzle's default name was 64 characters and Postgres would have silently truncated it to 63, leaving the snapshot out of sync with the live constraint name.

### Verification performed

- Fresh disposable database migrated with `npx drizzle-kit migrate` (the production command); structure inspected.
- Disposable database brought to 0002, loaded with Auth0/Canvas-linked users (including `canvas_token_enc`), a Canvas-keyed class and assignment, a session, `agent_settings`, a conversation with messages, and a seeded digest item, then upgraded with `drizzle-kit migrate`. Pre-existing rows compared byte-for-byte before and after: identical.
- Constraint behavior confirmed: duplicate conversation/day rejected and same-day upsert refreshes in place; deleting the watermark message keeps the summary; non-seven-day windows rejected; ranks 0 and 4 and duplicate ranks rejected; usage on user rows, unknown `usage_source`, and negative tokens rejected; cascades (user delete -> `generated_by` NULL, run delete -> its items only, conversation delete -> summaries, class delete -> runs).
- `src/seed.js` executed against the disposable database: succeeds, truncates the new tables, leaves digest items with null run IDs and messages without usage.
- `TEST_DATABASE_URL=<disposable> node --test server/test/database.test.js`: 20/20 pass. Without `TEST_DATABASE_URL` the suite skips; it refuses to run when `TEST_DATABASE_URL` equals `DATABASE_URL`.

### Notes for other agents

- G: no manifest change was made. Optional script: `node --test test/database.test.js` with `TEST_DATABASE_URL` (and `TEST_DATABASE_SSL=true` if needed). Apply 0003 to Vultr with `npm run db:migrate` after a backup.
- C: write token metadata only on agent rows; `aiUsageDay` is a `'YYYY-MM-DD'` string. Atomic increment pattern verified: `update users set ai_tokens_used = ai_tokens_used + n where id = $1 and ai_usage_day = $2`.
- D: refresh in place with `insert ... on conflict (conversation_id, summary_day) do update`; `sourceThroughMessageId` intentionally has no FK.
- E: a run must satisfy `windowEndDay - windowStartDay = 6`; items use ranks 1..3, unique per run; newest-run selection by `max(created_at)` per class was verified.

## 9. Extra note for Agent G (early A-C deploy checkpoint)

Goal: deploy A (schema), B (RunPod transport), and C (usage + persisted chat) before D-F exist, to confirm the live model, database, and metering on real traffic. D/E/F only consume A-C; nothing in A-C requires them. The digest tables stay empty and the class page keeps showing seeded digest items.

Already done in G-owned files (2026-09-13):

- `server/src/index.js`: imports and mounts `usageRouter` (`GET /ai/usage`), and the central error middleware now serializes `HttpError` through C's `errorPayload(err)` so a 429 `ai_quota_exceeded` response carries `code`, `status`, `limit`, and `resetsAt`. Non-`HttpError` branches are unchanged.
- `server/.env.example`: added `DAILY_TOKEN_LIMIT=50000` with the semantics from section 2 (positive integer, default when unset, invalid value fails startup, every role, resets at Central midnight, takes effect on API restart, nightly summaries not charged). `VLLM_BASE_URL`, `VLLM_MODEL`, and `VLLM_API_KEY` were already present.

Still for G when C reports done:

- Run `npm install` in `server/` on the checkout used for verification; `express-oauth2-jwt-bearer` was missing from `node_modules` locally, which blocks importing `index.js` regardless of C.
- Start the API once with a deliberately low `DAILY_TOKEN_LIMIT` (for example `2000`) and confirm: `/health`, `/llm/health`, `npm run llm:ping`, legacy login, a class chat that reopens with history after reload, a 429 with `limit`/`resetsAt` after the allowance is spent, and `GET /ai/usage`.
- Do not stage C's paths while C is still editing; stage A and G paths explicitly.

Known rough edges at this checkpoint (owned by F, not blockers):

- The frontend does not yet format the 429; inspect the JSON in devtools.
- Auth0 sessions may fail to stream because `src/api/stream.js` still reads only the legacy localStorage token; use the legacy demo login for this checkpoint or land F's shared token resolver first.
- The digest router (`server/src/routes/digests.js`) is not mounted yet; add `app.use(digestsRouter)` when E delivers it.
