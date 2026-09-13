# Campus AI (POC)

React + Vite proof of concept. Everything is frontend-only for now: no backend, no real auth
(Auth0 comes later). State lives in `localStorage`.

```bash
npm install
npm run dev
```

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

## Code map

| Path | What |
| --- | --- |
| `src/theme/tokens.js` | All fonts, colors, spacing, radii, shadows as presets. Turned into CSS variables by `ThemeProvider`. |
| `src/theme/global.css` | Structure-only CSS that references the variables. |
| `src/state/SessionContext.jsx` | Who is signed in (role, email, institution). |
| `src/state/DataContext.jsx` | Classes, assignments, students, digests, chats. Reducer + `localStorage`. |
| `src/data/mock.js` | Seed data. Bump `STORAGE_KEY` in `DataContext` when its shape changes. |
| `src/agent/agent.js` | Canned agent stub. Replace `ask()` with a real model call. |
| `src/pages/student/*`, `src/pages/instructor/*` | Role-specific views. |
| `src/components/*` | Tiles, boxes, modals, chat surface, sidebar shell, helper bubble. |

## Not built yet

- Instructor "Workspace" area from the sketch.
- Real auth, backend, and the actual AI agent.
