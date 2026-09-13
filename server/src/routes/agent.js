import { Router } from 'express';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { agentSettings, assignments, classes, enrollments } from '../schema.js';
import { requireRole, requireUser } from '../auth.js';
import { buildHelperPrompt, buildSystemPrompt, getAgentSettings, replyStream } from '../agent.js';
import { errorPayload, forbidden, requireString, wrap } from '../http.js';
import { openSse } from '../sse.js';
import { withUsageBudget } from '../usage.js';
import { requireMember } from './classes.js';

export const agentRouter = Router();
agentRouter.use(requireUser);

// Global base prompt. Readable by anyone signed in, editable by instructors.
agentRouter.get(
  '/agent-settings',
  wrap(async (_req, res) => {
    res.json(await getAgentSettings());
  })
);

agentRouter.patch(
  '/agent-settings',
  requireRole('instructor'),
  wrap(async (req, res) => {
    const basePrompt = requireString(req.body, 'basePrompt', { max: 8000 });
    await getAgentSettings(); // ensure the row exists
    const [row] = await db
      .update(agentSettings)
      .set({ basePrompt, updatedBy: req.user.id, updatedAt: new Date() })
      .where(eq(agentSettings.id, 1))
      .returning();
    res.json(row);
  })
);

// Per-course instructions. Only an instructor of that course may edit.
agentRouter.patch(
  '/classes/:classId/agent',
  requireMember,
  wrap(async (req, res) => {
    if (req.membership !== 'instructor') throw forbidden('Only the instructor can edit the agent instructions');
    const raw = req.body?.agentInstructions;
    const agentInstructions = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 8000) : null;
    const [cls] = await db
      .update(classes)
      .set({ agentInstructions, instructionsUpdatedBy: req.user.id, instructionsUpdatedAt: new Date() })
      .where(eq(classes.id, req.cls.id))
      .returning();
    res.json(cls);
  })
);

// What the agent will actually be told for this course (instructor preview).
agentRouter.get(
  '/classes/:classId/agent/prompt',
  requireMember,
  wrap(async (req, res) => {
    if (req.membership !== 'instructor') throw forbidden('Instructors only');
    const settings = await getAgentSettings();
    res.json({ systemPrompt: buildSystemPrompt(settings.basePrompt, req.cls) });
  })
);

// Floating helper bubble: not persisted, the client sends the running history.
// Streams the same SSE events as /conversations/:id/messages/stream minus `user`.
agentRouter.post(
  '/agent/stream',
  wrap(async (req, res) => {
    const message = requireString(req.body, 'body', { max: 4000 });
    const history = (Array.isArray(req.body.history) ? req.body.history : [])
      .filter((m) => m && typeof m.text === 'string' && (m.who === 'user' || m.who === 'agent'))
      .slice(-30)
      .map((m) => ({ sender: m.who, body: m.text.slice(0, 4000) }));

    return withUsageBudget(req.user.id, async ({ beforeModelCall, recordUsage }) => {
      const upcoming = await db
        .select({ code: classes.code, title: assignments.title, dueDate: assignments.dueDate })
        .from(enrollments)
        .innerJoin(classes, eq(classes.id, enrollments.classId))
        .innerJoin(assignments, eq(assignments.classId, classes.id))
        .where(and(eq(enrollments.userId, req.user.id), gte(assignments.dueDate, sql`current_date`)))
        .orderBy(asc(assignments.dueDate))
        .limit(20);

      const settings = await getAgentSettings();
      const systemPrompt = buildHelperPrompt(settings.basePrompt, req.user, upcoming);

      // withUsageBudget has checked admission before SSE headers are opened.
      const sse = openSse(req, res);
      let text = '';
      try {
        for await (const delta of replyStream({
          systemPrompt,
          upcoming,
          history,
          message,
          signal: sse.signal,
          beforeModelCall,
          recordUsage,
        })) {
          text += delta;
          sse.send('delta', { text: delta });
        }
        if (!sse.signal.aborted) sse.send('done', { message: { sender: 'agent', body: text } });
      } catch (err) {
        if (sse.signal.aborted) return;
        console.error('helper reply failed:', err.message);
        sse.send('error', errorPayload(err));
      } finally {
        sse.close();
      }
    });
  })
);
