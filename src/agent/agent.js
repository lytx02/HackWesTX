// Stub "AI agent" for the POC. Returns canned, context-aware replies with a
// small delay. Swap `ask()` for a real model call later; the UI only depends
// on this signature: ask({ scope, context, message }) -> Promise<string>.

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ask({ scope, context = {}, message }) {
  await delay(400 + Math.random() * 400);
  const m = message.toLowerCase();

  if (scope === 'task' && context.task) {
    const t = context.task;
    if (/plan|break|steps|start/.test(m)) {
      return `Here is a plan for "${t.title}":\n1. Re-read the spec and list every deliverable.\n2. Block two focused sessions before ${t.due}.\n3. Do the smallest working version first, then polish.\n4. Leave the last day for the write-up and screenshots.`;
    }
    if (/due|when|deadline/.test(m)) return `"${t.title}" is due ${t.due}.`;
    return `About "${t.title}": ${t.details}\n\nAsk me to "make a plan", "explain the spec", or "what's due".`;
  }

  if (scope === 'class' && context.cls) {
    const c = context.cls;
    if (/hello|hi|intro/.test(m)) return `Hi, I'm ${c.agentName}, your ${c.name} assistant. ${c.agentBlurb}`;
    if (/due|upcoming|next/.test(m)) {
      const list = (context.upcoming ?? []).map((a) => `- ${a.title} (due ${a.due})`).join('\n');
      return list ? `Upcoming for ${c.code}:\n${list}` : `Nothing upcoming for ${c.code} right now.`;
    }
    return `(${c.agentName}) I only know ${c.name} material. Try asking what's due, or paste a problem and I'll walk through it.`;
  }

  // General "big" helper agent
  if (/due|week|upcoming|todo/.test(m)) {
    const list = (context.upcoming ?? []).map((a) => `- ${a.title} (due ${a.due})`).join('\n');
    const when = (context.label ?? 'This week').toLowerCase();
    return list ? `Due ${when}:\n${list}` : `Nothing due ${when}. Enjoy it.`;
  }
  if (/hello|hi|hey/.test(m)) return 'Hello. I can summarize your week, remind you about deadlines, or hand you off to a class assistant.';
  return `I'm a placeholder agent for the POC. You said: "${message}". Once the model is wired in, I'll actually help.`;
}
