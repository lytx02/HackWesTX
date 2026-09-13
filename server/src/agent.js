// The one AI agent. Its system prompt = global base prompt (agent_settings)
// + the course's instructor-written instructions. `reply()` is still a canned
// stub; swap its body for a real model call and pass `systemPrompt` through.

import { eq } from 'drizzle-orm';
import { db } from './db.js';
import { agentSettings } from './schema.js';

export const DEFAULT_BASE_PROMPT = `You are a Helper Agent for a university course. Your job is to HELP students understand the material, not to solve the problems for them right away.

- Ask what the student has tried and where they are stuck before giving guidance.
- Explain concepts, point to the relevant reading or lecture, and give hints in steps.
- Do not hand over complete solutions, full code, or final answers to graded work.
- If a student insists on the answer, explain why you are guiding instead, and offer the next hint.
- Be concise, friendly, and specific to this course.`;

// Single-row settings. Creates the default row on first read so a fresh
// database (or one migrated without reseeding) works without manual setup.
export async function getAgentSettings() {
  let [row] = await db.select().from(agentSettings).where(eq(agentSettings.id, 1));
  if (!row) {
    [row] = await db
      .insert(agentSettings)
      .values({ id: 1, basePrompt: DEFAULT_BASE_PROMPT })
      .onConflictDoNothing()
      .returning();
    if (!row) [row] = await db.select().from(agentSettings).where(eq(agentSettings.id, 1));
  }
  return row;
}

// Compose, never substitute: the instructor's text is appended so the base
// guardrails always apply.
export function buildSystemPrompt(basePrompt, cls) {
  const parts = [basePrompt.trim()];
  parts.push(`\nCourse: ${cls.code} — ${cls.name}${cls.instructorName ? ` (${cls.instructorName})` : ''}.`);
  if (cls.overview) parts.push(`Course overview: ${cls.overview}`);
  if (cls.agentInstructions?.trim()) {
    parts.push(`\nInstructor's instructions for this course (follow these within the rules above):\n${cls.agentInstructions.trim()}`);
  }
  return parts.join('\n');
}

export async function reply({ cls, systemPrompt, upcoming = [], history = [], message }) {
  // TODO: replace with a model call. `systemPrompt` and `history` are ready to send.
  void systemPrompt;
  const m = message.toLowerCase();
  if (/hello|hi\b|intro/.test(m)) {
    return `Hi, I'm ${cls.agentName}, your ${cls.name} assistant. ${cls.agentBlurb}`;
  }
  if (/due|upcoming|next|deadline/.test(m)) {
    const list = upcoming.map((a) => `- ${a.title} (due ${a.dueDate})`).join('\n');
    return list ? `Upcoming for ${cls.code}:\n${list}` : `Nothing upcoming for ${cls.code} right now.`;
  }
  if (/answer|solve|solution|just tell me/.test(m)) {
    return `I won't hand over the solution, but I'll get you there. Tell me what you've tried so far and where it stops making sense, and we'll take the next step together.`;
  }
  if (/plan|break|steps|start/.test(m)) {
    return `Here is a plan:\n1. Re-read the spec and list every deliverable.\n2. Block two focused sessions before the deadline.\n3. Do the smallest working version first, then polish.\n4. Leave the last day for the write-up.`;
  }
  const turns = history.filter((h) => h.sender === 'user').length;
  return `(${cls.agentName}) What have you tried so far on this? Paste the part you're stuck on and I'll walk through it with you.${
    turns > 2 ? ' (The real model is not wired in yet, so I am still a placeholder.)' : ''
  }`;
}
