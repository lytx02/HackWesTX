// Server-side agent stub. Same canned behaviour as the old frontend stub so the
// app feels identical after the swap. Replace `reply()` with a real model call;
// the message route only depends on this signature.

export async function reply({ cls, upcoming = [], history = [], message }) {
  const m = message.toLowerCase();
  if (/hello|hi\b|intro/.test(m)) {
    return `Hi, I'm ${cls.agentName}, your ${cls.name} assistant. ${cls.agentBlurb}`;
  }
  if (/due|upcoming|next|deadline/.test(m)) {
    const list = upcoming.map((a) => `- ${a.title} (due ${a.dueDate})`).join('\n');
    return list ? `Upcoming for ${cls.code}:\n${list}` : `Nothing upcoming for ${cls.code} right now.`;
  }
  if (/plan|break|steps|start/.test(m)) {
    return `Here is a plan:\n1. Re-read the spec and list every deliverable.\n2. Block two focused sessions before the deadline.\n3. Do the smallest working version first, then polish.\n4. Leave the last day for the write-up.`;
  }
  const turns = history.filter((h) => h.sender === 'user').length;
  return `(${cls.agentName}) I only know ${cls.name} material. Try asking what's due, or paste a problem and I'll walk through it.${
    turns > 2 ? ' The real model is not wired in yet, so I am still a placeholder.' : ''
  }`;
}
