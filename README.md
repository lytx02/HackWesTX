# Campus AI (POC)

React + Vite frontend with an Express + PostgreSQL (Vultr) backend in `server/`. Login is a
temporary email + role handshake until Auth0 is added.

Run both, in two terminals:

```bash
npm install
npm run dev            # frontend on http://localhost:5173
```

```bash
cd server
npm run dev            # API on http://localhost:4000 (needs server/.env, see Backend)
```

The frontend reads `VITE_API_URL` (default `http://localhost:4000`); copy `.env.example` to `.env` to change it.

## Flow

1. `/` Landing questionnaire: **Student** or **Instructor**. Returning users click **Log in**.
2. `/auth` Choose institution, verify with a `.edu` (or `.ac.xx` / `.edu.xx` / listed domain) email. Verification is simulated.
3. `/login` Returning user: email + password (any password works) + role.
4. `/dashboard` and `/class/:id` render a **student** or **instructor** variant based on the role picked.

### Instructor

- **Dashboard**: classes as tiles + **Add class** popup (Class Name, Course Number, Class Overview).
- **Class view**: Performance (overall class average + per-assignment averages), Students list,
  AI Digest (bullet recommendations such as "Students are struggling with X in Y. Suggestion: ..."),
  Assignments in descending order with a **Create new assignment** button on top.

### Student

- **Dashboard**: classes as box tiles + **Add class** (join by course number), Upcoming assignments
  for this week (or next week if this week is empty). **AI help** on a task opens a class chat on that topic.
- **Class view**: AI Helper conversation selector (**+ New chat** on top, then existing chats) and Upcoming.
- **Chat view** `/class/:id/chat/:chatId`: one large conversation. Header is `Class Name — Topic`.
  An untitled chat takes its title from the first message.

A floating **Helper Agent** bubble is available on every signed-in page for both roles.

## Backend (server/)

Express + Drizzle + `pg` against PostgreSQL on Vultr. The frontend talks to it through `src/api/`.

```bash
cd server
cp .env.example .env        # fill in DATABASE_URL with the PUBLIC host and the POOL port
npm install
npm run db:migrate          # applies server/drizzle/*.sql
npm run db:seed             # loads src/data/mock.js; WIPES existing rows
npm run dev                 # http://localhost:4000
```

Demo logins after seeding: `student@okstate.edu` (student) and `instructor@okstate.edu` (instructor).

| Endpoint | Who | What |
| --- | --- | --- |
| `POST /auth/login` `{email, role}` | anyone | Creates the user on first login, returns `{token, user, institution}`. Temporary until Auth0. |
| `POST /auth/logout` | signed in | Ends the session. |
| `GET /me` | signed in | User, institution, their classes, announcements. |
| `POST /classes` `{name, code, overview?}` | instructor creates, student joins by `code` | Returns the class. |
| `GET /classes/:id` | member | Class, assignments (with class avg + your done flag), roster (instructors only), AI digest, your conversations. |
| `POST /classes/:id/assignments` | instructor | Create assignment. |
| `POST /assignments/:id/done` `{done}` | student | Mark done / not done. |
| `POST /classes/:id/conversations` `{title?}` | member | New AI Helper chat. |
| `GET /conversations/:id` | owner | Conversation + messages. |
| `POST /conversations/:id/messages` `{body}` | owner | Stores your message, the agent replies in the same request. |
| `POST /conversations/:id/messages/stream` `{body}` | owner | Same, but the reply streams back as SSE (`user`, `delta`…, `done` / `error`). The app uses this one. |
| `POST /agent/stream` `{body, history?}` | signed in | Floating helper bubble; not persisted. SSE `delta`…, `done` / `error`. |
| `GET /llm/health` | anyone | Pings the vLLM server (`GET /v1/models`): `{ok, model, models, latencyMs}`. |
| `PATCH /conversations/:id` `{title}` | owner | Rename. |
| `GET /agent-settings` | signed in | The one agent's global base prompt. |
| `PATCH /agent-settings` `{basePrompt}` | instructor | Edit the base prompt (affects every course). |
| `PATCH /classes/:id/agent` `{agentInstructions}` | instructor of that class | Per-course instructions appended to the base prompt. Empty clears. |
| `GET /classes/:id/agent/prompt` | instructor of that class | Preview of the composed system prompt. |

Send the token as `Authorization: Bearer <token>`.

### AI model (vLLM on RunPod)

Replies come from Qwen served by vLLM on a RunPod pod, through its OpenAI-compatible API
(`server/src/llm.js`). Set `VLLM_BASE_URL` (ending in `/v1`) and `VLLM_MODEL` in `server/.env`;
see `server/.env.example` for the pod vs. serverless URL shapes. With `VLLM_BASE_URL` empty the
agent answers with canned stub text so the app runs without a GPU. `npm run llm:ping` (in `server/`)
checks connectivity and streams a test completion. The data model is documented in [docs/erd.md](docs/erd.md). Schema lives in `server/src/schema.js`; edit it, then `npm run db:generate` and `npm run db:migrate`.

## Code map

| Path | What |
| --- | --- |
| `src/theme/tokens.js` | All fonts, colors, spacing, radii, shadows as presets. Turned into CSS variables by `ThemeProvider`. |
| `src/theme/global.css` | Structure-only CSS that references the variables. |
| `src/state/SessionContext.jsx` | Who is signed in; `signIn`/`signOut` call the API and keep the token. |
| `src/api/client.js`, `src/api/hooks.js` | Fetch wrapper + TanStack Query hooks (`useMe`, `useClass`, `useConversation`, mutations). |
| `src/api/stream.js` | SSE-over-POST reader; `useSendMessage` streams the agent reply into the conversation cache. |
| `src/data/mock.js` | Seed data for `server/src/seed.js` and the institution dropdown. Not used for app state. |
| `server/src/llm.js`, `server/src/agent.js` | vLLM client (stream + ping) and the agent's prompt composition / stub fallback. |
| `src/pages/student/*`, `src/pages/instructor/*` | Role-specific views. |
| `src/components/*` | Tiles, boxes, modals, chat surface, sidebar shell, helper bubble. |

## Not built yet

- Instructor "Workspace" area from the sketch.
- Real auth (Auth0).
