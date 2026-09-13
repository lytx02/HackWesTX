// The one AI agent. Its system prompt = global base prompt (agent_settings)
// + the course's instructor-written instructions. Replies come from the Qwen
// model on RunPod through llm.js; without VLLM_BASE_URL the canned stub
// answers so the app still runs locally.

import { eq } from 'drizzle-orm';
import { db } from './db.js';
import { agentSettings } from './schema.js';
import * as llm from './llm.js';

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
export function buildSystemPrompt(basePrompt, cls, upcoming = []) {
  const parts = [basePrompt.trim()];
  parts.push(`\nCourse: ${cls.code} — ${cls.name}${cls.instructorName ? ` (${cls.instructorName})` : ''}.`);
  if (cls.overview) parts.push(`Course overview: ${cls.overview}`);
  if (cls.agentName) parts.push(`You are called ${cls.agentName}.${cls.agentBlurb ? ` ${cls.agentBlurb}` : ''}`);
  if (upcoming.length) {
    parts.push(`\nThis student's upcoming assignments (today is ${today()}):\n${formatUpcoming(upcoming)}`);
  }
  if (cls.agentInstructions?.trim()) {
    parts.push(`\nInstructor's instructions for this course (follow these within the rules above):\n${cls.agentInstructions.trim()}`);
  }
  return parts.join('\n');
}

// System prompt for the floating helper bubble, which spans every class.
export function buildHelperPrompt(basePrompt, user, upcoming = []) {
  const parts = [basePrompt.trim()];
  parts.push(
    `\nYou are the general Helper Agent across all of ${user.name}'s classes (${user.role}). Summarize what is due, help them prioritize, and point them to the right class assistant for subject questions.`
  );
  parts.push(
    upcoming.length
      ? `\nUpcoming assignments (today is ${today()}):\n${formatUpcoming(upcoming)}`
      : `\nThere are no upcoming assignments right now (today is ${today()}).`
  );
  return parts.join('\n');
}

const today = () => new Date().toISOString().slice(0, 10);
const formatUpcoming = (list) => list.map((a) => `- ${a.code ? `[${a.code}] ` : ''}${a.title} (due ${a.dueDate})`).join('\n');

export const isModelConfigured = llm.isConfigured;

// Streams the agent's answer as text deltas. `history` is the stored messages
// ({sender, body}); `message` is the new user turn. `signal` aborts the model
// call when the client disconnects.
export function estimateChatUsage(modelMessages, output = '') {
  // Character-based estimates are deliberately labeled estimated. Dividing by
  // three is conservative for typical English/code prompts without claiming to
  // reproduce the deployment model's tokenizer.
  const estimate = (text) => Math.max(1, Math.ceil(new TextEncoder().encode(text).length / 3));
  return {
    promptTokens: modelMessages.reduce((sum, item) => sum + estimate(item.content), 0),
    completionTokens: estimate(output),
    source: 'estimated',
  };
}

export async function* replyStream({
  cls,
  systemPrompt,
  upcoming = [],
  history = [],
  message,
  signal,
  beforeModelCall,
  recordUsage,
  onUsage,
}) {
  if (llm.isConfigured()) {
    if (typeof beforeModelCall !== 'function' || typeof recordUsage !== 'function') {
      throw new Error('Configured model calls require usage budget callbacks');
    }
    const modelMessages = llm.toChatMessages(systemPrompt, history, message);
    await beforeModelCall();
    let output = '';
    let settled = false;
    const settle = async (reported) => {
      if (settled) return;
      settled = true;
      const usage = await recordUsage(reported ?? estimateChatUsage(modelMessages, output));
      if (onUsage) await onUsage(usage);
    };
    try {
      for await (const delta of llm.streamChat(modelMessages, { signal, onUsage: settle })) {
        output += delta;
        yield delta;
      }
    } finally {
      // Covers missing terminal usage, abrupt provider failure, and browser
      // disconnect. recordUsage is idempotently invoked once for this call.
      if (!settled) await settle(null);
    }
    return;
  }
  yield stubReply({ cls, upcoming, history, message });
}

export async function reply(args) {
  let out = '';
  for await (const delta of replyStream(args)) out += delta;
  return out;
}

// Canned answers for local dev without a model.
function stubReply({ cls, upcoming, history, message }) {
  const name = cls?.agentName ?? 'Helper';
  const m = message.toLowerCase();
  if (/hello|hi\b|intro/.test(m)) {
    return cls ? `Hi, I'm ${name}, your ${cls.name} assistant. ${cls.agentBlurb}` : 'Hello. I can summarize your week or remind you about deadlines.';
  }
  if (/due|upcoming|next|deadline|week/.test(m)) {
    return upcoming.length ? `Upcoming:\n${formatUpcoming(upcoming)}` : 'Nothing upcoming right now.';
  }
  if (/answer|solve|solution|just tell me/.test(m)) {
    return `I won't hand over the solution, but I'll get you there. Tell me what you've tried so far and where it stops making sense, and we'll take the next step together.`;
  }
  if (/plan|break|steps|start/.test(m)) {
    return `Here is a plan:\n1. Re-read the spec and list every deliverable.\n2. Block two focused sessions before the deadline.\n3. Do the smallest working version first, then polish.\n4. Leave the last day for the write-up.`;
  }
  const turns = history.filter((h) => h.sender === 'user').length;
  return `(${name}) What have you tried so far on this? Paste the part you're stuck on and I'll walk through it with you.${
    turns > 2 ? ' (No model is configured — set VLLM_BASE_URL in server/.env.)' : ''
  }`;
}
