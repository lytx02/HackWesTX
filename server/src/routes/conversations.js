import { Router } from 'express';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { assignments, classes, conversations, enrollments, messages } from '../schema.js';
import { requireUser } from '../auth.js';
import { buildSystemPrompt, getAgentSettings, reply, replyStream } from '../agent.js';
import { badRequest, errorPayload, isUuid, notFound, requireString, wrap } from '../http.js';
import { imageUrls, messageWithAttachments, parseAttachments, withAttachmentText } from '../attachments.js';
import { openSse } from '../sse.js';
import { withUsageBudget } from '../usage.js';
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
    .innerJoin(
      enrollments,
      and(eq(enrollments.classId, conversations.classId), eq(enrollments.userId, conversations.userId))
    )
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
  // A message may be text, files, or both.
  const attachments = await parseAttachments(req.body?.attachments);
  const body = attachments.length
    ? typeof req.body?.body === 'string'
      ? req.body.body.trim().slice(0, 4000)
      : ''
    : requireString(req.body, 'body', { max: 4000 });
  if (!body && !attachments.length) throw badRequest('Type a message or attach a file');

  const history = await db.select().from(messages).where(eq(messages.conversationId, c.id)).orderBy(asc(messages.createdAt));
  const [userMsg] = await db
    .insert(messages)
    .values({ conversationId: c.id, sender: 'user', body, attachments: attachments.length ? attachments : null })
    .returning();

  // An untitled conversation takes its title from the first user message.
  let title = c.title;
  if (c.title === DEFAULT_TITLE && !history.some((m) => m.sender === 'user')) {
    title = (body || attachments[0].name).slice(0, 60);
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
  return {
    c,
    cls,
    title,
    userMsg,
    history: history.map(withAttachmentText),
    upcoming,
    systemPrompt,
    message: messageWithAttachments(body, attachments),
    images: imageUrls(attachments),
  };
}

const storeAgentMessage = (conversationId, body, usage = null) =>
  db
    .insert(messages)
    .values({
      conversationId,
      sender: 'agent',
      body,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      usageSource: usage?.source ?? null,
    })
    .returning()
    .then(([m]) => m);

// Post a user message; the agent answers in the same request (no streaming).
conversationsRouter.post(
  '/conversations/:conversationId/messages',
  wrap(async (req, res) => {
    return withUsageBudget(req.user.id, async ({ beforeModelCall, recordUsage }) => {
      // Budget admission above happens before startTurn stores the user message.
      const turn = await startTurn(req);
      let usage = null;
      const text = await reply({ ...turn, beforeModelCall, recordUsage, onUsage: (value) => { usage = value; } });
      const agentMsg = await storeAgentMessage(turn.c.id, text, usage);
      res.status(201).json({ title: turn.title, messages: [turn.userMsg, agentMsg] });
    });
  })
);

// Same, but the reply streams back as Server-Sent Events:
//   event: user   {title, message}        the stored user message
//   event: delta  {text}                  a chunk of the agent's answer
//   event: done   {message}               the stored agent message
//   event: error  {error, code?, ...}      assistant generation/storage failed;
//                                         the already-emitted user turn remains
conversationsRouter.post(
  '/conversations/:conversationId/messages/stream',
  wrap(async (req, res) => {
    return withUsageBudget(req.user.id, async ({ beforeModelCall, recordUsage }) => {
      // Budget admission above happens before the user turn is inserted and
      // before openSse commits a 200 response.
      const turn = await startTurn(req);
      const sse = openSse(req, res);
      sse.send('user', { title: turn.title, message: turn.userMsg });

      let text = '';
      let usage = null;
      try {
        for await (const delta of replyStream({
          ...turn,
          signal: sse.signal,
          beforeModelCall,
          recordUsage,
          onUsage: (value) => { usage = value; },
        })) {
          text += delta;
          sse.send('delta', { text: delta });
        }
        const agentMsg = await storeAgentMessage(turn.c.id, text, usage);
        sse.send('done', { message: agentMsg });
      } catch (err) {
        if (sse.signal.aborted) {
          // Browser left mid-answer: keep generated output and its explicit
          // reported/estimated usage metadata so reload remains consistent.
          if (text.trim()) await storeAgentMessage(turn.c.id, text, usage).catch((e) => console.error(e));
          return;
        }
        console.error('agent reply failed:', err.message);
        sse.send('error', errorPayload(err));
      } finally {
        sse.close();
      }
    });
  })
);
