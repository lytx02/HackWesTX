import { useEffect, useRef, useState } from 'react';
import { ask } from '../agent/agent.js';

// Reusable chat surface. `scope` is 'general' | 'class' | 'task';
// `context` is whatever the agent stub needs (cls, task, upcoming).
// Pass `messages` + `onAppend` to make it controlled (persisted chats);
// otherwise it keeps its own in-memory log.
export default function AgentChat({
  scope = 'general',
  context = {},
  greeting,
  placeholder = 'Ask for help...',
  messages,
  onAppend,
  autoFocus = false,
}) {
  const controlled = Array.isArray(messages);
  const [local, setLocal] = useState(greeting ? [{ who: 'agent', text: greeting }] : []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  const log = controlled ? (messages.length || !greeting ? messages : [{ who: 'agent', text: greeting }]) : local;
  const append = (m) => (controlled ? onAppend(m) : setLocal((l) => [...l, m]));

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length, busy]);

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    append({ who: 'user', text });
    setBusy(true);
    const reply = await ask({ scope, context, message: text });
    append({ who: 'agent', text: reply });
    setBusy(false);
  };

  return (
    <>
      <div className="agent-log">
        {log.map((m, i) => (
          <div key={i} className={`msg ${m.who}`}>
            {m.text}
          </div>
        ))}
        {busy && <div className="msg agent muted">thinking...</div>}
        <div ref={endRef} />
      </div>
      <form className="agent-input" onSubmit={send}>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
          }}
          placeholder={placeholder}
          aria-label="Message"
          autoFocus={autoFocus}
        />
        <button type="submit" className="btn btn-agent" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </>
  );
}
