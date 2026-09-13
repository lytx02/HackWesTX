import { Router } from 'express';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { assignments, classes, conversations, messages } from '../schema.js';
import { requireUser } from '../auth.js';
import { buildSystemPrompt, getAgentSettings, reply, replyStream } from '../agent.js';
import { isUuid, notFound, requireString, wrap } from '../http.js';
import { openSse } from '../sse.js';
import { requireMember } from './classes.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireUser);

const DEFAULT_TITLE = 'New conversation';

async function loadOwned(req) {
  const id = req.params.conversationId;
  if (!isUuid(id)) throw notFound('Conversation not found');
  const [row] = await db
    .select({ c: conversations, cls: classes })
    .from(conversations)
    .innerJoin(classes, eq(classes.id, conversations.classId))
    .where(and(eq(conversations.id, id), eq(conversations.userId, req.user.id)));
  if (!row) throw notFound('Conversation not found');
  return row;
}

conversationsRouter.post(
  '/classes/:classId/conversations',
  requireMember,
  wrap(async (req, res) => {
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 120) : DEFAULT_TITLE;
    const [c] = await db.insert(conversations).values({ classId: req.cls.id, userId: req.user.id, title }).returning();
    res.status(201).json({ ...c, messageCount: 0, lastMessage: null });
  })
);

conversationsRouter.get(
  '/conversations/:conversationId',
  wrap(async (req, res) => {
    const { c, cls } = await loadOwned(req);
    const history = await db.select().from(messages).where(eq(messages.conversationId, c.id)).orderBy(asc(messages.createdAt));
    res.json({ conversation: c, class: cls, messages: history });
  })
);

conversationsRouter.patch(
  '/conversations/:conversationId',
  wrap(async (req, res) => {
    const { c } = await loadOwned(req);
    const title = requireString(req.body, 'title', { max: 120 });
    const [updated] = await db.update(conversations).set({ title }).where(eq(conversations.id, c.id)).returning();
    res.json(updated);
  })
);

// Shared by both message routes: validate, store the user's turn, retitle an
// untitled chat, and assemble everything the model needs.
async function startTurn(req) {
  const { c, cls } = await loadOwned(req);
  const body = requireString(req.body, 'body', { max: 4000 });

  const history = await db.select().from(messages).where(eq(messages.conversationId, c.id)).orderBy(asc(messages.createdAt));
  const [userMsg] = await db.insert(messages).values({ conversationId: c.id, sender: 'user', body }).returning();

  // An untitled conversation takes its title from the first user message.
  let title = c.title;
  if (c.title === DEFAULT_TITLE && !history.some((m) => m.sender === 'user')) {
    title = body.slice(0, 60);
    await db.update(conversations).set({ title }).where(eq(conversations.id, c.id));
  }

  const upcoming = await db
    .select({ title: assignments.title, dueDate: assignments.dueDate })
    .from(assignments)
    .where(
      and(
        eq(assignments.classId, cls.id),
        gte(assignments.dueDate, sql`current_date`),
        // Qualified by hand: single-table FROM, see classes.js.
        sql`not exists(select 1 from submissions s where s.assignment_id = assignments.id and s.student_id = ${req.user.id})`
      )
    )
    .orderBy(asc(assignments.dueDate));

  const settings = await getAgentSettings();
  const systemPrompt = buildSystemPrompt(settings.basePrompt, cls, upcoming);
  return { c, cls, title, userMsg, history, upcoming, systemPrompt, message: body };
}

const storeAgentMessage = (conversationId, body) =>
  db
    .insert(messages)
    .values({ conversationId, sender: 'agent', body })
    .returning()
    .then(([m]) => m);

// Post a user message; the agent answers in the same request (no streaming).
conversationsRouter.post(
  '/conversations/:conversationId/messages',
  wrap(async (req, res) => {
    const turn = await startTurn(req);
    const text = await reply(turn);
    const agentMsg = await storeAgentMessage(turn.c.id, text);
    res.status(201).json({ title: turn.title, messages: [turn.userMsg, agentMsg] });
  })
);

// Same, but the reply streams back as Server-Sent Events:
//   event: user   {title, message}        the stored user message
//   event: delta  {text}                  a chunk of the agent's answer
//   event: done   {message}               the stored agent message
//   event: error  {error}                 the model failed; nothing was stored
conversationsRouter.post(
  '/conversations/:conversationId/messages/stream',
  wrap(async (req, res) => {
    const turn = await startTurn(req);
    const sse = openSse(req, res);
    sse.send('user', { title: turn.title, message: turn.userMsg });

    let text = '';
    try {
      for await (const delta of replyStream({ ...turn, signal: sse.signal })) {
        text += delta;
        sse.send('delta', { text: delta });
      }
      const agentMsg = await storeAgentMessage(turn.c.id, text);
      sse.send('done', { message: agentMsg });
    } catch (err) {
      if (sse.signal.aborted) {
        // Browser left mid-answer: keep what was generated so the chat is not one-sided.
        if (text.trim()) await storeAgentMessage(turn.c.id, text).catch((e) => console.error(e));
        return;
      }
      console.error('agent reply failed:', err.message);
      sse.send('error', { error: err.message ?? 'The assistant is unavailable right now' });
    } finally {
      sse.close();
    }
  })
);
