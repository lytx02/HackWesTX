import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { agentSettings, classes } from '../schema.js';
import { requireRole, requireUser } from '../auth.js';
import { buildSystemPrompt, getAgentSettings } from '../agent.js';
import { forbidden, requireString, wrap } from '../http.js';
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
